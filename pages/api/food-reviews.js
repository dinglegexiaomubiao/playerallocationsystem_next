import { pool } from '../../lib/db';
import { denyIfNotLoggedIn, isAdmin } from '../../lib/auth';
import { checkText, LIMITS } from '../../lib/moderation.mjs';
import { aiModerate, aiModerationMessage, openidOf } from '../../lib/ai-moderate.mjs';

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
        // 提交评价需要登录（原先的 denyIfImportNotAdmin 在不带 x-excel-import 头时会放行，匿名也能评）
        if (denyIfNotLoggedIn(req, res, '请先登录后再发表评价')) return;
        const body = req.body || {};
        if (!body.food_id) return res.status(400).json({ success: false, error: '缺少 food_id' });
        if (!body.content || !String(body.content).trim()) {
          return res.status(400).json({ success: false, error: '评价内容不能为空' });
        }
        // UGC 合规初筛：评价 / 署名
        const hitC = checkText(body.content);
        if (!hitC.ok) return res.status(400).json({ success: false, error: `评价里检测到不合适的内容（${hitC.category}），请修改后再提交` });
        if (body.reviewer) {
          const hitR = checkText(body.reviewer);
          if (!hitR.ok) return res.status(400).json({ success: false, error: `署名里检测到不合适的内容（${hitR.category}），请修改后再提交` });
        }
        // AI 复审（DeepSeek）：超时/出错自动放行
        const ai = await aiModerate({ 评价: body.content, 署名: body.reviewer || '' }, { openid: openidOf(req) });
        if (!ai.ok) return res.status(400).json({ success: false, error: aiModerationMessage(ai) });
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
        if (!isAdmin(req)) {
          return res.status(403).json({ success: false, error: '仅管理员可删除评价' });
        }
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
