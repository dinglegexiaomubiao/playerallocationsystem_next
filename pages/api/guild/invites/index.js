// 帮派邀请：我收到的（GET） / 发一条（POST，帮主）
import { ensureGuildTables } from '../../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../../lib/auth';
import { checkInput, moderationMessage, LIMITS } from '../../../../lib/moderation.mjs';
import { aiModerate, aiModerationMessage } from '../../../../lib/ai-moderate.mjs';
import {
  playerIdOfAccount,
  listMyInvites,
  createInvite,
  GuildError,
} from '../../../../lib/guild.mjs';

export default async function handler(req, res) {
  if (denyIfNotLoggedIn(req, res)) return;

  const session = getSession(req);
  await ensureGuildTables();

  try {
    const playerId = await playerIdOfAccount(session.name);

    if (req.method === 'GET') {
      const invites = await listMyInvites(playerId);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ success: true, invites });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const target = Number(body.playerId);
      if (!Number.isInteger(target) || target <= 0) {
        return res.status(400).json({ success: false, error: '请选择要邀请的群友' });
      }

      // 邀请语也要过审核 —— 这是会出现在别人屏幕上的一句话，和活动备注同一个标准
      const chk = checkInput({ message: body.message }, { message: LIMITS.guildInvite });
      if (!chk.ok) return res.status(400).json({ success: false, error: moderationMessage(chk) });
      const message = String(chk.cleaned.message || '').trim();

      if (message) {
        const ai = await aiModerate({ 邀请信息: message });
        if (!ai.ok) return res.status(400).json({ success: false, error: aiModerationMessage(ai) });
      }

      const id = await createInvite({ playerId, targetPlayerId: target, message });
      return res.status(201).json({ success: true, id });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: '方法不允许' });
  } catch (e) {
    const code = e instanceof GuildError ? e.code : 500;
    if (code >= 500) console.error('邀请接口错误:', e);
    return res.status(code).json({ success: false, error: e.message || '操作失败' });
  }
}
