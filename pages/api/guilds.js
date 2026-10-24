// 帮派公开列表（匿名可看）。
//
// 为什么不复用 /api/guild：那个接口全部要登录，返回里带「我的角色」「发出去的邀请」
// 这类只对本人有意义的东西。混在一起迟早某天漏判权限。这里只给列表页要的字段。
//
// isMine 需要知道「我是谁」，所以登录与否会影响排序（自己的帮派置顶）。
// 因此响应是 no-store —— 不能让 CDN 把「别人的视角」发给下一个人。
import { ensureGuildTables } from '../../lib/db';
import { getSession } from '../../lib/auth';
import { listGuilds, playerIdOfAccount } from '../../lib/guild.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: '不支持的请求方式' });
  }

  try {
    await ensureGuildTables();

    // 未登录时 playerId 是 null，listGuilds 里 isMine 全为 false，不会炸
    const session = getSession(req);
    const playerId = session && session.name ? await playerIdOfAccount(session.name) : null;

    const guilds = await listGuilds({ viewerPlayerId: playerId });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, guilds });
  } catch (e) {
    console.error('帮派列表接口错误:', e);
    return res.status(500).json({ success: false, error: '帮派列表没取到，刷新试试' });
  }
}
