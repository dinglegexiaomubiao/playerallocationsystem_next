/**
 * 「谁可以改回忆文案」的名单：站长指定几个可以代改文案的人（校对/版主）。
 *
 * 只解文案这一个动作 —— 名单里的人改得了字，删不了回忆、进不了后台。
 * 权限判断在 pages/api/memories/[id]/index.js 里做，这里只管维护名单本身。
 */
import { denyIfNotAdmin, getSession } from '../../../lib/auth';
import { listMemoryEditors, addMemoryEditor, removeMemoryEditor } from '../../../lib/memories.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (denyIfNotAdmin(req, res, '只有管理员能改名单')) return;

  if (req.method === 'GET') {
    try {
      const editors = await listMemoryEditors();
      return res.status(200).json({ success: true, editors });
    } catch (e) {
      console.error('[admin/memory-editors] 读取失败:', e);
      return res.status(500).json({ success: false, error: '服务器内部错误' });
    }
  }

  if (req.method === 'POST') {
    try {
      const account = String((req.body && req.body.account) || '').trim();
      const session = getSession(req);
      await addMemoryEditor(account, (session && session.name) || 'admin');
      const editors = await listMemoryEditors();
      return res.status(200).json({ success: true, editors });
    } catch (e) {
      // 「没有这个账号」「填个账号名」是给人看的提示，其余算意外
      const known = e && /没有这个账号|填个账号名|太长了/.test(e.message || '');
      if (!known) console.error('[admin/memory-editors] 添加失败:', e);
      return res.status(400).json({ success: false, error: known ? e.message : '没加上，稍后重试' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const account = String((req.body && req.body.account) || req.query.account || '').trim();
      const ok = await removeMemoryEditor(account);
      if (!ok) return res.status(404).json({ success: false, error: '这个人本来就不在名单里' });
      const editors = await listMemoryEditors();
      return res.status(200).json({ success: true, editors });
    } catch (e) {
      console.error('[admin/memory-editors] 移除失败:', e);
      return res.status(500).json({ success: false, error: '服务器内部错误' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
  return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
}
