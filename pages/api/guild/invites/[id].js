// 单条邀请：POST 同意/拒绝（被邀请人） / DELETE 撤回（帮主）
import { ensureGuildTables } from '../../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../../lib/auth';
import {
  playerIdOfAccount,
  respondInvite,
  cancelInvite,
  GuildError,
} from '../../../../lib/guild.mjs';

export default async function handler(req, res) {
  if (denyIfNotLoggedIn(req, res)) return;

  const session = getSession(req);
  await ensureGuildTables();

  try {
    const playerId = await playerIdOfAccount(session.name);
    const inviteId = Number(req.query.id);
    if (!Number.isInteger(inviteId) || inviteId <= 0) {
      return res.status(400).json({ success: false, error: '参数不正确' });
    }

    if (req.method === 'POST') {
      const action = String((req.body && req.body.action) || '');
      const result = await respondInvite({ playerId, inviteId, action });
      return res.status(200).json({ success: true, ...result });
    }

    if (req.method === 'DELETE') {
      await cancelInvite({ playerId, inviteId });
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'POST, DELETE');
    return res.status(405).json({ success: false, error: '方法不允许' });
  } catch (e) {
    const code = e instanceof GuildError ? e.code : 500;
    if (code >= 500) console.error('邀请处理失败:', e);
    return res.status(code).json({ success: false, error: e.message || '操作失败' });
  }
}
