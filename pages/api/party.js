// 开黑组队：GET 列表 / POST 新建卡片
import { pool, ensurePartyTables } from '../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../lib/auth';
import { tierOf } from '../../lib/tier.mjs';
import { PARTY_MODES, modeLabel, PARTY_STATUS } from '../../lib/options.mjs';

const toList = (v) =>
  Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean)
    : String(v || '')
        .split(/[，,、\/;；|]/)
        .map((s) => s.trim())
        .filter(Boolean);

const clip = (v, n) => (v === null || v === undefined ? null : String(v).trim().slice(0, n) || null);
const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const MODE_KEYS = PARTY_MODES.map((m) => m.key);

async function getMe(client, name) {
  const r = await client.query(
    `SELECT ps.player_id, pl.nickname, pl.group_nickname, pl.score, pl.positions, pl.game_id
       FROM public.play_score ps
       LEFT JOIN public.players pl ON pl.id = ps.player_id
      WHERE ps.name = $1`,
    [name]
  );
  const row = r.rows[0];
  if (!row || !row.player_id) return { bound: false, playerId: null, nickname: null };
  return {
    bound: true,
    playerId: String(row.player_id),
    nickname: row.nickname || row.group_nickname || null,
    score: row.score === null || row.score === undefined ? null : Number(row.score),
    positions: toList(row.positions),
    // 前端「一键带入我的资料」要用 SteamID 预填
    gameId: row.game_id === null || row.game_id === undefined ? null : String(row.game_id),
  };
}

function shapePost(r) {
  // 过期判定：以「开始时间 + 持续时间」为准，老卡片没这两个字段就不过期
  const startAt = r.start_at ? new Date(r.start_at) : null;
  const durationMin = r.duration_min === null || r.duration_min === undefined ? null : Number(r.duration_min);
  let endAt = null;
  let expired = false;
  if (startAt && !isNaN(startAt.getTime()) && durationMin) {
    endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);
    expired = endAt.getTime() < Date.now();
  }

  return {
    id: String(r.id),
    mode: r.mode,
    modeLabel: modeLabel(r.mode),
    game_id: r.game_id === null ? null : String(r.game_id),
    my_score: r.my_score,
    my_rank: r.my_rank,
    my_positions: toList(r.my_positions),
    want_score_min: r.want_score_min,
    want_score_max: r.want_score_max,
    want_rank: r.want_rank,
    want_positions: toList(r.want_positions),
    play_time: r.play_time,
    // 新字段：需要几人 / 开始时间 / 持续时长 / 结束时间 / 是否过期
    need_players: r.need_players === null || r.need_players === undefined ? null : Number(r.need_players),
    start_at: startAt && !isNaN(startAt.getTime()) ? startAt.toISOString() : null,
    duration_min: durationMin,
    end_at: endAt ? endAt.toISOString() : null,
    expired,
    has_voice: r.has_voice !== false,
    voice_app: r.voice_app,
    note: r.note,
    status: r.status || 'open',
    statusLabel: (PARTY_STATUS[r.status] || PARTY_STATUS.open).label,
    created_at: r.created_at,
    creator: {
      player_id: r.player_id === null ? null : String(r.player_id),
      nickname: r.creator_nickname || r.creator_group_nickname || r.account_name || '群友',
      score: r.creator_score === null || r.creator_score === undefined ? null : r.creator_score,
    },
  };
}

function shapeSignup(r) {
  return {
    id: String(r.id),
    player_id: r.player_id === null ? null : String(r.player_id),
    account_name: r.account_name || null,
    nickname: r.nickname || r.account_name || '群友',
    score: r.score,
    rank: r.rank,
    positions: toList(r.positions),
    eta: r.eta,
    note: r.note,
    created_at: r.created_at,
  };
}

