// 帮派：我的帮派 / 创建 / 修改 / 解散
//
// 与 /api/guilds（公开列表）分开：这个接口全部需要登录，返回里带「我的角色」
// 这类只对本人有意义的东西。混在一起迟早某天漏判权限。
import { ensureGuildTables } from '../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../lib/auth';
import { checkInput, moderationMessage, LIMITS } from '../../../lib/moderation.mjs';
import { aiModerate, aiModerationMessage, openidOf } from '../../../lib/ai-moderate.mjs';
import { isGuildColor } from '../../../lib/guild-colors.mjs';
import {
  guildOfPlayer,
  colorUsage,
  playerIdOfAccount,
  normalizeGuildName,
  listMyInvites,
  listGuildInvites,
  createGuild,
  updateGuild,
  dissolveGuild,
  GuildError,
  MAX_GUILD_MEMBERS,
} from '../../../lib/guild.mjs';

const fail = (res, e) => {
  const code = e instanceof GuildError ? e.code : 500;
  if (code >= 500) console.error('帮派接口错误:', e);
  return res.status(code).json({ success: false, error: e.message || '操作失败' });
};

export default async function handler(req, res) {
  if (denyIfNotLoggedIn(req, res)) return;

  const session = getSession(req);
  await ensureGuildTables();

  try {
    const playerId = await playerIdOfAccount(session.name);

    if (req.method === 'GET') {
      // 一次给全，个人信息页与「邀请成员」弹窗都不用再发请求：
      //   guild        我所在的帮派（含成员）
      //   myInvites    我收到的待处理邀请 —— 个人信息页要列出它们，且能直接同意/拒绝
      //   sentInvites  本帮派发出去还没回应的 —— 「已邀请」状态与撤回要用
      const [guild, colors] = await Promise.all([guildOfPlayer(playerId), colorUsage()]);
      const [myInvites, sentInvites] = await Promise.all([
        listMyInvites(playerId),
        guild && guild.isLeader ? listGuildInvites(guild.id) : [],
      ]);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({
        success: true,
        // bound=false 时 profile 页会把「创建帮派」置灰并提示先绑定
        bound: !!playerId,
        playerId: playerId ? String(playerId) : null,
        guild,
        pendingInvites: myInvites.length,
        myInvites,
        sentInvites,
        colors,
        maxMembers: MAX_GUILD_MEMBERS,
      });
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      const chk = checkInput(
        { name: body.name, slogan: body.slogan },
        { name: LIMITS.guildName, slogan: LIMITS.guildSlogan }
      );
      if (!chk.ok) return res.status(400).json({ success: false, error: moderationMessage(chk) });

      const name = String(chk.cleaned.name || '').trim();
      const slogan = String(chk.cleaned.slogan || '').trim();
      if ([...name].length < 2) {
        return res.status(400).json({ success: false, error: '帮派名至少 2 个字' });
      }
      const colorKey = String(body.colorKey || '');
      if (!isGuildColor(colorKey)) {
        return res.status(400).json({ success: false, error: '请选择一支配色' });
      }

      // AI 复审：帮派名和口号是公开信息，和活动标题同一套标准
      const ai = await aiModerate({ 帮派名称: name, 帮派口号: slogan }, { openid: openidOf(req) });
      if (!ai.ok) return res.status(400).json({ success: false, error: aiModerationMessage(ai) });

      const id = await createGuild({
        playerId,
        name,
        nameKey: normalizeGuildName(name),
        slogan: slogan || null,
        colorKey,
      });
      return res.status(201).json({ success: true, id, guild: await guildOfPlayer(playerId) });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const patch = {};

      if (body.name !== undefined) {
        const chk = checkInput({ name: body.name }, { name: LIMITS.guildName });
        if (!chk.ok) return res.status(400).json({ success: false, error: moderationMessage(chk) });
        const name = String(chk.cleaned.name || '').trim();
        if ([...name].length < 2) {
          return res.status(400).json({ success: false, error: '帮派名至少 2 个字' });
        }
        patch.name = name;
        patch.nameKey = normalizeGuildName(name);
      }
      if (body.slogan !== undefined) {
        const chk = checkInput({ slogan: body.slogan }, { slogan: LIMITS.guildSlogan });
        if (!chk.ok) return res.status(400).json({ success: false, error: moderationMessage(chk) });
        patch.slogan = String(chk.cleaned.slogan || '').trim();
      }
      if (body.colorKey !== undefined) {
        if (!isGuildColor(body.colorKey)) {
          return res.status(400).json({ success: false, error: '请选择一支配色' });
        }
        patch.colorKey = String(body.colorKey);
      }
      if (!Object.keys(patch).length) {
        return res.status(400).json({ success: false, error: '没有要修改的内容' });
      }

      const ai = await aiModerate({ 帮派名称: patch.name, 帮派口号: patch.slogan }, { openid: openidOf(req) });
      if (!ai.ok) return res.status(400).json({ success: false, error: aiModerationMessage(ai) });

      await updateGuild({ playerId, ...patch });
      return res.status(200).json({ success: true, guild: await guildOfPlayer(playerId) });
    }

    if (req.method === 'DELETE') {
      await dissolveGuild({ playerId });
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ success: false, error: '方法不允许' });
  } catch (e) {
    return fail(res, e);
  }
}
