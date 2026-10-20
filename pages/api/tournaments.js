// Next.js API route for tournaments management
import { pool } from '../../lib/db';
import { denyIfNotLoggedIn, denyIfNotAdmin, denyIfImportNotAdmin } from '../../lib/auth';

// POST 可写入的字段。单条「新建赛季」只传 name/起止日期，
// Excel 批量导入会带上状态、赞助、奖金等完整信息，所以这里统一收口。
const CREATABLE_FIELDS = [
  'name', 'start_date', 'end_date', 'status',
  'sponsor_info', 'champion_prize', 'runner_up_prize',
  'champion_team_id', 'runner_up_team_id', 'third_place_team_id',
];

export default async function handler(req, res) {
  const { method } = req;
  const client = await pool.connect();

  try {
    switch (method) {
      case 'GET': {
        // 额外带出冠/亚/季的队伍名：导出 Excel 时表格里要写队名而不是 id，
        // 否则 N 个赛季就得发 N 次 /api/teams 请求
        const tournamentsResult = await client.query(`
          SELECT 
            t.id, 
            t.name, 
            t.start_date, 
            t.end_date, 
            t.champion_team_id, 
            t.runner_up_team_id,
            t.third_place_team_id,
            t.sponsor_info,
            t.champion_prize,
            t.runner_up_prize,
            t.status,
            t.created_at,
            tc.name AS champion_team_name,
            tr.name AS runner_up_team_name,
            tt.name AS third_place_team_name
          FROM public.tournaments t
          -- 只认本赛事的队伍：库里存在指向别的赛事队伍的历史脏数据
          LEFT JOIN public.teams tc ON tc.id = t.champion_team_id AND tc.tournament_id = t.id
          LEFT JOIN public.teams tr ON tr.id = t.runner_up_team_id AND tr.tournament_id = t.id
          LEFT JOIN public.teams tt ON tt.id = t.third_place_team_id AND tt.tournament_id = t.id
          -- 排序：先按起止时间倒序（最近结束/开始的在上），没有日期的排后面；
          -- 时间相同或都为空时，按赛季名称升序。
          -- 用 end_date 优先、start_date 兜底，比只看 start_date 更符合"最近办完的在上"的直觉。
          ORDER BY
            COALESCE(t.end_date, t.start_date) DESC NULLS LAST,
            t.name ASC
        `);
        
        res.status(200).json({
          success: true,
          tournaments: tournamentsResult.rows
        });
        break;
      }

      case 'POST': {
        if (denyIfNotLoggedIn(req, res)) break;
        // 带 x-excel-import: 1 的批量导入必须是管理员
        if (denyIfImportNotAdmin(req, res)) break;

        const body = req.body || {};
        const name = body.name;
        if (!name || !String(name).trim()) {
          return res.status(400).json({
            success: false,
            message: '赛季名称不能为空'
          });
        }

        const fields = CREATABLE_FIELDS.filter((f) => body[f] !== undefined);
        const values = fields.map((f) => {
          const v = body[f];
          return v === '' ? null : v;
        });
        // 状态没传时按老行为落 planning
        if (!fields.includes('status')) {
          fields.push('status');
          values.push('planning');
        }
        fields.push('created_at');
        values.push(new Date().toISOString());

        const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
        const insertResult = await client.query(
          `INSERT INTO public.tournaments (${fields.join(', ')})
           VALUES (${placeholders})
           RETURNING *`,
          values
        );
        
        res.status(201).json({
          success: true,
          tournament: insertResult.rows[0]
        });
        break;
      }

      case 'PUT': {
        if (denyIfNotAdmin(req, res, '仅管理员可修改赛事信息')) break;
        const { id } = req.query;
        const updateData = req.body;
        
        if (!id) {
          return res.status(400).json({
            success: false,
            message: '缺少赛季ID'
          });
        }
        
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

      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT']);
        res.status(405).end(`Method ${method} Not Allowed`);
    }
  } catch (error) {
    console.error('Tournaments API error:', error);
    res.status(500).json({
      success: false,
      message: '服务器内部错误',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    client.release();
  }
}
