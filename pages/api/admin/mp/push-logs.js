/**
 * 后台「推送记录」页的数据源。
 *
 * 这张表的价值全在**排查**：用户说「我没收到提醒」时，能一眼看到
 * skip（额度没了 / 没绑微信）、fail（errcode 是什么）、还是 ok（那就是他关了通知）。
 * 所以这里把 payload 也吐出来 —— 参数不匹配（47003）时得看到发的是什么。
 *
 * GET ?status=ok|skip|fail &scene=digest|signup &limit=100 &before=<id>
 */
import { getSession, isAdmin } from '../../../../lib/auth';
import { listPushLogs, subscriptionStats } from '../../../../lib/mp-notify.mjs';

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
    const [logs, stats] = await Promise.all([
      listPushLogs({
        status: req.query.status || '',
        scene: req.query.scene || '',
        limit: req.query.limit || 100,
        before: req.query.before || null,
      }),
      subscriptionStats(),
    ]);
    return res.status(200).json({ ok: true, logs, stats });
  } catch (e) {
    console.error('后台推送记录接口错误:', e);
    return res.status(500).json({ ok: false, error: '读取失败：' + e.message });
  }
}
