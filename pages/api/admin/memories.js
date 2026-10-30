/**
 * 后台回忆管理：连软删的一起列出来，供人工核对「到底删没删掉」。
 *
 * 前台接口永远过滤 deleted_at，所以后台必须有自己的读法。
 * 删除动作复用同一套软删函数，不另写一份 SQL —— 两处逻辑一旦分开就会漂。
 */
import { denyIfNotAdmin } from '../../../lib/auth';
import { adminListMemories, softDeleteMemory, softDeleteComment } from '../../../lib/memories.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (denyIfNotAdmin(req, res, '只有管理员能管理回忆')) return;

  if (req.method === 'GET') {
    try {
      const memories = await adminListMemories({ limit: req.query.limit });
      return res.status(200).json({
        success: true,
        memories,
        total: memories.filter((m) => !m.deletedAt).length,
        deleted: memories.filter((m) => !!m.deletedAt).length,
      });
    } catch (e) {
      console.error('[admin/memories] 列表失败:', e);
      return res.status(500).json({ success: false, error: '服务器内部错误' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const id = String((req.body && req.body.id) || req.query.id || '');
      const cid = String((req.body && req.body.cid) || req.query.cid || '');
      const ok = cid
        ? await softDeleteComment(cid, 'admin')
        : await softDeleteMemory(id, 'admin');
      if (!ok) return res.status(404).json({ success: false, error: '这条已经不在了' });
      return res.status(200).json({ success: true });
    } catch (e) {
      console.error('[admin/memories] 删除失败:', e);
      return res.status(500).json({ success: false, error: '服务器内部错误' });
    }
  }

  res.setHeader('Allow', ['GET', 'DELETE']);
  return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
}
