// Next.js API route for tournaments management
import { Pool } from 'pg';

// 创建数据库连接池
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_Nt7YOz4wIJcT@ep-withered-recipe-a1wny5so-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  const { method } = req;
  const client = await pool.connect();

  try {
    switch (method) {
      case 'GET':
        // 获取所有赛季信息
        const tournamentsResult = await client.query(`
          SELECT 
            id, 
            name, 
            start_date, 
            end_date, 
            champion_team_id, 
            runner_up_team_id,
            sponsor_info,
            champion_prize,
            runner_up_prize,
            status,
            created_at
          FROM public.tournaments 
          ORDER BY id
        `);
        
        res.status(200).json({
          success: true,
          tournaments: tournamentsResult.rows
        });
        break;

      case 'POST':
        // 创建新赛季
        const { name, start_date, end_date } = req.body;
        
        if (!name) {
          return res.status(400).json({
            success: false,
            message: '赛季名称不能为空'
          });
        }
        
        const insertResult = await client.query(
          `INSERT INTO public.tournaments 
           (name, start_date, end_date, status, created_at) 
           VALUES ($1, $2, $3, $4, $5) 
           RETURNING *`,
          [name, start_date, end_date, 'planned', new Date().toISOString()]
        );
        
        res.status(201).json({
          success: true,
          tournament: insertResult.rows[0]
        });
        break;

      case 'PUT':
        // 更新赛季信息
        const { id } = req.query;
        const updateData = req.body;
        
        if (!id) {
          return res.status(400).json({
            success: false,
            message: '缺少赛季ID'
          });
        }
        
        // 构建动态更新语句
        const fields = Object.keys(updateData);
        const values = Object.values(updateData);
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