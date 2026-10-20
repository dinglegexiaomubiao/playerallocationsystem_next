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

// ===== 时间解析 =====
// datetime-local 的值是「用户本地墙钟」，不带时区。绝对不能直接 new Date(str)：
// 那样用的是**服务器**时区。生产环境 Node 常常跑在 UTC，用户选 10-20 17:00 会被
// 存成 17:00Z，浏览器 +08 一渲染就成了 10-21 01:00。
//
// 现在的约定：
//   1. 新前端提交绝对瞬间（带 Z 或 ±hh:mm）+ tz_offset（浏览器 getTimezoneOffset，+08 为 -480）
//   2. 老前端/curl 传来裸串时，用 tz_offset 还原；没给偏移就退回老的服务器本地解析，
//      保证行为不比以前更糟
const HAS_ZONE_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

function parseClientInstant(raw, offsetMin) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!s) return null;

  if (HAS_ZONE_RE.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  const m = s.match(NAIVE_RE);
  if (m) {
    const off = Number(offsetMin);
    if (Number.isFinite(off)) {
      // 先把墙钟当作 UTC 拿名义值，再按客户端偏移还原真实瞬间
      const wallAsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
      return new Date(wallAsUtc + off * 60000);
    }
  }

  const d = new Date(s); // 老口径兜底
  return isNaN(d.getTime()) ? null : d;
}

const pad2 = (n) => String(n).padStart(2, '0');

// 按「指定偏移下的墙钟」格式化。+08 时 off=-480，等价于把时刻 +8 小时后读 UTC 分量。
function fmtWallClock(date, offsetMin) {
  const off = Number(offsetMin);
  const t = Number.isFinite(off) ? date.getTime() - off * 60000 : date.getTime();
  const d = new Date(t);
  if (Number.isFinite(off)) {
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
      d.getUTCHours()
    )}:${pad2(d.getUTCMinutes())}`;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
}

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
    created_at: r.created_at_ts || r.created_at,
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
    created_at: r.created_at_ts || r.created_at,
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

      // created_at 是 timestamp without time zone，写入时走 CURRENT_TIMESTAMP，
      // 落库的是「数据库会话时区」的墙钟（本库是 GMT）。直接读会被 node 当成本地时间，
      // 显示就差 8 小时。这里额外算一个绝对时刻列，不去覆盖 p.* 里的同名列。
      const posts = await client.query(`
        SELECT p.*, pl.nickname AS creator_nickname, pl.group_nickname AS creator_group_nickname,
               pl.score AS creator_score,
               (p.created_at AT TIME ZONE current_setting('TimeZone')) AS created_at_ts
          FROM public.party_posts p
          LEFT JOIN public.players pl ON pl.id = p.player_id
         ORDER BY (CASE WHEN p.status = 'open' THEN 0 ELSE 1 END), p.created_at DESC
         LIMIT 120
      `);

      let signups = { rows: [] };
      if (posts.rows.length > 0) {
        signups = await client.query(
          `SELECT s.*, (s.created_at AT TIME ZONE current_setting('TimeZone')) AS created_at_ts
             FROM public.party_signups s
            WHERE s.post_id = ANY($1::bigint[])
            ORDER BY s.created_at ASC`,
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

      // 开始时间：前端已转成绝对瞬间；裸串按 tz_offset 还原（见 parseClientInstant 注释）
      const tzOffset = num(b.tz_offset);
      const startDate = parseClientInstant(b.start_at, tzOffset);
      if (!startDate) {
        return res.status(400).json({ success: false, error: '请选择开黑开始时间' });
      }

      const durationMin = num(b.duration_min);
      if (durationMin === null || durationMin < 15 || durationMin > 1440) {
        return res.status(400).json({ success: false, error: '请选择持续时间（15 分钟 ~ 24 小时）' });
      }

      // play_time 是老字段，列表上仍可能被旧代码读取；用开始时间生成一个可读文本兜底。
      // 注意按「用户本地墙钟」生成，不能用服务器时区。
      const playTime = clip(b.play_time, 120) || fmtWallClock(startDate, tzOffset);

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
