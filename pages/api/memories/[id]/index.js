/**
 * 单条回忆：GET 取详情，PATCH 改正文，DELETE 软删（作者本人或管理员）。
 *
 * 权限判断用 author_id 和当前账号绑定的玩家 id 比，
 * 不比名字 —— 昵称可以改，改完就对不上了；而且重名会误改/误删别人的回忆。
 *
 * 改正文走和发布完全相同的两道审核（词表 → AI 复审），
 * 否则「先发一条干净的，再改脏」就绕过了审核。
 */
import { getSession, isAdmin, denyIfNotLoggedIn } from '../../../../lib/auth';
import { checkInput, moderationMessage } from '../../../../lib/moderation.mjs';
import { aiModerate, aiModerationMessage, openidOf } from '../../../../lib/ai-moderate.mjs';
import { getClientIp } from '../../../../lib/rate-limit';
import {
  memoryById,
  softDeleteMemory,
  updateMemoryContent,
  authorOfAccount,
  allowAction,
  TEXT_LIMIT,
} from '../../../../lib/memories.mjs';

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

  if (req.method === 'PATCH') {
    const session = getSession(req);
    if (denyIfNotLoggedIn(req, res, '登录后才能改文案')) return;

    try {
      const memory = await memoryById(id);
      if (!memory) return res.status(404).json({ success: false, error: '这条回忆已经不在了' });

      const admin = isAdmin(req);
      const me = await authorOfAccount(session && session.name);
      const mine = !!me.playerId && String(memory.author.playerId) === String(me.playerId);
      if (!admin && !mine) {
        return res.status(403).json({ success: false, error: '只能改自己发的回忆' });
      }

      const raw = (req.body || {}).content;
      if (typeof raw !== 'string') {
        return res.status(400).json({ success: false, error: '参数不正确' });
      }

      const next = raw.trim();
      // 允许清空文案（只留照片），但不能彻底空掉 —— 那样这条回忆就没有任何内容了
      if (!next && !memory.photos.length) {
        return res.status(400).json({ success: false, error: '图和字至少留一样' });
      }

      // 一分钟 20 次，正常改文案远远够用；挡的是脚本反复刷
      const gate = allowAction('memory-edit:' + ((session && session.name) || getClientIp(req)), 20, 60 * 1000);
      if (!gate.ok) {
        return res
          .status(429)
          .json({ success: false, error: `改得太快了，${gate.retryAfterSec} 秒后再试` });
      }

      let clean = '';
      if (next) {
        const hit = checkInput({ content: next }, { content: TEXT_LIMIT });
        if (!hit.ok) return res.status(400).json({ success: false, error: moderationMessage(hit) });
        const ai = await aiModerate({ 回忆: hit.cleaned.content }, { openid: openidOf(req) });
        if (!ai.ok) return res.status(400).json({ success: false, error: aiModerationMessage(ai) });
        clean = hit.cleaned.content;
      }

      const updated = await updateMemoryContent(id, clean);
      if (!updated) return res.status(404).json({ success: false, error: '这条回忆已经不在了' });
      return res.status(200).json({ success: true, memory: updated });
    } catch (e) {
      console.error('[memories] 改文案失败:', e);
      return res.status(500).json({ success: false, error: '没改成，稍后重试' });
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

  res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
  return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
}
