/**
 * 后台「订阅用户」页的数据源。
 *
 * 为什么单独开一个接口而不是塞进 /api/admin/members：
 * 这两件事的数据源完全不同 —— 群友表在 players 里，订阅信息在 mp_openids /
 * mp_subscriptions 里，join 起来是一张谁都不像的表。分开之后这一页只回答
 * 一个运营问题：**谁绑了微信、还剩下几次推送额度、有没有人被拒收。**
 *
 * GET  ?q=账号或openid  → { stats, subscribers }
 */
import { getSession, isAdmin } from '../../../../lib/auth';
import { listSubscribers, subscriptionStats } from '../../../../lib/mp-notify.mjs';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: '请先登录' });
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: '仅管理员可访问' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: '不支持的请求方式' });
  }

  res.setHeader('Cache-Control', 'no-store');
  try {
    const q = req.query.q || '';
    const [stats, subscribers] = await Promise.all([subscriptionStats(), listSubscribers({ q })]);
    return res.status(200).json({ ok: true, stats, subscribers });
  } catch (e) {
    console.error('后台订阅用户接口错误:', e);
    return res.status(500).json({ ok: false, error: '读取失败：' + e.message });
  }
}
