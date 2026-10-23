/**
 * 帮派（小团体）的服务端逻辑层。
 *
 * 这一层只做「查」和「规则」，不碰 HTTP（响应格式在 pages/api/guild* 里）。
 * 放到独立文件的原因：个人信息页、群友列表、帮派列表页、帮派主页四个入口都要读
 * 同一份数据，各写一份 SQL 迟早漂移 —— `/api/players` 当年就是这么变成两套的。
 *
 * 三条硬约束不在这里判断，在数据库里（见 lib/db.js 的 ensureGuildTables）：
 *   名称唯一 / 配色唯一 / 一人一帮。
 * 这一层只负责把「违反约束」翻译成人话，以及处理人数上限这类业务规则。
 *
 * ⚠ 上限 10 人是用户确认的（2026-10-23）。改这里就够了，不用找别处。
 */

import { pool } from './db.js';
import { LIMITS } from './moderation.mjs';
import { GUILD_COLOR_KEYS, guildColor } from './guild-colors.mjs';

export const MAX_GUILD_MEMBERS = 10;

/** 账号名 → 绑定的选手 id。未绑定时返回 null（帮派挂在选手上，不挂账号）。 */
export async function playerIdOfAccount(accountName) {
  if (!accountName) return null;
  const r = await pool.query('SELECT player_id FROM public.play_score WHERE name = $1', [
    String(accountName),
  ]);
  return r.rows[0]?.player_id ?? null;
}

/**
 * 帮派名归一化：全角转半角（NFKC）+ 小写 + 去所有空白，然后截到字数上限。
 *
 * 为什么不直接 UNIQUE(lower(name))：lower() 处理不了全角，
 * 「ＬａＲｏｊａ」和「laroja」会变成两个名字，实际上是一个人想抢注同一个名字。
 * 展示永远用原始 name，只有判重才用这个 key。
 */