export default async function handler(req, res) {
  try {
    await ensurePartyTables();
  } catch (e) {
    console.error('开黑表初始化失败:', e);
    return res.status(500).json({ success: false, error: '数据库未就绪' });
  }

  const session = getSession(req);
  const client = await pool.connect();

  try {
    // ---------- 列表 ----------
    if (req.method === 'GET') {
      const me = session ? await getMe(client, session.name) : { bound: false, playerId: null };

      const posts = await client.query(`
        SELECT p.*, pl.nickname AS creator_nickname, pl.group_nickname AS creator_group_nickname,
               pl.score AS creator_score
          FROM public.party_posts p
          LEFT JOIN public.players pl ON pl.id = p.player_id
         ORDER BY (CASE WHEN p.status = 'open' THEN 0 ELSE 1 END), p.created_at DESC
         LIMIT 120
      `);

      let signups = { rows: [] };
      if (posts.rows.length > 0) {
        signups = await client.query(
          `SELECT * FROM public.party_signups
            WHERE post_id = ANY($1::bigint[])
            ORDER BY created_at ASC`,
          [posts.rows.map((p) => p.id)]
        );
      }
      const byPost = new Map();
      for (const s of signups.rows) {
        const k = String(s.post_id);
        if (!byPost.has(k)) byPost.set(k, []);
        byPost.get(k).push(shapeSignup(s));
      }

      const list = posts.rows.map((p) => {
        const row = shapePost(p);
        row.signups = byPost.get(String(p.id)) || [];
        row.signupCount = row.signups.length;
        row.isMine = !!(me.playerId && row.creator.player_id === me.playerId);
        row.iJoined = row.signups.some((s) => s.account_name && session && s.account_name === session.name);
        return row;
      });

      return res.status(200).json({ success: true, me, posts: list });
    }

    // ---------- 新建卡片 ----------
    if (req.method === 'POST') {
      if (denyIfNotLoggedIn(req, res, '开黑需要先登录')) return;

      const me = await getMe(client, session.name);
      if (!me.bound) {
        return res
          .status(400)
          .json({ success: false, error: '请先在「个人信息」页补填选手资料，再来开黑' });
      }

      const b = req.body || {};
      const mode = String(b.mode || '');
      if (!MODE_KEYS.includes(mode)) {
        return res.status(400).json({ success: false, error: '请选择开黑模式' });
      }

      // 人数：不再是写死的 5 人，由发起人自己定（对黑通常 10 人）
      const needPlayers = num(b.need_players);
      if (needPlayers === null || needPlayers < 1 || needPlayers > 20) {
        return res.status(400).json({ success: false, error: '请填写需要几个人（1~20）' });
      }

      // 开始时间：前端 datetime-local 传上来的是本地时间字符串，这里统一按 Date 解析后存 timestamptz
      const startRaw = b.start_at;
      const startDate = startRaw ? new Date(startRaw) : null;
      if (!startDate || isNaN(startDate.getTime())) {
        return res.status(400).json({ success: false, error: '请选择开黑开始时间' });
      }

      const durationMin = num(b.duration_min);
      if (durationMin === null || durationMin < 15 || durationMin > 1440) {
        return res.status(400).json({ success: false, error: '请选择持续时间（15 分钟 ~ 24 小时）' });
      }

      // play_time 是老字段，列表上仍可能被旧代码读取；用开始时间生成一个可读文本兜底
      const pad = (n) => String(n).padStart(2, '0');
      const playTime =
        clip(b.play_time, 120) ||
        `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())} ${pad(
          startDate.getHours()
        )}:${pad(startDate.getMinutes())}`;

      // 自己这边没填的，用选手资料兜底（前端「一键带入」也是这个口径）
      const myScore = num(b.my_score) ?? (me.score === null || me.score === undefined ? null : Number(me.score));
      const myRank = clip(b.my_rank, 30) || (myScore !== null ? tierOf(myScore).label : null);
      const myPositions = toList(b.my_positions).length ? toList(b.my_positions) : me.positions || [];

      const openCount = await client.query(
        `SELECT COUNT(*)::int AS n FROM public.party_posts WHERE player_id = $1 AND status = 'open'`,
        [me.playerId]
      );
      if (openCount.rows[0].n >= 5) {
        return res
          .status(400)
          .json({ success: false, error: '你已有 5 张招募中的卡片，先关掉一些再发' });
      }

      const inserted = await client.query(
        `INSERT INTO public.party_posts
           (player_id, account_name, mode, game_id, my_score, my_rank, my_positions,
            want_score_min, want_score_max, want_rank, want_positions,
            play_time, need_players, start_at, duration_min,
            has_voice, voice_app, note, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'open')
         RETURNING id`,
        [
          me.playerId,
          session.name,
          mode,
          /^\d{1,20}$/.test(String(b.game_id || '').trim()) ? String(b.game_id).trim() : null,
          myScore,
          myRank,
          myPositions.join(','),
          num(b.want_score_min),
          num(b.want_score_max),
          clip(b.want_rank, 30),
          toList(b.want_positions).join(','),
          playTime,
          needPlayers,
          startDate.toISOString(),
          durationMin,
          b.has_voice === false ? false : true,
          clip(b.voice_app, 50),
          clip(b.note, 500),
        ]
      );

      return res.status(200).json({ success: true, id: String(inserted.rows[0].id) });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    console.error('开黑接口错误:', error);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  } finally {
    client.release();
  }
}
