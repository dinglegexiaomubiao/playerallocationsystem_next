// 指定队长接口（管理员）：PUT 指定某选手为队长，并自动生成对应队伍
import { pool } from '../../../../lib/db';
import { denyIfNotAdmin } from '../../../../lib/auth';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, error: '缺少赛季ID' });

  if (denyIfNotAdmin(req, res, '仅管理员可指定队长')) return;

  const client = await pool.connect();
  try {
    if (req.method === 'PUT') {
      const { playerId } = req.body;
      if (!playerId) {
        return res.status(400).json({ success: false, error: '缺少选手ID' });
      }

      await client.query('BEGIN');

      // 1. 该选手必须已报名本赛事
      const signup = await client.query(
        'SELECT * FROM public.tournament_players WHERE player_id = $1 AND tournament_id = $2',
        [playerId, id]
      );
      if (signup.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: '该选手尚未报名本赛事' });
      }

      // 2. 标记为队长
      await client.query(
        'UPDATE public.tournament_players SET is_captain = true WHERE player_id = $1 AND tournament_id = $2',
        [playerId, id]
      );

      // 3. 自动生成队伍（幂等：该选手在本赛事已有队伍则复用）
      const existingTeam = await client.query(
        'SELECT * FROM public.teams WHERE tournament_id = $1 AND captain_id = $2',
        [id, playerId]
      );
      let team;
      if (existingTeam.rows.length > 0) {
        team = existingTeam.rows[0];
      } else {
        // 队名默认「选手昵称 + 队」
        const ply = await client.query('SELECT nickname FROM public.players WHERE id = $1', [playerId]);
        const teamName = (ply.rows[0]?.nickname || '未命名') + '队';
        const inserted = await client.query(
          `INSERT INTO public.teams (name, tournament_id, captain_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $4) RETURNING *`,
          [teamName, id, playerId, new Date().toISOString()]
        );
        team = inserted.rows[0];
      }

      // 4. 队长本人也自动加入 team_players（幂等）
      const alreadyMember = await client.query(
        'SELECT id FROM public.team_players WHERE team_id = $1 AND player_id = $2 AND tournament_id = $3',
        [team.id, playerId, id]
      );
      if (alreadyMember.rows.length === 0) {
        await client.query(
          `INSERT INTO public.team_players (team_id, player_id, tournament_id, created_at)
           VALUES ($1, $2, $3, $4)`,
          [team.id, playerId, id, new Date().toISOString()]
        );
      }

      await client.query('COMMIT');
      return res.status(200).json({ success: true, team });
    }

    if (req.method === 'DELETE') {
      // 卸任队长（不删队伍，只清空 is_captain 与队伍的 captain_id）
      const { playerId } = req.body;
      await client.query('BEGIN');
      await client.query(
        'UPDATE public.tournament_players SET is_captain = false WHERE player_id = $1 AND tournament_id = $2',
        [playerId, id]
      );
      await client.query(
        'UPDATE public.teams SET captain_id = NULL WHERE tournament_id = $1 AND captain_id = $2',
        [id, playerId]
      );
      await client.query('COMMIT');
      return res.status(200).json({ success: true, message: '已卸任队长' });
    }

    res.setHeader('Allow', ['PUT', 'DELETE']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('指定队长错误:', error);
    return res.status(500).json({ success: false, error: '指定队长失败' });
  } finally {
    client.release();
  }
}
