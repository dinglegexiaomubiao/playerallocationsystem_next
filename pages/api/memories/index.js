/**
 * 回忆列表（公开）与发布（需登录）。
 *
 * 发布是两步：先 POST /api/memories/upload 把照片落盘拿到路径，
 * 再 POST 这里带上这些路径。分两步的好处是单张重传不会连累整条回忆，
 * 代价是用户传完图不发会产生孤儿文件 —— 小站人工清理即可，
 * 写库失败时也不删文件（宁可多留，不可误删）。
 */
import { getSession, denyIfNotLoggedIn } from '../../../lib/auth';
import { checkInput, moderationMessage } from '../../../lib/moderation.mjs';
import { aiModerate, aiModerationMessage, openidOf } from '../../../lib/ai-moderate.mjs';
import { getClientIp } from '../../../lib/rate-limit';
import {
  listMemories,
  createMemory,
  checkTags,
  authorOfAccount,
  allowAction,
  isPhotoPath,
  MAX_PHOTOS,
  TEXT_LIMIT,
} from '../../../lib/memories.mjs';
import { openStored } from '../../../lib/memory-store.mjs';

// 正文最多 800 字 + 9 个照片路径，普通 JSON 足够；这里放宽只是防止异常大包
export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      // viewer 只用来给每条回忆算「有没有被单独指定改这一条」，不是权限判断
      const session = getSession(req);
      const data = await listMemories({
        limit: req.query.limit,
        before: req.query.before,
        tag: req.query.tag,
        viewer: (session && session.name) || '',
      });
      return res.status(200).json({ success: true, ...data });
    } catch (e) {
      console.error('[memories] 列表查询失败:', e);
      return res.status(500).json({ success: false, error: '服务器内部错误' });
    }
  }

  if (req.method === 'POST') {
    const session = getSession(req);
    if (denyIfNotLoggedIn(req, res, '登录后才能发回忆')) return;

    try {
      const body = req.body || {};
      const content = String(body.content || '').trim();
      const rawPhotos = Array.isArray(body.photos) ? body.photos : [];

      if (!content && !rawPhotos.length) {
        return res.status(400).json({ success: false, error: '写点什么，或者传张照片' });
      }
      if (rawPhotos.length > MAX_PHOTOS) {
        return res.status(400).json({ success: false, error: `一条回忆最多 ${MAX_PHOTOS} 张照片` });
      }

      // 路径必须是本站上传接口生成的形状，且文件真的在盘上
      const photos = [];
      for (const x of rawPhotos) {
        const p = String(x && x.p ? x.p : x || '');
        if (!isPhotoPath(p)) {
          return res.status(400).json({ success: false, error: '照片路径不对，重新传一次' });
        }
        if (!openStored(p).exists) {
          return res.status(400).json({ success: false, error: '照片没存上，重新传一次' });
        }
        photos.push({ p, w: Number(x && x.w) || 0, h: Number(x && x.h) || 0 });
      }

      // 文字过审：词表在前，微信/模型复审在后（和语录、评价同一套）
      let clean = '';
      if (content) {
        const hit = checkInput({ content }, { content: TEXT_LIMIT });
        if (!hit.ok) return res.status(400).json({ success: false, error: moderationMessage(hit) });
        const ai = await aiModerate({ 回忆: hit.cleaned.content }, { openid: openidOf(req) });
        if (!ai.ok) return res.status(400).json({ success: false, error: aiModerationMessage(ai) });
        clean = hit.cleaned.content;
      }

      // 标签只过词表（短分类词，不用等模型），脏词直接拒，不做星号替换。
      // 超过 5 个不报错，由 normalizeTags 静默截断 —— 站内一贯策略。
      const tagCheck = checkTags(body.tags);
      if (!tagCheck.ok) return res.status(400).json({ success: false, error: tagCheck.error });

      // 一个人一小时最多 20 条，够用，也能挡住脚本刷屏
      const who = authorOfAccount(session && session.name);
      const gate = allowAction('memory:' + ((session && session.name) || getClientIp(req)), 20);
      if (!gate.ok) {
        return res
          .status(429)
          .json({ success: false, error: `发得太快了，${gate.retryAfterSec} 秒后再试` });
      }

      const author = await who;
      const memory = await createMemory({
        authorId: author.playerId,
        authorName: author.name,
        content: clean,
        photos,
        tags: tagCheck.tags,
      });
      return res.status(201).json({ success: true, memory });
    } catch (e) {
      console.error('[memories] 发布失败:', e);
      const msg = e && e.message === '写点什么或者传张照片' ? e.message : '发布失败，稍后重试';
      return res.status(500).json({ success: false, error: msg });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
}