export function normalizeGuildName(name) {
  return [...String(name || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')]
    .slice(0, LIMITS.guildName)
    .join('');
}

/** 把 DB 行变成接口字段。color 为 null 说明配色 key 已不在色板里（改过色板），前端应降级。 */
const shapeGuild = (r) => ({
  id: Number(r.id),
  name: r.name,
  slogan: r.slogan || '',
  colorKey: r.color_key,
  color: guildColor(r.color_key),
  memberCount: Number(r.member_count || 0),
  maxMembers: MAX_GUILD_MEMBERS,
  createdAt: r.created_at,
});

const shapeMember = (r) => ({
  playerId: Number(r.player_id),
  role: r.role,
  nickname: r.nickname || '未命名',
  avatar: r.avatar_url || null,
  region: r.region || '',
  score: Number(r.score || 0),
  joinedAt: r.joined_at,
});

const GUILD_COLS = `
  g.id, g.name, g.slogan, g.color_key, g.created_at, g.leader_player_id,
  (SELECT count(*) FROM public.guild_members m WHERE m.guild_id = g.id)::int AS member_count
`;

/** 我所在帮派的成员列表。帮主排第一，其余按入帮时间（先来的在上面）。 */
export async function guildMembers(guildId) {
  const r = await pool.query(
    `SELECT gm.player_id, gm.role, gm.joined_at, p.nickname, p.avatar_url, p.region, p.score
       FROM public.guild_members gm
       LEFT JOIN public.players p ON p.id = gm.player_id
      WHERE gm.guild_id = $1
      ORDER BY (gm.role = 'leader') DESC, gm.joined_at ASC`,
    [guildId]
  );
  return r.rows.map(shapeMember);
}

/**
 * 我所在的帮派。没加入返回 null。
 * 返回里带 myRole / isLeader，因为「能不能管理」是页面第一件要判断的事。
 */
export async function guildOfPlayer(playerId) {
  if (!playerId) return null;
  const r = await pool.query(
    `SELECT ${GUILD_COLS}, gm.role AS my_role
       FROM public.guild_members gm
       JOIN public.guilds g ON g.id = gm.guild_id
      WHERE gm.player_id = $1`,
    [playerId]
  );
  if (!r.rows.length) return null;
  const g = shapeGuild(r.rows[0]);
  return {
    ...g,
    myRole: r.rows[0].my_role,
    isLeader: r.rows[0].my_role === 'leader',
    leaderPlayerId: Number(r.rows[0].leader_player_id),
    members: await guildMembers(g.id),
  };
}

/** 单个帮派 + 成员（公开主页用，未登录也能取）。找不到返回 null。 */
export async function guildById(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const r = await pool.query(
    `SELECT ${GUILD_COLS}, p.nickname AS leader_name
       FROM public.guilds g
       LEFT JOIN public.players p ON p.id = g.leader_player_id
      WHERE g.id = $1`,
    [n]
  );
  if (!r.rows.length) return null;
  return {
    ...shapeGuild(r.rows[0]),
    leaderName: r.rows[0].leader_name || '未命名',
    leaderPlayerId: Number(r.rows[0].leader_player_id),
    members: await guildMembers(n),
  };
}

/**
 * 帮派列表（公开）。
 *
 * 排序：自己的帮派置顶 → 人数多的在前 → 早成立的在前。
 * 成员头像只取前 5 个（列表里叠 5 个封顶，多的用 +N 表示），
 * 用一次窗口函数查完，不按帮派循环查 —— 帮派多了会变成 N+1。
 *
 * viewerPlayerId 为 null（未登录）时 isMine 全为 false。
 */
export async function listGuilds({ viewerPlayerId = null } = {}) {
  const r = await pool.query(
    `SELECT ${GUILD_COLS}, p.nickname AS leader_name,
            (mine.player_id IS NOT NULL) AS is_mine
       FROM public.guilds g
       LEFT JOIN public.players p ON p.id = g.leader_player_id
       LEFT JOIN public.guild_members mine
              ON mine.guild_id = g.id AND mine.player_id = $1
      ORDER BY (mine.player_id IS NOT NULL) DESC, member_count DESC, g.created_at ASC`,
    [viewerPlayerId]
  );
  if (!r.rows.length) return [];

  const ids = r.rows.map((x) => Number(x.id));
  const heads = await pool.query(
    `SELECT guild_id, player_id, nickname, avatar_url
       FROM (
         SELECT gm.guild_id, gm.player_id, p.nickname, p.avatar_url,
                row_number() OVER (
                  PARTITION BY gm.guild_id
                  ORDER BY (gm.role = 'leader') DESC, gm.joined_at ASC
                ) AS rn
           FROM public.guild_members gm
           LEFT JOIN public.players p ON p.id = gm.player_id
          WHERE gm.guild_id = ANY($1::bigint[])
       ) t
      WHERE rn <= 5`,
    [ids]
  );

  const byGuild = new Map();
  for (const h of heads.rows) {
    const k = Number(h.guild_id);
    if (!byGuild.has(k)) byGuild.set(k, []);
    byGuild.get(k).push({ playerId: Number(h.player_id), nickname: h.nickname || '未命名', avatar: h.avatar_url || null });
  }

  return r.rows.map((x) => ({
    ...shapeGuild(x),
    leaderName: x.leader_name || '未命名',
    isMine: !!x.is_mine,
    headAvatars: byGuild.get(Number(x.id)) || [],
  }));
}

/**
 * 我收到的、还没处理的邀请数量。
 * 个人信息页要显示「3 个邀请待处理」，进站弹窗也靠这个判断要不要拉详情。
 */
export async function countPendingInvites(playerId) {
  if (!playerId) return 0;
  const r = await pool.query(
    "SELECT count(*)::int AS c FROM public.guild_invites WHERE player_id = $1 AND status = 'pending'",
    [playerId]
  );
  return r.rows[0]?.c || 0;
}

/**
 * 12 套配色各自被谁占用。返回 { colorKey: guildName }，前端据此把已占用的置灰。
 *
 * 注意：这里回传的是「哪个帮派」，不是「不能选」。颜色本来就是公开信息，
 * 帮派名也公开在列表页上，所以不算泄漏。但如果将来帮派变私密，这里要改成只回布尔。
 */
export async function colorUsage() {
  const r = await pool.query('SELECT color_key, name FROM public.guilds');
  const used = {};
  for (const x of r.rows) used[x.color_key] = x.name;
  const free = GUILD_COLOR_KEYS.filter((k) => !used[k]);
  return { used, free };
}
