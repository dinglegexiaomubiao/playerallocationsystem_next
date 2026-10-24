// 转让帮主。只有现任帮主能调，目标必须是本帮成员。
import { ensureGuildTables } from '../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../lib/auth';
import { playerIdOfAccount, transferLeader, GuildError } from '../../../lib/guild.mjs';

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
    // 同样不能 Number()：雪花号会被截成另一个 id，转让就找不到人
    const target = String((req.body && req.body.playerId) || '');
    if (!/^\d+$/.test(target)) {
      return res.status(400).json({ success: false, error: '请选择要转让给谁' });
    }
    await transferLeader({ playerId, targetPlayerId: target });
    return res.status(200).json({ success: true });
  } catch (e) {
    const code = e instanceof GuildError ? e.code : 500;
    if (code >= 500) console.error('转让帮主失败:', e);
    return res.status(code).json({ success: false, error: e.message || '操作失败' });
  }
}
