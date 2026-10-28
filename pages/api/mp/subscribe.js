// 记录 wx.requestSubscribeMessage 的结果，把它换成推送额度。
//
// 前端只能告诉我们「用户点了接受还是拒绝」，额度必须由服务端自己加 ——
// 让客户端传 remaining 等于把「能不能给你发消息」的决定权交给了客户端。
//
// 请求体：{ items: [{ key: 'digest', accept: true }, { key: 'signup', accept: false }] }
import { getSession } from '../../../lib/auth';
import { recordSubscribeResults, subscriptionsOf } from '../../../lib/mp-notify.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: '不支持的请求方式' });
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: '请先登录' });
  }

  try {
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items.slice(0, 8) : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: '没有要记录的订阅结果' });
    }

    const r = await recordSubscribeResults(session.name, items);
    if (r.reason) {
      return res.status(409).json({ success: false, error: r.reason });
    }

    const subs = await subscriptionsOf(session.name);
    return res.status(200).json({ success: true, updated: r.updated, templates: subs });
  } catch (e) {
    console.error('记录订阅结果失败:', e);
    return res.status(500).json({ success: false, error: '记录订阅状态失败，请重试' });
  }
}
