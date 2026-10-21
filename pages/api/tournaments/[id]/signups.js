// 赛事报名名单管理接口（管理员专用）
//
// 与 signup.js 的分工：
//   signup.js  —— 本人报名 / 本人退赛（登录即可，只能动自己那一条）
//   signups.js —— 管理员维护任意名单（代加人、代删人、改快照、指定队长）
//
// GET    报名名单（含选手昵称）+ 还没报名的候选选手
// POST   批量把选手加入名单（从 players 复制快照，幂等）
// PUT    改某条报名快照的分数 / 位置 / 地区 / 简介 / 报名状态
// DELETE 从名单移除（若此人是队长，同步清空 is_captain 与队伍 captain_id）
import { pool } from '../../../../lib/db';
import { denyIfNotAdmin } from '../../../../lib/auth';

// 允许管理员改的快照字段，白名单防注入
const EDITABLE_FIELDS = ['score', 'positions', 'region', 'self_intro', 'signup_status'];

// 「在报名名单里」的选手 id（统一转字符串，前端也用字符串比）
const SIGNED_SUBQUERY = `
  SELECT player_id FROM public.tournament_players WHERE tournament_id = $1
`;

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, error: '缺少赛季ID' });

  if (denyIfNotAdmin(req, res, '仅管理员可维护报名名单')) return;

  const client = await pool.connect();
  try {
    // ---------- 查名单 + 候选 ----------
    if (req.method === 'GET') {
      // 快照可能缺分数/位置/地区（加人时档案还没填、或老数据补录），
      // 这里把档案当前值一并带出（profile_*），给后台「从档案补全缺漏」用。
      const signups = await client.query(
        `SELECT tp.*, p.nickname, p.group_nickname, p.game_id,
                p.score AS profile_score, p.positions AS profile_positions, p.region AS profile_region
           FROM public.tournament_players tp
           JOIN public.players p ON p.id = tp.player_id
          WHERE tp.tournament_id = $1
          ORDER BY tp.is_captain DESC NULLS LAST, tp.signed_at ASC`,
        [id]
      );

      // 候选：还没进名单的选手。前端「＋ 加入名单」的下拉就吃这个。
      const candidates = await client.query(
        `SELECT p.id, p.nickname, p.group_nickname, p.game_id, p.score, p.positions
           FROM public.players p
          WHERE p.id NOT IN (${SIGNED_SUBQUERY})
          ORDER BY p.nickname ASC`,
        [id]
      );

      return res.status(200).json({
        success: true,
        signups: signups.rows,
        candidates: candidates.rows,
      });
    }

    // ---------- 批量加人 ----------
    if (req.method === 'POST') {
      const rawIds = req.body?.playerIds ?? (req.body?.playerId != null ? [req.body.playerId] : []);
      const playerIds = (Array.isArray(rawIds) ? rawIds : [])
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v > 0);

      if (playerIds.length === 0) {
        return res.status(400).json({ success: false, error: '请选择要加入名单的选手' });
      }

      // 直接从 players 复制一份快照，保证之后选手改资料不会篡改历史赛季数据
      // ON CONFLICT 让重复点击「加入」变成无害操作
      const inserted = await client.query(
        `INSERT INTO public.tournament_players
           (player_id, tournament_id, score, positions, heroes, region, self_intro, enemies, signup_status, signed_at)
         SELECT p.id, $1, p.score, p.positions, p.heroes, p.region, p.self_intro, p.enemies, 'approved', CURRENT_TIMESTAMP
           FROM public.players p
          WHERE p.id = ANY($2::bigint[])
         ON CONFLICT (player_id, tournament_id) DO NOTHING
         RETURNING player_id`,
        [id, playerIds]
      );

      return res.status(201).json({
        success: true,
        added: inserted.rows.length,
        skipped: playerIds.length - inserted.rows.length,
      });
    }

    // ---------- 改报名快照 ----------
    if (req.method === 'PUT') {
      const playerId = Number(req.body?.playerId);
      if (!Number.isFinite(playerId) || playerId <= 0) {
        return res.status(400).json({ success: false, error: '缺少选手ID' });
      }

      const fields = Object.keys(req.body || {}).filter((k) => EDITABLE_FIELDS.includes(k));
      if (fields.length === 0) {
        return res.status(400).json({ success: false, error: '没有可更新的有效字段' });
      }

      const values = fields.map((f) => (req.body[f] === '' ? null : req.body[f]));
      const setClause = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
      values.push(playerId, id);

      const updated = await client.query(
        `UPDATE public.tournament_players
            SET ${setClause}
          WHERE player_id = $${values.length - 1} AND tournament_id = $${values.length}
          RETURNING *`,
        values
      );

      if (updated.rowCount === 0) {
        return res.status(404).json({ success: false, error: '该选手不在本赛事报名名单中' });
      }
      return res.status(200).json({ success: true, signup: updated.rows[0] });
    }

    // ---------- 移除报名 ----------
    if (req.method === 'DELETE') {
      const playerId = Number(req.body?.playerId);
      if (!Number.isFinite(playerId) || playerId <= 0) {
        return res.status(400).json({ success: false, error: '缺少选手ID' });
      }

      await client.query('BEGIN');

      // 队长被移除时必须先解绑，否则 teams.captain_id 会指向一个已退赛的人
      await client.query(
        'UPDATE public.teams SET captain_id = NULL WHERE tournament_id = $1 AND captain_id = $2',
        [id, playerId]
      );
      // 顺带清掉该队里属于此人的成员记录，避免留下「幽灵队员」
      await client.query(
        'DELETE FROM public.team_players WHERE tournament_id = $1 AND player_id = $2',
        [id, playerId]
      );

      const del = await client.query(
        'DELETE FROM public.tournament_players WHERE player_id = $1 AND tournament_id = $2 RETURNING id',
        [playerId, id]
      );

      if (del.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: '该选手不在本赛事报名名单中' });
      }

      await client.query('COMMIT');
      return res.status(200).json({ success: true, message: '已从报名名单移除' });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('报名名单管理错误:', error);
    return res.status(500).json({ success: false, error: '报名名单操作失败：' + error.message });
  } finally {
    client.release();
  }
}
