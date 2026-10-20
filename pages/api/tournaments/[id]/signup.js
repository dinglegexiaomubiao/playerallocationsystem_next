// 赛事报名 / 退赛接口
// GET：查当前账号在本赛事的报名状态（未登录也返回 200，只是 loggedIn=false）
// POST：报名（自动通过，生成赛事选手快照）
// DELETE：退赛
import { pool } from '../../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../../lib/auth';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, error: '缺少赛季ID' });

  // GET 要能被匿名调用（页面只是想知道「我报名了没」），所以不能走统一的登录闸门
  if (req.method === 'GET') {
    const session = getSession(req);
    if (!session || !session.name) {
      return res.status(200).json({ success: true, loggedIn: false, signedUp: false, signup: null });
    }
    const client = await pool.connect();
    try {
      const acct = await client.query('SELECT player_id FROM public.play_score WHERE name = $1', [session.name]);
      const playerId = acct.rows[0]?.player_id;
      if (!playerId) {
        return res.status(200).json({ success: true, loggedIn: true, bound: false, signedUp: false, signup: null });
      }
      const row = await client.query(
        'SELECT * FROM public.tournament_players WHERE player_id = $1 AND tournament_id = $2',
        [playerId, id]
      );
      return res.status(200).json({
        success: true,
        loggedIn: true,
        bound: true,
        playerId: String(playerId),
        signedUp: row.rows.length > 0,
        isCaptain: row.rows.length > 0 ? Boolean(row.rows[0].is_captain) : false,
        signup: row.rows[0] || null,
      });
    } catch (error) {
      console.error('查询报名状态失败:', error);
      return res.status(500).json({ success: false, error: '查询报名状态失败' });
    } finally {
      client.release();
    }
  }

  if (denyIfNotLoggedIn(req, res)) return;

  const session = getSession(req);
  const client = await pool.connect();

  try {
    if (req.method === 'POST') {
      // 找到当前账号绑定的选手
      const acct = await client.query(
        'SELECT player_id FROM public.play_score WHERE name = $1',
        [session.name]
      );
      const playerId = acct.rows[0]?.player_id;
      if (!playerId) {
        return res.status(400).json({
          success: false,
          error: '你的账号还未绑定选手资料，请先在个人信息页补填',
        });
      }

      // 取全局选手资料，作为快照来源
      const ply = await client.query('SELECT * FROM public.players WHERE id = $1', [playerId]);
      if (ply.rows.length === 0) {
        return res.status(404).json({ success: false, error: '选手资料不存在' });
      }
      const p = ply.rows[0];

      // 幂等：已报名则直接返回，不重复建快照
      const existing = await client.query(
        'SELECT * FROM public.tournament_players WHERE player_id = $1 AND tournament_id = $2',
        [playerId, id]
      );
      if (existing.rows.length > 0) {
        return res.status(200).json({
          success: true,
          message: '已报名，无需重复',
          signup: existing.rows[0],
        });
      }

      const inserted = await client.query(
        `INSERT INTO public.tournament_players
           (player_id, tournament_id, score, positions, heroes, region, self_intro, enemies, signup_status, signed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'approved',CURRENT_TIMESTAMP)
         RETURNING *`,
        [playerId, id, p.score, p.positions, p.heroes, p.region, p.self_intro, p.enemies]
      );

      return res.status(201).json({ success: true, signup: inserted.rows[0] });
    }

    if (req.method === 'DELETE') {
      const acct = await client.query(
        'SELECT player_id FROM public.play_score WHERE name = $1',
        [session.name]
      );
      const playerId = acct.rows[0]?.player_id;
      if (!playerId) {
        return res.status(400).json({ success: false, error: '未绑定选手资料' });
      }

      const del = await client.query(
        `DELETE FROM public.tournament_players
         WHERE player_id = $1 AND tournament_id = $2 AND is_captain = false
         RETURNING id`,
        [playerId, id]
      );
      if (del.rowCount === 0) {
        return res.status(400).json({
          success: false,
          error: '退赛失败（未报名，或身为队长需先卸任）',
        });
      }
      return res.status(200).json({ success: true, message: '已退赛' });
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    console.error('报名操作错误:', error);
    return res.status(500).json({ success: false, error: '报名操作失败' });
  } finally {
    client.release();
  }
}
