/**
 * 单条语录：删除 + 修改。
 *
 * 删除权限：收录人自己 + 管理员。为什么给收录人留口子 ——
 * 他自己收错了（出处点错人、时间填错）要能撤，否则每次都得找管理员。
 *
 * 修改只给管理员：改别人的语录属于编辑行为，不适合让收录人做。
 */
import { getSession, isAdmin, denyIfNotLoggedIn } from '../../../lib/auth';
import { playerIdOfAccount } from '../../../lib/guild.mjs';
import { quoteById, deleteQuote, updateQuote } from '../../../lib/quotes.mjs';
import { checkInput, moderationMessage, LIMITS } from '../../../lib/moderation.mjs';

const parseDate = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

export default async function handler(req, res) {
  if (denyIfNotLoggedIn(req, res, '请先登录')) return;
  const id = String(req.query.id || '');
  if (!/^\d+$/.test(id)) return res.status(400).json({ success: false, error: '参数不正确' });

  try {
    const quote = await quoteById(id);
    if (!quote) return res.status(404).json({ success: false, error: '这条语录已经不在了' });

    if (req.method === 'DELETE') {
      const admin = isAdmin(req);
      if (!admin) {
        const session = getSession(req);
        const me = await playerIdOfAccount(session && session.name);
        if (!me || String(quote.submittedBy?.playerId) !== String(me)) {
          return res.status(403).json({ success: false, error: '只能删自己收录的语录' });
        }
      }
      await deleteQuote(id);
      return res.status(200).json({ success: true });
    }

    if (req.method === 'PUT') {
      if (!isAdmin(req)) return res.status(403).json({ success: false, error: '仅管理员可修改语录' });
      const body = req.body || {};
      const saidAt = parseDate(body.saidAt) || quote.saidAt;
      const hit = checkInput(
        { content: body.content, sourceText: body.sourceText },
        { content: LIMITS.quote, sourceText: LIMITS.quoteSource }
      );
      if (!hit.ok) return res.status(400).json({ success: false, error: moderationMessage(hit) });
      if (!String(hit.cleaned.content || '').trim()) {
        return res.status(400).json({ success: false, error: '内容不能为空' });
      }
      // 出处是群友时不允许在这里改成自定义文字（会把链接弄丢），要改就删了重收
      const sourceText = quote.source.type === 'player' ? quote.source.text || null : hit.cleaned.sourceText;
      await updateQuote(id, { content: hit.cleaned.content, saidAt, sourceText });
      return res.status(200).json({ success: true, quote: await quoteById(id) });
    }

    res.setHeader('Allow', ['PUT', 'DELETE']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(400).json({ success: false, error: '改完之后和另一条语录重复了' });
    }
    console.error('语录单项接口错误:', e);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  }
}
