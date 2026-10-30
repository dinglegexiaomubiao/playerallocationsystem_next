// 活动招募：GET 列表 / POST 新建活动
// 与开黑同源：登录即可发（不要求绑定选手资料），但权限判定同样只看 account_name。
import { pool, ensureActivityTables } from '../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../lib/auth';
import {
  ACTIVITY_TYPES,
  activityTypeLabel,
  ACTIVITY_STATUS,
  ACTIVITY_COSTS,
} from '../../lib/options.mjs';
import { checkInput, LIMITS, moderationMessage } from '../../lib/moderation.mjs';
import { aiModerate, aiModerationMessage, openidOf } from '../../lib/ai-moderate.mjs';

const clip = (v, n) =>
  v === null || v === undefined ? null : String(v).trim().slice(0, n) || null;
const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const TYPE_KEYS = ACTIVITY_TYPES.map((t) => t.key);
const COST_KEYS = ACTIVITY_COSTS;

// 卡片名称兜底：不填就按「昵称 + 的活动」生成。
const defaultTitle = (nickname, typeLabel) =>
  `${nickname || '群友'}的${typeLabel || '活动'}`;

// ===== 时间解析（与开黑同一套，见 party.js 注释） =====
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
      const wallAsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
      return new Date(wallAsUtc + off * 60000);
    }
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const pad2 = (n) => String(n).padStart(2, '0');
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
    `SELECT ps.player_id, pl.nickname, pl.group_nickname
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
  };
}

function shapePost(r) {
  const meetAt = r.meet_at ? new Date(r.meet_at) : null;
  const durationMin =
    r.duration_min === null || r.duration_min === undefined ? null : Number(r.duration_min);
  let endAt = null;
  let expired = false;
  if (meetAt && !isNaN(meetAt.getTime()) && durationMin) {
    endAt = new Date(meetAt.getTime() + durationMin * 60 * 1000);
    expired = endAt.getTime() < Date.now();
  }

  return {
    id: String(r.id),
    title:
      r.title ||
      defaultTitle(r.creator_nickname || r.creator_group_nickname || r.account_name, activityTypeLabel(r.type)),
    type: r.type,
    typeLabel: activityTypeLabel(r.type),
    region: r.region || null,
    location: r.location || null,
    // 集合时间：前端传绝对瞬间；裸串按 tz_offset 还原（见 parseClientInstant）
    meet_at: meetAt && !isNaN(meetAt.getTime()) ? meetAt.toISOString() : null,
    duration_min: durationMin,
    end_at: endAt ? endAt.toISOString() : null,
    expired,
    need_people: r.need_people === null || r.need_people === undefined ? null : Number(r.need_people),
    cost: r.cost || null,
    note: r.note || null,
    status: r.status || 'open',
    statusLabel: (ACTIVITY_STATUS[r.status] || ACTIVITY_STATUS.open).label,
    created_at: r.created_at_ts || r.created_at,
    creator: {
      player_id: r.player_id === null ? null : String(r.player_id),
      nickname: r.creator_nickname || r.creator_group_nickname || r.account_name || '群友',
    },
  };
}

function shapeSignup(r) {
  return {
    id: String(r.id),
    player_id: r.player_id === null ? null : String(r.player_id),
    account_name: r.account_name || null,
    nickname: r.nickname || r.account_name || '群友',
    // 携伴人数：默认 0（自己 1 人）
    guests: r.guests === null || r.guests === undefined ? 0 : Number(r.guests),
    note: r.note || null,
    created_at: r.created_at_ts || r.created_at,
  };
}

export default async function handler(req, res) {
  try {
    await ensureActivityTables();
  } catch (e) {
    console.error('活动表初始化失败:', e);
    return res.status(500).json({ success: false, error: '数据库未就绪' });
  }

  const session = getSession(req);
  const client = await pool.connect();

  try {
    // ---------- 列表 ----------
    if (req.method === 'GET') {
      const me = session ? await getMe(client, session.name) : { bound: false, playerId: null };

      // created_at 是 timestamp without time zone，落库的是数据库会话时区的墙钟（本库 GMT）。
      // 这里额外算一个绝对时刻列，不去覆盖 p.* 里的同名列。
      const posts = await client.query(`
        SELECT p.*, pl.nickname AS creator_nickname, pl.group_nickname AS creator_group_nickname,
               (p.created_at AT TIME ZONE current_setting('TimeZone')) AS created_at_ts
          FROM public.activity_posts p
          LEFT JOIN public.players pl ON pl.id = p.player_id
         ORDER BY (CASE WHEN p.status = 'open' THEN 0 ELSE 1 END), p.created_at DESC
         LIMIT 120
      `);

      let signups = { rows: [] };
      if (posts.rows.length > 0) {
        signups = await client.query(
          `SELECT s.*, (s.created_at AT TIME ZONE current_setting('TimeZone')) AS created_at_ts
             FROM public.activity_signups s
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
        // 实到人数 = 报名人数 + 各自携伴人数（每人至少算 1）
        row.joinedPeople = row.signups.reduce(
          (acc, s) => acc + 1 + (s.guests || 0),
          0
        );
        row.isMine = !!(me.playerId && row.creator.player_id === me.playerId);
        row.iJoined = row.signups.some(
          (s) => s.account_name && session && s.account_name === session.name
        );
        return row;
      });

      return res.status(200).json({ success: true, me, posts: list });
    }

    // ---------- 新建活动 ----------
    if (req.method === 'POST') {
      if (denyIfNotLoggedIn(req, res, '发起活动需要先登录')) return;

      const me = await getMe(client, session.name);
      const b = req.body || {};
      // UGC 合规初筛 + 截断（标题/地点/备注）
      const chk = checkInput(b, { title: LIMITS.title, location: LIMITS.location, note: LIMITS.note });
      if (!chk.ok) return res.status(400).json({ success: false, error: moderationMessage(chk) });
      Object.assign(b, chk.cleaned);
      // AI 复审（DeepSeek）：超时/出错自动放行
      const ai = await aiModerate({ 标题: b.title, 地点: b.location, 备注: b.note }, { openid: openidOf(req) });
      if (!ai.ok) return res.status(400).json({ success: false, error: aiModerationMessage(ai) });

      const type = String(b.type || '');
      if (!TYPE_KEYS.includes(type)) {
        return res.status(400).json({ success: false, error: '请选择活动类型' });
      }

      const needPeople = num(b.need_people);
      if (needPeople === null || needPeople < 1 || needPeople > 50) {
        return res.status(400).json({ success: false, error: '请填写需要几个人（1~50）' });
      }

      // 集合时间：前端已转成绝对瞬间；裸串按 tz_offset 还原
      const tzOffset = num(b.tz_offset);
      const meetDate = parseClientInstant(b.meet_at, tzOffset);
      if (!meetDate) {
        return res.status(400).json({ success: false, error: '请选择集合时间' });
      }

      const durationMin = num(b.duration_min);
      if (durationMin === null || durationMin < 15 || durationMin > 2880) {
        return res.status(400).json({ success: false, error: '请选择持续时间（15 分钟 ~ 48 小时）' });
      }

      const cost = clip(b.cost, 40);
      if (cost && !COST_KEYS.includes(cost)) {
        return res.status(400).json({ success: false, error: '费用方式不合法' });
      }

      // 地点：地区（RegionPicker 国省市区）+ 具体地址，两者结合。具体地址必填。
      const region = clip(b.region, 50);
      const location = clip(b.location, 160);
      if (!location) {
        return res.status(400).json({ success: false, error: '请填写具体集合地点' });
      }

      const openCount = await client.query(
        `SELECT COUNT(*)::int AS n FROM public.activity_posts WHERE account_name = $1 AND status = 'open'`,
        [session.name]
      );
      if (openCount.rows[0].n >= 5) {
        return res
          .status(400)
          .json({ success: false, error: '你已有 5 个招募中的活动，先关掉一些再发' });
      }

      // 活动名称：可自定义，留空就默认「昵称的{类型}」
      const title = clip(b.title, 80) || defaultTitle(me.nickname, activityTypeLabel(type));

      const inserted = await client.query(
        `INSERT INTO public.activity_posts
           (player_id, account_name, title, type, region, location, meet_at, duration_min, need_people, cost, note, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open')
         RETURNING id, title`,
        [
          me.playerId,
          session.name,
          title,
          type,
          region,
          location,
          meetDate.toISOString(),
          durationMin,
          needPeople,
          cost,
          clip(b.note, 500),
        ]
      );

      return res.status(200).json({
        success: true,
        id: String(inserted.rows[0].id),
        title: inserted.rows[0].title,
      });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    console.error('活动接口错误:', error);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  } finally {
    client.release();
  }
}
