/**
 * 帮派管理（管理员）。
 *
 * 为什么必须有一个越权入口：帮派是群友自助创建的，名字和配色都有全站唯一约束 ——
 * 一旦有人拿违规的名字、或者干脆是个空壳帮，**帮主不解散就永远占着那个名字和那支色**。
 * 之前后台连帮派列表都没有，只能进库改。
 *
 * 规则与用户侧保持一致：
 *   - 名称字数 / 口号字数走 lib/moderation.mjs 的 LIMITS，不只是「截断」而是先查违禁词
 *   - 配色必须是色板里的 key（isGuildColor）
 *   - 名称判重用 normalizeGuildName（全角、空白归一），否则「ＬａＲｏｊａ」能绕过唯一索引
 * 区别只有一条：**管理员不需要是帮主**，其他校验一模一样。
 *
 * 改完一定要 clearPlayerListCache()：群友卡片上的帮派色和徽标来自那份列表缓存，
 * 不清的话后台改完了、前台 45 秒内还是旧样子，会以为没生效。
 */
import { ensureGuildTables, pool } from '../../../lib/db';
import { denyIfNotAdmin } from '../../../lib/auth';
import { checkInput, moderationMessage, LIMITS } from '../../../lib/moderation.mjs';
import { isGuildColor, GUILD_COLOR_KEYS, guildColor } from '../../../lib/guild-colors.mjs';
import { normalizeGuildName } from '../../../lib/guild.mjs';
import { clearPlayerListCache } from '../../../lib/player-list.js';

const ok = (res, data) => res.status(200).json({ success: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });

/** PG 唯一约束 → 人话。约束名在 lib/db.js 的 ensureGuildTables 里 */
const shotAt = (e) => {
  if (!e || e.code !== '23505') return null;
  if (String(e.constraint || '').includes('name_key')) return '这个名字已经有人用了';
  if (String(e.constraint || '').includes('color_key')) return '这支配色已经被别的帮派占了';
  return '跟已有记录冲突';
};

