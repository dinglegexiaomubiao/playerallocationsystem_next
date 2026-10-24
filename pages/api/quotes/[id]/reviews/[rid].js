/**
 * 单条评价：删除。
 *
 * 权限：评价人自己 + 管理员。删了之后触发器会把语录的平均分/人数重算一遍，
 * 不用在这里手动回写。
 */
import { getSession, isAdmin, denyIfNotLoggedIn } from '../../../../../lib/auth';
import { playerIdOfAccount } from '../../../../../lib/guild.mjs';
import { deleteReview } from '../../../../../lib/quotes.mjs';

export default async function handler(req, res) {
  if (denyIfNotLoggedIn(req, res, '请先登录')) return;
  const id = String(req.query.id || '');
  const rid = String(req.query.rid || '');
  if (!/^\d+$/.test(id) || !/^\d+$/.test(rid)) {
    return res.status(400).json({ success: false, error: '参数不正确' });
  }

  try {
    const session = getSession(req);
    const admin = isAdmin(req);
    const me = await playerIdOfAccount(session && session.name);
    const result = await deleteReview(rid, { byId: me, isAdmin: admin });
    if (!result.found) return res.status(404).json({ success: false, error: '这条评价已经不在了' });
    if (!result.allowed) return res.status(403).json({ success: false, error: '只能删自己的评价' });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('语录评价删除错误:', e);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  }
}
