/**
 * 后台「语录评价管理」专用接口（管理员权限）。
 *
 * GET   列出全部评价（按时间倒序），含语录摘要与被评价人。
 * DELETE 删一条评价。走 lib/quotes.mjs 的 deleteReview，强制 isAdmin=true，
 *        所以不做「只能删自己」的判定。
 */
import { getSession, isAdmin } from '../../../lib/auth';
import { listAllReviews, deleteReview } from '../../../lib/quotes.mjs';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: '请先登录' });
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: '仅管理员可访问' });

  try {
    if (req.method === 'GET') {
      const data = await listAllReviews({ limit: 100, offset: 0 });
      return res.status(200).json({ ok: true, ...data });
    }

    if (req.method === 'DELETE') {
      const id = String((req.body || {}).id || '');
      if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: '缺少有效的 id' });
      const result = await deleteReview(id, { byId: null, isAdmin: true });
      if (!result.found) return res.status(404).json({ ok: false, error: '这条评价已经不在了' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', ['GET', 'DELETE']);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    console.error('后台语录评价管理失败:', e);
    return res.status(500).json({ ok: false, error: '操作失败：' + e.message });
  }
}
