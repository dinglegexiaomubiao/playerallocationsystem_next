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
import { clearPlayerListCache } from './player-list.js';
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

// ============================================================
// 写操作
// ============================================================
//
// 每个写操作都做三件事：校验权限 → 落库 → 清群友列表缓存。
// 清缓存很容易漏：/api/players 带 45s 缓存，卡片上的帮派名/渐变都来自那里，
// 不清的话「刚建完帮派，群友卡片要等 45 秒才变」——用户会以为没生效。

/** 业务错误：message 是给用户看的人话，code 是 HTTP 状态码。 */
export class GuildError extends Error {
  constructor(message, code = 400) {
    super(message);
    this.name = 'GuildError';
    this.code = code;
  }
}

/**
 * 把唯一索引冲突翻译成人话。
 * 靠 constraint 名区分是哪条约束 —— 数据库是唯一知道「到底哪个字段撞了」的一方，
 * 应用层猜（先查一遍再插）在并发下会漏。
 */
function translateUnique(e) {
  const c = String((e && e.constraint) || '');
  if (c.includes('guilds_name_key')) return new GuildError('这个帮派名已经有人用了，换一个');
  if (c.includes('guilds_color_key')) return new GuildError('这支配色已经被其他帮派用了，换一支');
  if (c.includes('guild_members_player')) return new GuildError('这个人已经加入帮派了');
  if (c.includes('guild_invites_pending')) return new GuildError('已经邀请过这个人了');
  return new GuildError('有重复数据，换一个再试');
}

const isUniqueViolation = (e) => e && e.code === '23505';

/** 取我在的帮派 + 我的角色，没有帮派返回 null。所有写操作的权限判断都从这走。 */
async function mySeat(client, playerId) {
  const r = await client.query(
    `SELECT g.id, g.name, g.leader_player_id, gm.role,
            (SELECT count(*) FROM public.guild_members m WHERE m.guild_id = g.id)::int AS member_count
       FROM public.guild_members gm
       JOIN public.guilds g ON g.id = gm.guild_id
      WHERE gm.player_id = $1`,
    [playerId]
  );
  return r.rows[0] || null;
}

const assertLeader = (seat) => {
  if (!seat) throw new GuildError('你还没有加入帮派', 404);
  if (seat.role !== 'leader') throw new GuildError('只有帮主能做这个操作', 403);
};

/**
 * 创建帮派。创建者自动成为帮主。
 *
 * 事务里同时写 guilds 与 guild_members：只写前者会留下「没有帮主的帮派」，
 * 那种帮派谁也管不了，只能进库手删。
 */
