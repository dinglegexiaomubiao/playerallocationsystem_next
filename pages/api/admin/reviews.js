/**
 * 美食评价管理（管理员）。
 *
 * 评价原本只有两个用户侧入口：前台 `/food` 每条的「×」、以及跟着店铺一起被删。
 * 后台只显示条数，等于违规评价要一条条翻前台点掉 —— 36 条还翻得动，涨到几百条就没法弄了。
 *
 * 这里给全 CRUD，包含「代写」：群友在群里随口说「那家店我上周去了，一般」，
 * 以前得让他自己上站发，现在管理员可以代补一条（reviewer 写清是谁说的）。
 *
 * ⚠ food_reviews 没有 player_id，只有 reviewer 这个自由文本（历史就这样）。
 *   所以评价不挂人，代写时要自己把来源写清楚，别让人以为是匿名黑评。
 */
import { pool } from '../../../lib/db';
import { denyIfNotAdmin } from '../../../lib/auth';
import { checkInput, moderationMessage, LIMITS } from '../../../lib/moderation.mjs';

const ok = (res, data) => res.status(200).json({ success: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });

const clampRating = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(5, Math.round(n)));
};

export default async function handler(req, res) {
  if (denyIfNotAdmin(req, res)) return;

  try {
    if (req.method === 'GET') {
      const { rows } = await pool.query(`
        SELECT r.id, r.food_id, r.reviewer, r.content, r.rating, r.created_at,
               f.name AS food_name, f.area AS food_area
          FROM public.food_reviews r
          LEFT JOIN public.foods f ON f.id = r.food_id
         ORDER BY r.created_at DESC, r.id DESC
      `);
      const reviews = rows.map((r) => ({
        id: String(r.id),
        foodId: String(r.food_id),
        foodName: r.food_name || '（店已删）',
        foodArea: r.food_area || '',
        reviewer: r.reviewer || '',
        content: r.content || '',
        rating: r.rating,
        createdAt: r.created_at,
      }));
      const foods = await pool.query('SELECT id, name FROM public.foods ORDER BY name ASC');
      res.setHeader('Cache-Control', 'no-store');
      return ok(res, {
        reviews,
        foods: foods.rows.map((f) => ({ id: String(f.id), name: f.name })),
        // 只有分数没写内容的，通常是随手点的；列表里给个标记
        noContent: reviews.filter((r) => !r.content).length,
      });
    }

    if (req.method === 'POST' || req.method === 'PATCH') {
      const body = req.body || {};
      const checked = checkInput(body, {
        content: LIMITS.review,
        reviewer: LIMITS.nickname,
      });
      if (!checked.ok) return bad(res, moderationMessage(checked));

      const content = (checked.cleaned.content || '').trim();
      const reviewer = (checked.cleaned.reviewer || '').trim();
      const rating = clampRating(body.rating);

      if (req.method === 'POST') {
        const foodId = String(body.foodId || '');
        if (!foodId) return bad(res, '得先选是哪家店');
        if (!content && rating === null) return bad(res, '写点评或者打个分，总得有一个');
        const exists = await pool.query('SELECT 1 FROM public.foods WHERE id = $1', [foodId]);
        if (exists.rowCount === 0) return bad(res, '这家店不存在，可能刚被删了', 404);

        const add = await pool.query(
          `INSERT INTO public.food_reviews (food_id, reviewer, content, rating, created_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           RETURNING id`,
          [foodId, reviewer || null, content || null, rating]
        );
        return ok(res, { id: String(add.rows[0].id) });
      }

      const id = String(body.id || '');
      if (!id) return bad(res, '缺少评价 id');
      const upd = await pool.query(
        `UPDATE public.food_reviews SET reviewer = $2, content = $3, rating = $4 WHERE id = $1 RETURNING food_id`,
        [id, reviewer || null, content || null, rating]
      );
      if (upd.rowCount === 0) return bad(res, '这条评价不存在', 404);
      return ok(res, { id, foodId: String(upd.rows[0].food_id) });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || (req.body && req.body.id) || '');
      if (!id) return bad(res, '缺少评价 id');
      const del = await pool.query('DELETE FROM public.food_reviews WHERE id = $1 RETURNING food_id', [id]);
      if (del.rowCount === 0) return bad(res, '这条评价不存在', 404);
      return ok(res, { id, foodId: String(del.rows[0].food_id) });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
    return res.status(405).json({ success: false, error: '不支持的请求方法' });
  } catch (e) {
    console.error('评价管理接口出错:', e);
    return bad(res, e.message || '服务器出错了', 500);
  }
}
