// 移除帮派成员（帮主专用）。路径参数是被移除的选手 id。
//
// 注意别和 /api/guild/members 混：这里没有「列表」语义，列表来自 GET /api/guild
// （只有本帮成员看得到，不需要独立接口）。
import { ensureGuildTables } from '../../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../../lib/auth';
import { playerIdOfAccount, removeGuildMember, GuildError } from '../../../../lib/guild.mjs';

export default async function handler(req, res) {
  if (denyIfNotLoggedIn(req, res)) return;
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ success: false, error: '方法不允许' });
  }

  const session = getSession(req);
  await ensureGuildTables();
  try {
    const playerId = await playerIdOfAccount(session.name);
    // 17 位雪花号不能过 Number()：会变成 ...184，DELETE 匹配到 0 行，
    // 帮主看到「这个人不在你的帮派里」却完全不知道为什么
    const target = String(req.query.playerId || '');
    if (!/^\d+$/.test(target)) {
      return res.status(400).json({ success: false, error: '参数不正确' });
    }
    await removeGuildMember({ playerId, targetPlayerId: target });
    return res.status(200).json({ success: true });
  } catch (e) {
    const code = e instanceof GuildError ? e.code : 500;
    if (code >= 500) console.error('移除成员失败:', e);
    return res.status(code).json({ success: false, error: e.message || '操作失败' });
  }
}