export async function createGuild({ playerId, name, nameKey, slogan, colorKey }) {
  if (!playerId) throw new GuildError('先绑定群友信息才能创建帮派', 400);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seat = await mySeat(client, playerId);
    if (seat) throw new GuildError(`你已经在「${seat.name}」里了，一个人只能在一个帮派`, 400);

    const ins = await client.query(
      `INSERT INTO public.guilds (name, name_key, slogan, color_key, leader_player_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, nameKey, slogan || null, colorKey, playerId]
    );
    const guildId = ins.rows[0].id;
    await client.query(
      "INSERT INTO public.guild_members (guild_id, player_id, role) VALUES ($1, $2, 'leader')",
      [guildId, playerId]
    );
    await client.query('COMMIT');
    clearPlayerListCache();
    return guildId;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (isUniqueViolation(e)) throw translateUnique(e);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 改帮派名 / 配色 / 口号。只传要改的字段（`undefined` 表示不改）。
 * 传空字符串表示「清空口号」—— 口号允许为空，名称不允许。
 */
export async function updateGuild({ playerId, name, nameKey, slogan, colorKey }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seat = await mySeat(client, playerId);
    assertLeader(seat);
    try {
      await client.query(
        `UPDATE public.guilds
            SET name = COALESCE($2, name),
                name_key = COALESCE($3, name_key),
                slogan = CASE WHEN $4::boolean THEN $5 ELSE slogan END,
                color_key = COALESCE($6, color_key),
                updated_at = now()
          WHERE id = $1`,
        [
          seat.id,
          name === undefined ? null : name,
          nameKey === undefined ? null : nameKey,
          slogan !== undefined,
          slogan === undefined ? null : slogan || null,
          colorKey === undefined ? null : colorKey,
        ]
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw translateUnique(e);
      throw e;
    }
    await client.query('COMMIT');
    clearPlayerListCache();
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (isUniqueViolation(e)) throw translateUnique(e);
    throw e;
  } finally {
    client.release();
  }
}

/** 解散帮派。成员与邀请靠 ON DELETE CASCADE 清掉，配色随之释放。 */
export async function dissolveGuild({ playerId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seat = await mySeat(client, playerId);
    assertLeader(seat);
    await client.query('DELETE FROM public.guilds WHERE id = $1', [seat.id]);
    await client.query('COMMIT');
    clearPlayerListCache();
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 移除成员。帮主不能移除自己 —— 要嘛转让，要嘛解散。
 * （「移除自己」会让帮派变成无主，后面谁也没权限管它）
 */
export async function removeGuildMember({ playerId, targetPlayerId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seat = await mySeat(client, playerId);
    assertLeader(seat);
    if (String(targetPlayerId) === String(playerId)) {
      throw new GuildError('不能移除自己。想离开请先转让帮主，或直接解散帮派', 400);
    }
    const r = await client.query(
      'DELETE FROM public.guild_members WHERE guild_id = $1 AND player_id = $2',
      [seat.id, targetPlayerId]
    );
    if (r.rowCount === 0) throw new GuildError('这个人不在你的帮派里', 404);
    await client.query('COMMIT');
    clearPlayerListCache();
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 成员自己退出。帮主调用会被拒 —— 必须转让或解散。 */
export async function leaveGuild({ playerId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seat = await mySeat(client, playerId);
    if (!seat) throw new GuildError('你还没有加入帮派', 404);
    if (seat.role === 'leader') {
      throw new GuildError('帮主不能直接退出。请先转让帮主，或解散帮派', 400);
    }
    await client.query('DELETE FROM public.guild_members WHERE guild_id = $1 AND player_id = $2', [
      seat.id,
      playerId,
    ]);
    await client.query('COMMIT');
    clearPlayerListCache();
  } catch (e) {
    await client.query('ROLLBACK').catch((x) => x);
    throw e;
  } finally {
    client.release();
  }
}

/** 转让帮主。两行 role 互换，在同一个事务里。 */
export async function transferLeader({ playerId, targetPlayerId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const seat = await mySeat(client, playerId);
    assertLeader(seat);
    if (String(targetPlayerId) === String(playerId)) {
      throw new GuildError('已经是帮主了', 400);
    }
    const t = await client.query(
      'SELECT 1 FROM public.guild_members WHERE guild_id = $1 AND player_id = $2',
      [seat.id, targetPlayerId]
    );
    if (!t.rows.length) throw new GuildError('这个人不在你的帮派里', 404);

    await client.query("UPDATE public.guild_members SET role = 'member' WHERE guild_id = $1 AND player_id = $2", [
      seat.id,
      playerId,
    ]);
    await client.query("UPDATE public.guild_members SET role = 'leader' WHERE guild_id = $1 AND player_id = $2", [
      seat.id,
      targetPlayerId,
    ]);
    await client.query('UPDATE public.guilds SET leader_player_id = $2, updated_at = now() WHERE id = $1', [
      seat.id,
      targetPlayerId,
    ]);
    await client.query('COMMIT');
    clearPlayerListCache();
  } catch (e) {
    await client.query('ROLLBACK').catch((x) => x);
    throw e;
  } finally {
    client.release();
  }
}
