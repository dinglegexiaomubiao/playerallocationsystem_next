import { pool } from '../../lib/db';
import { denyIfImportNotAdmin, isAdmin } from '../../lib/auth';

let tableReady = false;

const ALTER_COLS = [
  'cuisine varchar(30)',
  'area varchar(50)',
  'feature varchar(300)',
  'nearby varchar(200)',
  'avg_price int4',
];

function str(v, n) {
  return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, n);
}
function toInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
function clampRating(v) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return 5;
  return Math.max(1, Math.min(5, n));
}

async function ensureTable() {
  if (tableReady) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.foods (
        id bigserial PRIMARY KEY,
        name varchar(100) NOT NULL,
        cuisine varchar(30),
        area varchar(50),
        address varchar(200),
        feature varchar(300),
        recommender varchar(50),
        nearby varchar(200),
        avg_price int4,
        rating int4 DEFAULT 5,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP
      );
    `);
    for (const col of ALTER_COLS) {
      await client.query(`ALTER TABLE public.foods ADD COLUMN IF NOT EXISTS ${col}`);
    }
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
    tableReady = true;
  } finally {
    client.release();
  }
}

export default async function handler(req, res) {
  try {
    await ensureTable();
  } catch (e) {
    return res.status(500).json({ success: false, error: '初始化美食表失败: ' + e.message });
  }

  const client = await pool.connect();
  try {
    switch (req.method) {
      case 'GET': {
        const foods = await client.query('SELECT * FROM public.foods ORDER BY created_at DESC');
        const reviews = await client.query('SELECT * FROM public.food_reviews ORDER BY created_at ASC');
        const byFood = {};
        for (const r of reviews.rows) {
          (byFood[r.food_id] = byFood[r.food_id] || []).push(r);
        }
        const list = foods.rows.map((f) => ({ ...f, reviews: byFood[f.id] || [] }));
        return res.status(200).json({ success: true, foods: list });
      }
      case 'POST': {
        if (denyIfImportNotAdmin(req, res)) return;
        const body = req.body || {};
        if (!body.name || !String(body.name).trim()) {
          return res.status(400).json({ success: false, error: '店名不能为空' });
        }
        const row = await client.query(
          `INSERT INTO public.foods (name, cuisine, area, address, feature, recommender, nearby, avg_price, rating)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [
            str(body.name, 100),
            str(body.cuisine, 30),
            str(body.area, 50),
            str(body.address, 200),
            str(body.feature, 300),
            str(body.recommender, 50),
            str(body.nearby, 200),
            toInt(body.avg_price),
            clampRating(body.rating),
          ]
        );
        return res.status(201).json({ success: true, food: { ...row.rows[0], reviews: [] } });
      }
      case 'PUT': {
        if (!isAdmin(req)) {
          return res.status(403).json({ success: false, error: '仅管理员可编辑美食' });
        }
        const body = req.body || {};
        if (!body.id) return res.status(400).json({ success: false, error: '缺少 id' });
        if (!body.name || !String(body.name).trim()) {
          return res.status(400).json({ success: false, error: '店名不能为空' });
        }
        const row = await client.query(
          `UPDATE public.foods
           SET name=$1, cuisine=$2, area=$3, address=$4, feature=$5, recommender=$6, nearby=$7, avg_price=$8, rating=$9
           WHERE id=$10 RETURNING *`,
          [
            str(body.name, 100),
            str(body.cuisine, 30),
            str(body.area, 50),
            str(body.address, 200),
            str(body.feature, 300),
            str(body.recommender, 50),
            str(body.nearby, 200),
            toInt(body.avg_price),
            clampRating(body.rating),
            body.id,
          ]
        );
        if (row.rowCount === 0) return res.status(404).json({ success: false, error: '记录不存在' });
        return res.status(200).json({ success: true, food: row.rows[0] });
      }
      case 'DELETE': {
        if (!isAdmin(req)) {
          return res.status(403).json({ success: false, error: '仅管理员可删除美食' });
        }
        const body = req.body || {};
        if (!body.id) return res.status(400).json({ success: false, error: '缺少 id' });
        await client.query('DELETE FROM public.food_reviews WHERE food_id = $1', [body.id]);
        await client.query('DELETE FROM public.foods WHERE id = $1', [body.id]);
        return res.status(200).json({ success: true });
      }
      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (e) {
    console.error('美食 API 错误:', e);
    return res.status(500).json({ success: false, error: '服务器内部错误: ' + e.message });
  } finally {
    client.release();
  }
}
