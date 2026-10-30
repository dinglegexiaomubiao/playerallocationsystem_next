/**
 * 群友语录：列表（公开）+ 提交（需登录）。
 *
 * 提交要过两道审核，和美食评价 / 反馈同一套口径：
 *   1. moderation.mjs 的本地违禁词表（赌博/色情/诈骗/引流/辱骂…）命中即拒
 *   2. ai-moderate.mjs 的 DeepSeek 语义复审（拦谐音、隐晦表达）
 * AI 超时或没配 key 会自动放行，不阻塞用户 —— 词表已经拦过一轮。
 *
 * 唯一比别的 UGC 多一道的，是「自定义出处不许和群友昵称重名」。
 * 语录本质是引用，允许随便写别人的名字等于提供了一个造谣工具，
 * 而这段文字本身完全合规，AI 审核拦不住。
 */
import { getSession, isAdmin, denyIfNotLoggedIn } from '../../../lib/auth';
import { checkInput, moderationMessage, LIMITS } from '../../../lib/moderation.mjs';
import { aiModerate, aiModerationMessage, openidOf } from '../../../lib/ai-moderate.mjs';
import { playerIdOfAccount } from '../../../lib/guild.mjs';
import {
  listQuotes,
  createQuote,
  playerExists,
  findPlayerByNickname,
} from '../../../lib/quotes.mjs';

/** 服务器本地日期（部署在 Asia/Shanghai），用来判断「不能填未来」。 */
const todayStr = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 严格校验 YYYY-MM-DD，并挡掉 2026-02-31 这种「格式对但日子不存在」的输入。 */
const parseDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { limit, offset, source } = req.query;
      const data = await listQuotes({
        limit,
        offset,
        sourcePlayerId: source ? String(source) : null,
      });
      /**
       * 每条带上「我能不能删」。
       *
       * 为什么不在客户端算：网页端是拿服务端直出的 myPlayerId 在浏览器里比，
       * 小程序没有这条路（登录接口不返回 playerId），照抄就得为了一个布尔值
       * 再发一次请求。判据和 DELETE 分支完全同一套（本人收录 或 管理员），
       * 这里只决定按钮显不显示，真正拦截仍在 DELETE 里 —— 别把这里当权限校验。
       */
      const session = getSession(req);
      const myPlayerId = session && session.name ? await playerIdOfAccount(session.name) : null;
      const admin = isAdmin(req);
      const quotes = (data.quotes || []).map((q) => ({
        ...q,
        canDelete:
          admin ||
          (!!myPlayerId &&
            !!q.submittedBy &&
            String(q.submittedBy.playerId) === String(myPlayerId)),
      }));
      // 语录会随时增加，不能让浏览器或 CDN 久缓存
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ success: true, ...data, quotes });
    }

    if (req.method === 'POST') {
      if (denyIfNotLoggedIn(req, res, '登录后才能收录语录')) return;
      const body = req.body || {};

      const raw = String(body.content || '').trim();
      if (!raw) return res.status(400).json({ success: false, error: '语录内容不能为空' });
      // 全是标点或空白的一句话等于空 —— 归一化后为空就拒，否则会占掉唯一索引
      if (!raw.replace(/[\s\p{P}\p{S}]/gu, '')) {
        return res.status(400).json({ success: false, error: '这段只有标点，写点内容吧' });
      }

      const saidAt = body.saidAt ? parseDate(body.saidAt) : todayStr();
      if (!saidAt) return res.status(400).json({ success: false, error: '日期格式不对' });
      if (saidAt > todayStr()) {
        return res.status(400).json({ success: false, error: '还没到的日子收不了语录' });
      }

      // 出处二选一：要么选群友，要么写自定义文字，不能都空
      const sourcePlayerId = body.sourcePlayerId ? String(body.sourcePlayerId) : '';
      const sourceText = String(body.sourceText || '').trim();
      if (!sourcePlayerId && !sourceText) {
        return res.status(400).json({ success: false, error: '这段是谁说的？选个群友或者写一下出处' });
      }
      if (sourcePlayerId && sourceText) {
        return res.status(400).json({ success: false, error: '出处只能选一种：群友或自定义' });
      }
      if (sourcePlayerId && !(await playerExists(sourcePlayerId))) {
        return res.status(400).json({ success: false, error: '没找到这位群友，请重新搜一下' });
      }

      // 词表初筛
      const hit = checkInput({ content: raw, sourceText }, {
        content: LIMITS.quote,
        sourceText: LIMITS.quoteSource,
      });
      if (!hit.ok) return res.status(400).json({ success: false, error: moderationMessage(hit) });

      // 自定义出处不能和群友重名
      if (sourceText) {
        const clash = await findPlayerByNickname(sourceText);
        if (clash) {
          return res.status(400).json({
            success: false,
            error: `「${clash.nickname}」是站里的群友，请从搜索里选他，不要手写名字`,
          });
        }
      }

      // AI 复审
      const ai = await aiModerate({
        语录: hit.cleaned.content,
        出处: sourceText || sourcePlayerId,
      }, { openid: openidOf(req) });
      if (!ai.ok) return res.status(400).json({ success: false, error: aiModerationMessage(ai) });

      const session = getSession(req);
      const submittedBy = await playerIdOfAccount(session && session.name);

      const result = await createQuote({
        content: hit.cleaned.content,
        saidAt,
        sourcePlayerId: sourcePlayerId || null,
        sourceText: sourceText || null,
        submittedBy,
      });

      if (result.duplicate) {
        // 不是错误：这句话已经有人收过了，把已有那条告诉前端去高亮
        return res.status(200).json({
          success: true,
          duplicate: true,
          id: result.id,
          message: '这句已经有人收过了',
        });
      }
      return res.status(201).json({ success: true, duplicate: false, quote: result.quote });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (e) {
    console.error('语录接口错误:', e);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  }
}
