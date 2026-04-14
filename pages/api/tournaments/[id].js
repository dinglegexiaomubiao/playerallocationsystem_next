// Next.js API route for managing individual tournament
import { pool } from '../../../lib/db';

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
        
        res.status(200).json({
          success: true,
          tournament: tournamentResult.rows[0]
        });
        break;
      }

      case 'PUT': {
        const updateData = req.body;
        
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
        break;
      }

      case 'DELETE': {
        // 先删除关联数据，再删除赛季本身
        await client.query('BEGIN');
        
        try {
          // 1. 删除 team_players 关联
          await client.query(
            `DELETE FROM public.team_players WHERE tournament_id = $1`,
            [id]
          );
          
          // 2. 删除 player_tournament_participations 关联
          await client.query(
            `DELETE FROM public.player_tournament_participations WHERE tournament_id = $1`,
            [id]
          );
          
          // 3. 删除 tournament_teams 关联
          await client.query(
            `DELETE FROM public.tournament_teams WHERE tournament_id = $1`,
            [id]
          );
          
          // 4. 删除该赛季下的队伍
          await client.query(
            `DELETE FROM public.teams WHERE tournament_id = $1`,
            [id]
          );
          
          // 5. 删除赛季
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
