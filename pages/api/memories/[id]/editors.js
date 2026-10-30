/**
 * 单条回忆的「谁能改文案」名单。
 *
 * 和 /api/admin/memory-editors（全站名单）不是一回事：这里管的是**这一条**。
 * 谁能维护这份名单：管理员，以及这条回忆的作者本人 ——
 * 谁写的谁决定找谁帮忙改字，这是作者自己的事，不必每次都来找站长。
 *
 * 只解锁「改文案」这一个动作，不解锁删除：能改字不等于能删内容。
 * 实际放行在 pages/api/memories/[id]/index.js 的 PATCH 里，这里只管名单本身。
 */
import { getSession, isAdmin, denyIfNotLoggedIn } from '../../../../lib/auth';
import {
  memoryById,
  authorOfAccount,
  listMemoryGrants,
  addMemoryGrant,
  removeMemoryGrant,
} from '../../../../lib/memories.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const id = String(req.query.id || '');
  if (!/^\d+$/.test(id)) return res.status(400).json({ success: false, error: '参数不正确' });

  const session = getSession(req);
  if (denyIfNotLoggedIn(req, res, '登录后才能管理这条的授权')) return;

  try {
    const memory = await memoryById(id);
    if (!memory) return res.status(404).json({ success: false, error: '这条回忆已经不在了' });

    const admin = isAdmin(req);
    const me = await authorOfAccount(session && session.name);
    const mine = !!me.playerId && String(memory.author.playerId) === String(me.playerId);
    if (!admin && !mine) {
      return res.status(403).json({ success: false, error: '只有作者本人或管理员能指定' });
    }

    if (req.method === 'GET') {
      const editors = await listMemoryGrants(id);
      return res.status(200).json({ success: true, editors });
    }

    if (req.method === 'POST') {
      const account = String((req.body && req.body.account) || '').trim();
      await addMemoryGrant(id, account, (session && session.name) || 'admin');
      const editors = await listMemoryGrants(id);
      return res.status(200).json({ success: true, editors });
    }

    if (req.method === 'DELETE') {
      const account = String((req.body && req.body.account) || req.query.account || '').trim();
      const ok = await removeMemoryGrant(id, account);
      if (!ok) return res.status(404).json({ success: false, error: '这个人本来就没被指定' });
      const editors = await listMemoryGrants(id);
      return res.status(200).json({ success: true, editors });
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (e) {
    // 「没有这个账号」「填个账号名」是给人看的提示，其余算意外
    const known = e && /没有这个账号|填个账号名|太长了|回忆不存在/.test(e.message || '');
    if (!known) console.error('[memories/editors] 失败:', e);
    return res.status(known ? 400 : 500).json({
      success: false,
      error: known ? e.message : '服务器内部错误',
    });
  }
}