export default async function handler(req, res) {
  if (denyIfNotAdmin(req, res)) return;

  let client;
  try {
    await ensureGuildTables();
    client = await pool.connect();

    if (req.method === 'GET') {
      const { rows } = await client.query(`
        SELECT g.id, g.name, g.slogan, g.color_key, g.created_at, g.leader_player_id,
               pl.nickname AS leader_name,
               (SELECT count(*) FROM public.guild_members m WHERE m.guild_id = g.id)::int AS member_count,
               (SELECT count(*) FROM public.guild_invites i
                 WHERE i.guild_id = g.id AND i.status = 'pending')::int AS pending_invites
          FROM public.guilds g
          LEFT JOIN public.players pl ON pl.id = g.leader_player_id
         ORDER BY g.created_at DESC
      `);

      const ids = rows.map((r) => r.id);
      let members = [];
      let invites = [];
      if (ids.length) {
        const m = await client.query(
          `SELECT gm.guild_id, gm.player_id, gm.role, gm.joined_at, p.nickname, p.region
             FROM public.guild_members gm
             LEFT JOIN public.players p ON p.id = gm.player_id
            WHERE gm.guild_id = ANY($1::bigint[])
            ORDER BY (gm.role = 'leader') DESC, gm.joined_at ASC`,
          [ids]
        );
        members = m.rows;
        const i = await client.query(
          `SELECT i.id, i.guild_id, i.player_id, i.status, i.created_at, i.message,
                  p.nickname AS target_name
             FROM public.guild_invites i
             LEFT JOIN public.players p ON p.id = i.player_id
            WHERE i.guild_id = ANY($1::bigint[]) AND i.status = 'pending'
            ORDER BY i.created_at DESC`,
          [ids]
        );
        invites = i.rows;
      }

      const guilds = rows.map((g) => ({
        id: String(g.id),
        name: g.name,
        slogan: g.slogan || '',
        colorKey: g.color_key,
        color: guildColor(g.color_key),
        leaderId: g.leader_player_id ? String(g.leader_player_id) : null,
        leaderName: g.leader_name || '（帮主已不存在）',
        memberCount: g.member_count,
        pendingInvites: g.pending_invites,
        createdAt: g.created_at,
        members: members
          .filter((m) => String(m.guild_id) === String(g.id))
          .map((m) => ({
            playerId: String(m.player_id),
            nickname: m.nickname || '未命名',
            region: m.region || '',
            role: m.role,
          })),
        invites: invites
          .filter((i) => String(i.guild_id) === String(g.id))
          .map((i) => ({ id: String(i.id), targetId: String(i.player_id), targetName: i.target_name || '未知' })),
      }));

      res.setHeader('Cache-Control', 'no-store');
      return ok(res, { guilds, colors: GUILD_COLOR_KEYS });
    }

    // 下面几个都会改动「前台看得见的东西」，统一清列表缓存
    if (req.method === 'PATCH') {
      const body = req.body || {};
      const id = String(body.id || '');
      if (!id) return bad(res, '缺少帮派 id');

      const checked = checkInput(body, { name: LIMITS.guildName, slogan: LIMITS.guildSlogan });
      if (!checked.ok) return bad(res, moderationMessage(checked));
      const name = checked.cleaned.name;
      const slogan = checked.cleaned.slogan;

      if (!name || !String(name).trim()) return bad(res, '帮派名不能为空');
      if (body.colorKey && !isGuildColor(body.colorKey)) return bad(res, '没有这支配色');

      const patch = await client.query(
        `UPDATE public.guilds
            SET name = $2, name_key = $3, slogan = $4,
                color_key = COALESCE($5, color_key), updated_at = now()
          WHERE id = $1
          RETURNING id`,
        [id, String(name).trim(), normalizeGuildName(name), slogan || null, body.colorKey || null]
      );
      if (patch.rowCount === 0) return bad(res, '这个帮派不存在', 404);
      clearPlayerListCache();
      return ok(res, { id });
    }

    if (req.method === 'POST') {
      const { action, guildId, playerId } = req.body || {};
      if (!guildId) return bad(res, '缺少 guildId');

      if (action === 'kick') {
        if (!playerId) return bad(res, '缺少要踢的人');
        const g = await client.query('SELECT leader_player_id FROM public.guilds WHERE id = $1', [guildId]);
        if (g.rowCount === 0) return bad(res, '这个帮派不存在', 404);
        if (String(g.rows[0].leader_player_id) === String(playerId)) {
          return bad(res, '帮主不能直接踢，先把帮派转给别人，或者整解散');
        }
        const del = await client.query(
          'DELETE FROM public.guild_members WHERE guild_id = $1 AND player_id = $2',
          [guildId, playerId]
        );
        if (del.rowCount === 0) return bad(res, '这个人不在该帮派里');
        clearPlayerListCache();
        return ok(res, { kicked: String(playerId) });
      }

      if (action === 'transfer') {
        if (!playerId) return bad(res, '缺少新帮主');
        const inGuild = await client.query(
          'SELECT 1 FROM public.guild_members WHERE guild_id = $1 AND player_id = $2',
          [guildId, playerId]
        );
        if (inGuild.rowCount === 0) return bad(res, '这个人不在该帮派里，不能当帮主');
        await client.query('BEGIN');
        try {
          await client.query(
            `UPDATE public.guild_members SET role = CASE WHEN player_id = $2 THEN 'leader' ELSE 'member' END
              WHERE guild_id = $1`,
            [guildId, playerId]
          );
          await client.query('UPDATE public.guilds SET leader_player_id = $2, updated_at = now() WHERE id = $1', [
            guildId,
            playerId,
          ]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
        clearPlayerListCache();
        return ok(res, { leaderId: String(playerId) });
      }

      if (action === 'clearInvites') {
        const del = await client.query(
          "DELETE FROM public.guild_invites WHERE guild_id = $1 AND status = 'pending'",
          [guildId]
        );
        return ok(res, { cleared: del.rowCount });
      }

      return bad(res, '不认识的操作：' + action);
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || (req.body && req.body.id) || '');
      if (!id) return bad(res, '缺少帮派 id');
      // 成员与邀请都是 ON DELETE CASCADE，删一行就干净了
      const del = await client.query('DELETE FROM public.guilds WHERE id = $1 RETURNING name', [id]);
      if (del.rowCount === 0) return bad(res, '这个帮派不存在', 404);
      clearPlayerListCache();
      return ok(res, { name: del.rows[0].name });
    }

    res.setHeader('Allow', ['GET', 'PATCH', 'POST', 'DELETE']);
    return res.status(405).json({ success: false, error: '不支持的请求方法' });
  } catch (e) {
    const friendly = shotAt(e);
    if (friendly) return bad(res, friendly);
    console.error('帮派管理接口出错:', e);
    return bad(res, e.message || '服务器出错了', 500);
  } finally {
    if (client) client.release();
  }
}
