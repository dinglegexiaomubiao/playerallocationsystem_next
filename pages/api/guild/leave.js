// 成员自己退出帮派。帮主不能走这条路（必须转让或解散）。
import { ensureGuildTables } from '../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../lib/auth';
import { playerIdOfAccount, leaveGuild, GuildError } from '../../../lib/guild.mjs';

export default async function handler(req, res) {
  if (denyIfNotLoggedIn(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: '方法不允许' });
  }

  const session = getSession(req);
  await ensureGuildTables();
  try {
    const playerId = await playerIdOfAccount(session.name);
    await leaveGuild({ playerId });
    return res.status(200).json({ success: true });
  } catch (e) {
    const code = e instanceof GuildError ? e.code : 500;
    if (code >= 500) console.error('退出帮派失败:', e);
    return res.status(code).json({ success: false, error: e.message || '操作失败' });
  }
}
