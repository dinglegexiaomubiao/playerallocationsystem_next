import { pool } from '../../lib/db';
import { denyIfNotLoggedIn, isAdmin } from '../../lib/auth';
import { parseRegion } from '../../lib/regions';
import { checkText } from '../../lib/moderation.mjs';
import { aiModerate, aiModerationMessage } from '../../lib/ai-moderate.mjs';

// 美食 UGC 合规初筛：店名/菜系/地址/特色/推荐人/附近地标，命中违禁即拒绝
const checkFoodBody = (body) => {
  for (const key of ['name', 'cuisine', 'address', 'feature', 'recommender', 'nearby']) {
    const v = body[key];
    if (typeof v !== 'string' || !v.trim()) continue;
    const hit = checkText(v);
    if (!hit.ok) return { key, ...hit };
  }
  return null;
};

// AI 复审（DeepSeek）：超时/出错自动放行
const aiCheckFoodBody = async (body) => {
  const fields = {};
  for (const key of ['name', 'cuisine', 'address', 'feature', 'recommender', 'nearby']) {
    if (typeof body[key] === 'string' && body[key].trim()) fields[key] = body[key];
  }
  if (Object.keys(fields).length === 0) return null;
  const ai = await aiModerate(fields);
  return ai.ok ? null : ai;
};

let tableReady = false;

const ALTER_COLS = [
  'cuisine varchar(30)',
  'area varchar(50)',
  'feature varchar(300)',
  'nearby varchar(200)',
  'avg_price int4',
  // 2026-10-22：区位跟群友地区一样改成国/省/市/区四级。
  // ⚠ `area` 不能废掉：它同时是 Excel 导入的去重键（shopKey(name, area)），
  // 所以 area 继续只存区名，完整路径另存 region，两者由下面 areaFromRegion 对齐。
  'region varchar(50)',
  'lat numeric(9,6)',
  'lng numeric(9,6)',
];

/**
 * 从规范地区路径里取区名，保持 `area` 与 `region` 一致。
 * 取不到就返回 null，让调用方决定用不传。
 */
function areaFromRegion(region) {
  const p = parseRegion(region);
  if (!p.structured || p.foreign) return null;
  return p.district || null;
}

function str(v, n) {
  return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, n);
}
function toInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}
/** 经纬度：允许小数，空串/非数字一律 null（别把 '' 塞进 numeric 列） */
function num(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
        // 提交美食推荐需要登录（原先是 denyIfImportNotAdmin，
        // 不带 x-excel-import 头时会直接放行，导致匿名也能提交）
        if (denyIfNotLoggedIn(req, res, '请先登录后再推荐美食')) return;
        const body = req.body || {};
        if (!body.name || !String(body.name).trim()) {
          return res.status(400).json({ success: false, error: '店名不能为空' });
        }
        const bad = checkFoodBody(body);
        if (bad) return res.status(400).json({ success: false, error: `美食信息里检测到不合适的内容（${bad.category}），请修改后再提交` });
        const aiBad = await aiCheckFoodBody(body);
        if (aiBad) return res.status(400).json({ success: false, error: aiModerationMessage(aiBad) });
        const row = await client.query(
          `INSERT INTO public.foods (name, cuisine, area, region, address, feature, recommender, nearby, avg_price, rating, lat, lng)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            str(body.name, 100),
            str(body.cuisine, 30),
            // 传了 region 就以它为准反推 area，避免两个字段打架
            str(areaFromRegion(body.region) || body.area, 50),
            str(body.region, 50),
            str(body.address, 200),
            str(body.feature, 300),
            str(body.recommender, 50),
            str(body.nearby, 200),
            toInt(body.avg_price),
            clampRating(body.rating),
            num(body.lat),
            num(body.lng),
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
        const bad = checkFoodBody(body);
        if (bad) return res.status(400).json({ success: false, error: `美食信息里检测到不合适的内容（${bad.category}），请修改后再提交` });
        const aiBad = await aiCheckFoodBody(body);
        if (aiBad) return res.status(400).json({ success: false, error: aiModerationMessage(aiBad) });
        const row = await client.query(
          `UPDATE public.foods
           SET name=$1, cuisine=$2, area=$3, region=$4, address=$5, feature=$6, recommender=$7,
               nearby=$8, avg_price=$9, rating=$10, lat=$11, lng=$12
           WHERE id=$13 RETURNING *`,
          [
            str(body.name, 100),
            str(body.cuisine, 30),
            str(areaFromRegion(body.region) || body.area, 50),
            str(body.region, 50),
            str(body.address, 200),
            str(body.feature, 300),
            str(body.recommender, 50),
            str(body.nearby, 200),
            toInt(body.avg_price),
            clampRating(body.rating),
            num(body.lat),
            num(body.lng),
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
