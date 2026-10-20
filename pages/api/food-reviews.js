import { pool } from '../../lib/db';

function clampRating(v) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return 5;
  return Math.max(1, Math.min(5, n));
}

export default async function handler(req, res) {
  const client = await pool.connect();
  try {
    // 确保表存在（若尚未访问过 /api/foods）
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.food_reviews (
        id bigserial PRIMARY KEY,
        food_id bigint NOT NULL,
        reviewer varchar(50),
        content varchar(300),
        rating int4,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP
      );
    `);

    switch (req.method) {
      case 'POST': {
        const body = req.body || {};
        if (!body.food_id) return res.status(400).json({ success: false, error: '缺少 food_id' });
        if (!body.content || !String(body.content).trim()) {
          return res.status(400).json({ success: false, error: '评价内容不能为空' });
        }
        const row = await client.query(
          `INSERT INTO public.food_reviews (food_id, reviewer, content, rating)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [
            body.food_id,
            body.reviewer ? String(body.reviewer).trim().slice(0, 50) : null,
            String(body.content).trim().slice(0, 300),
            clampRating(body.rating),
          ]
        );
        return res.status(201).json({ success: true, review: row.rows[0] });
      }
      case 'DELETE': {
        const body = req.body || {};
        if (!body.id) return res.status(400).json({ success: false, error: '缺少 id' });
        await client.query('DELETE FROM public.food_reviews WHERE id = $1', [body.id]);
        return res.status(200).json({ success: true });
      }
      default:
        res.setHeader('Allow', ['POST', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (e) {
    console.error('美食评价 API 错误:', e);
    return res.status(500).json({ success: false, error: '服务器内部错误: ' + e.message });
  } finally {
    client.release();
  }
}
