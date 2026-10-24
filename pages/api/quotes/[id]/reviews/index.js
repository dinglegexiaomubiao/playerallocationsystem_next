/**
 * 单条语录的评价：列表（公开）+ 提交（需登录）。
 *
 * 评分 0~5，半星步进（0 / 0.5 / 1 / … / 5），共 11 档。
 * 文字评价可选，写了才过审核（和语录同一套词表 + DeepSeek 复审）。
 *
 * 一人一评、可改：提交走 upsert，重复提交覆盖旧的，平均分不会被自己拉偏。
 */
import { getSession, denyIfNotLoggedIn } from '../../../../../lib/auth';
import { checkInput, moderationMessage, LIMITS } from '../../../../../lib/moderation.mjs';
import { aiModerate, aiModerationMessage } from '../../../../../lib/ai-moderate.mjs';
import { playerIdOfAccount } from '../../../../../lib/guild.mjs';
import { quoteById, listReviews, getMyReview, createReview } from '../../../../../lib/quotes.mjs';

/** 半星校验：0~5 且是 0.5 的整数倍。 */
const parseScore = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 5) return null;
  if (Math.round(n * 2) !== n * 2) return null;
  return n;
};

export default async function handler(req, res) {
  const id = String(req.query.id || '');
  if (!/^\d+$/.test(id)) return res.status(400).json({ success: false, error: '参数不正确' });

  try {
    const quote = await quoteById(id);
    if (!quote) return res.status(404).json({ success: false, error: '这条语录已经不在了' });

    if (req.method === 'GET') {
      const reviews = await listReviews(id);
      let myReview = null;
      const session = getSession(req);
      if (session) {
        const me = await playerIdOfAccount(session && session.name);
        if (me) myReview = await getMyReview(id, me);
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        success: true,
        reviews,
        myReview,
        ratingAvg: quote.ratingAvg,
        ratingCount: quote.ratingCount,
      });
    }

    if (req.method === 'POST') {
      if (denyIfNotLoggedIn(req, res, '登录后才能评价')) return;
      const body = req.body || {};

      const score = parseScore(body.score);
      if (score === null) {
        return res.status(400).json({ success: false, error: '评分要在 0 到 5 之间，半星步进（0.5 的倍数）' });
      }

      // 文字可选：空就只存分数；有内容才过审核
      const rawComment = String(body.comment || '').trim();
      let comment = null;
      if (rawComment) {
        const hit = checkInput({ comment: rawComment }, { comment: LIMITS.reviewComment });
        if (!hit.ok) return res.status(400).json({ success: false, error: moderationMessage(hit) });
        const ai = await aiModerate({ 评价: hit.cleaned.comment });
        if (!ai.ok) return res.status(400).json({ success: false, error: aiModerationMessage(ai) });
        comment = hit.cleaned.comment;
      }

      const session = getSession(req);
      const reviewerId = await playerIdOfAccount(session && session.name);
      const review = await createReview({ quoteId: id, reviewerId, score, comment });

      // 重读语录拿到触发器刚算好的平均分/人数，前端直接刷新摘要
      const after = await quoteById(id);
      return res.status(201).json({
        success: true,
        review,
        ratingAvg: after.ratingAvg,
        ratingCount: after.ratingCount,
      });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (e) {
    console.error('语录评价接口错误:', e);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  }
}
