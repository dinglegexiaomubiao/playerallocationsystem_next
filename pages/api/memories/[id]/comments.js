/**
 * 某条回忆的评论：列表公开，发评论需登录。
 *
 * 评论不做去重（同一句话在不同回忆下都可能出现），也不做「一人一条」，
 * 群里聊天本来就允许连发；靠频率限制和词表兜底。
 */
import { getSession, denyIfNotLoggedIn } from '../../../../lib/auth';
import { checkInput, moderationMessage } from '../../../../lib/moderation.mjs';
import { aiModerate, aiModerationMessage, openidOf } from '../../../../lib/ai-moderate.mjs';
import {
  memoryById,
  listComments,
  createComment,
  authorOfAccount,
  allowAction,
  COMMENT_LIMIT,
} from '../../../../lib/memories.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const id = String(req.query.id || '');
  if (!/^\d+$/.test(id)) return res.status(400).json({ success: false, error: '参数不正确' });

  try {
    const memory = await memoryById(id);
    if (!memory) return res.status(404).json({ success: false, error: '这条回忆已经不在了' });

    if (req.method === 'GET') {
      const comments = await listComments(id);
      return res.status(200).json({ success: true, comments });
    }

    if (req.method === 'POST') {
      const session = getSession(req);
      if (denyIfNotLoggedIn(req, res, '登录后才能评论')) return;

      const body = req.body || {};
      const raw = String(body.content || '').trim();
      if (!raw) return res.status(400).json({ success: false, error: '评论不能是空的' });

      const hit = checkInput({ content: raw }, { content: COMMENT_LIMIT });
      if (!hit.ok) return res.status(400).json({ success: false, error: moderationMessage(hit) });
      const ai = await aiModerate({ 评论: hit.cleaned.content }, { openid: openidOf(req) });
      if (!ai.ok) return res.status(400).json({ success: false, error: aiModerationMessage(ai) });

      const gate = allowAction('mcomment:' + ((session && session.name) || id), 60, 60 * 60 * 1000);
      if (!gate.ok) {
        return res
          .status(429)
          .json({ success: false, error: `说得太快了，${gate.retryAfterSec} 秒后再试` });
      }

      const author = await authorOfAccount(session && session.name);
      const comment = await createComment({
        memoryId: id,
        authorId: author.playerId,
        authorName: author.name,
        content: hit.cleaned.content,
      });
      return res.status(201).json({ success: true, comment });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (e) {
    console.error('[memories] 评论接口错误:', e);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  }
}
