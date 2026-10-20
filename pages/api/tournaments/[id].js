// Next.js API route for managing individual tournament
import { pool } from '../../../lib/db';
import { denyIfNotAdmin } from '../../../lib/auth';

export default async function handler(req, res) {
  const { method } = req;
  const { id } = req.query;
  const client = await pool.connect();

  try {
    switch (method) {
      case 'GET': {
        // 获取指定赛季信息
        const tournamentResult = await client.query(
          `SELECT 
            id, 
            name, 
            start_date, 
            end_date, 
            champion_team_id, 
            runner_up_team_id,
            third_place_team_id,
            sponsor_info,
            champion_prize,
            runner_up_prize,
            status,
            created_at
          FROM public.tournaments 
          WHERE id = $1`,
          [id]
        );
        
        if (tournamentResult.rowCount === 0) {
          return res.status(404).json({
            success: false,
            message: '赛季未找到'
          });
        }
        
        const tournament = tournamentResult.rows[0];

        // 聚合报名名单（赛事选手快照，含队长标记）
        const signups = await client.query(
          `SELECT tp.*, p.nickname, p.group_nickname, p.game_id
           FROM public.tournament_players tp
           JOIN public.players p ON p.id = tp.player_id
           WHERE tp.tournament_id = $1
           ORDER BY tp.signed_at ASC`,
          [id]
        );

        // 聚合队伍（含队长昵称与成员数）
        const teams = await client.query(
          `SELECT t.*, p.nickname AS captain_nickname,
                  (SELECT count(*) FROM public.team_players tp WHERE tp.team_id = t.id) AS member_count
           FROM public.teams t
           LEFT JOIN public.players p ON p.id = t.captain_id
           WHERE t.tournament_id = $1
           ORDER BY t.id ASC`,
          [id]
        );

        res.status(200).json({
          success: true,
          tournament,
          signups: signups.rows,
          teams: teams.rows,
        });
        break;
      }

      case 'PUT': {
        if (denyIfNotAdmin(req, res, '仅管理员可修改赛事信息')) break;
        const updateData = req.body;
        console.log('PUT tournaments/[id] - updateData:', JSON.stringify(updateData), 'id:', id);

        if (!id) {
          return res.status(400).json({
            success: false,
            message: '缺少赛季ID'
          });
        }

        // 允许的更新字段白名单，防止 SQL 注入
        const allowedFields = [
          'name', 'start_date', 'end_date', 'champion_team_id',
          'runner_up_team_id', 'third_place_team_id', 'sponsor_info',
          'champion_prize', 'runner_up_prize', 'status'
        ];

        const fields = Object.keys(updateData).filter(key => allowedFields.includes(key));

        if (fields.length === 0) {
          return res.status(400).json({
            success: false,
            message: '没有可更新的有效字段'
          });
        }

        const values = fields.map(field => updateData[field]);
        const setClause = fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
        values.push(id);

        console.log('PUT SQL setClause:', setClause, 'values:', values);

        try {
          const updateResult = await client.query(
            `UPDATE public.tournaments
             SET ${setClause}
             WHERE id = $${values.length}
             RETURNING *`,
            values
          );

          if (updateResult.rowCount === 0) {
            return res.status(404).json({
              success: false,
              message: '赛季未找到'
            });
          }

          res.status(200).json({
            success: true,
            tournament: updateResult.rows[0]
          });
        } catch (queryError) {
          console.error('PUT tournament query error:', queryError.message);
          console.error('PUT tournament query detail:', queryError.detail);
          return res.status(500).json({
            success: false,
            message: '数据库更新失败: ' + queryError.message
          });
        }
        break;
      }

      case 'DELETE': {
        if (denyIfNotAdmin(req, res, '仅管理员可删除赛季')) break;
        // 先删除关联数据，再删除赛季本身
        await client.query('BEGIN');
        
        try {
          // 1. 删除赛程结果（matches / tournament_rounds）
          await client.query(
            `DELETE FROM public.matches WHERE tournament_id = $1`,
            [id]
          );
          await client.query(
            `DELETE FROM public.tournament_rounds WHERE tournament_id = $1`,
            [id]
          );

          // 2. 删除该赛季下的队伍成员关系（team_players）
          await client.query(
            `DELETE FROM public.team_players WHERE tournament_id = $1`,
            [id]
          );

          // 3. 删除赛事报名快照（tournament_players）
          await client.query(
            `DELETE FROM public.tournament_players WHERE tournament_id = $1`,
            [id]
          );

          // 4. 删除历史关联表（老体系）
          await client.query(
            `DELETE FROM public.player_tournament_participations WHERE tournament_id = $1`,
            [id]
          );
          await client.query(
            `DELETE FROM public.tournament_teams WHERE tournament_id = $1`,
            [id]
          );

          // 5. 删除该赛季下的队伍
          await client.query(
            `DELETE FROM public.teams WHERE tournament_id = $1`,
            [id]
          );
          
          // 6. 删除赛季
          const deleteResult = await client.query(
            'DELETE FROM public.tournaments WHERE id = $1 RETURNING id',
            [id]
          );
          
          if (deleteResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
              success: false,
              message: '赛季未找到'
            });
          }
          
          await client.query('COMMIT');
          
          res.status(200).json({
            success: true,
            message: '赛季删除成功'
          });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
        break;
      }

      default:
        res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
        res.status(405).end(`Method ${method} Not Allowed`);
    }
  } catch (error) {
    console.error('Tournament API error:', error);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
}
