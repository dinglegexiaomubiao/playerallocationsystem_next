/**
 * 单条回忆：GET 取详情，DELETE 软删（作者本人或管理员）。
 *
 * 删的权限判断用 author_id 和当前账号绑定的玩家 id 比，
 * 不比名字 —— 昵称可以改，改完就对不上了；而且重名会误删别人的回忆。
 */
import { getSession, isAdmin, denyIfNotLoggedIn } from '../../../../lib/auth';
import { memoryById, softDeleteMemory, authorOfAccount } from '../../../../lib/memories.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const id = String(req.query.id || '');
  if (!/^\d+$/.test(id)) return res.status(400).json({ success: false, error: '参数不正确' });

  if (req.method === 'GET') {
    try {
      const memory = await memoryById(id);
      if (!memory) return res.status(404).json({ success: false, error: '这条回忆已经不在了' });
      return res.status(200).json({ success: true, memory });
    } catch (e) {
      console.error('[memories] 详情查询失败:', e);
      return res.status(500).json({ success: false, error: '服务器内部错误' });
    }
  }

  if (req.method === 'DELETE') {
    const session = getSession(req);
    if (denyIfNotLoggedIn(req, res, '登录后才能删除')) return;

    try {
      const memory = await memoryById(id);
      if (!memory) return res.status(404).json({ success: false, error: '这条回忆已经不在了' });

      const admin = isAdmin(req);
      const me = await authorOfAccount(session && session.name);
      const mine = !!me.playerId && String(memory.author.playerId) === String(me.playerId);
      if (!admin && !mine) {
        return res.status(403).json({ success: false, error: '只能删自己发的回忆' });
      }

      const ok = await softDeleteMemory(id, (session && session.name) || 'admin');
      if (!ok) return res.status(404).json({ success: false, error: '这条回忆已经不在了' });
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error('[memories] 删除失败:', e);
      return res.status(500).json({ success: false, error: '服务器内部错误' });
    }
  }

  res.setHeader('Allow', ['GET', 'DELETE']);
  return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
}
