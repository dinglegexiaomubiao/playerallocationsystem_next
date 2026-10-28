// 站点更新日志（小程序「我的 → 更新日志」页用）。
//
// 为什么不把 lib/changelog.js 抄一份进 miniprogram/utils：
//   抄一份就是两份数据，网页端每次上线往里加条目、小程序那份忘了跟，两边就开始
//   说不同的话。而且照抄还会把 adminOnly 条目一起搬过去 —— 过滤必须在服务端做。
//
// 为什么不复用页面 SSR：小程序拿不到 HTML，只能吃 JSON。
//
// 普通群友只拿得到非 adminOnly 的条目；管理员（isAdminName）额外拿到自己那份，
// 行为和网页端 /changelog 一致。
import { getSession, isAdminName } from '../../lib/auth';
import { changelogByVersion, LATEST_VERSION } from '../../lib/changelog';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: '不支持的请求方式' });
  }

  try {
    const session = getSession(req);
    const isAdmin = !!(session && session.name && isAdminName(session.name));

    // 响应随「我是谁」变化（adminOnly 条目），绝不能被缓存发给下一个人
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      latest: LATEST_VERSION,
      isAdmin,
      groups: changelogByVersion({ isAdmin }),
    });
  } catch (e) {
    console.error('更新日志接口错误:', e);
    return res.status(500).json({ success: false, error: '更新日志没取到，下拉刷新试试' });
  }
}
