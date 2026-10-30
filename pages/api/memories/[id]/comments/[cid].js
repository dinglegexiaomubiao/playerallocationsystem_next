/**
 * 删一条评论：评论作者本人或管理员。
 *
 * 路径里同时带 memoryId 和 commentId，是为了校验评论确实挂在这条回忆下 ——
 * 否则拿 A 回忆的 id 配 B 回忆的评论 id 也能删，越权面变大。
 */
import { getSession, isAdmin, denyIfNotLoggedIn } from '../../../../../lib/auth';
import { commentById, softDeleteComment, authorOfAccount } from '../../../../../lib/memories.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  }

  const memoryId = String(req.query.id || '');
  const cid = String(req.query.cid || '');
  if (!/^\d+$/.test(memoryId) || !/^\d+$/.test(cid)) {
    return res.status(400).json({ success: false, error: '参数不正确' });
  }

  const session = getSession(req);
  if (denyIfNotLoggedIn(req, res, '登录后才能删除')) return;

  try {
    const comment = await commentById(cid);
    if (!comment || String(comment.memoryId) !== memoryId) {
      return res.status(404).json({ success: false, error: '这条评论已经不在了' });
    }

    const admin = isAdmin(req);
    const me = await authorOfAccount(session && session.name);
    const mine = !!me.playerId && String(comment.authorId) === String(me.playerId);
    if (!admin && !mine) {
      return res.status(403).json({ success: false, error: '只能删自己的评论' });
    }

    const ok = await softDeleteComment(cid, (session && session.name) || 'admin');
    if (!ok) return res.status(404).json({ success: false, error: '这条评论已经不在了' });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[memories] 删评论失败:', e);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  }
}
