// 小程序「订阅提醒」页的状态源。
//
// 一次请求把这一页需要的东西全给齐：绑没绑微信、两类模板各剩几次额度、
// 勾了哪几类、有多少条未读、服务端有没有配好密钥。
// 分成多个接口会让这一页开屏就发三四个请求，弱网下会看到内容分几次跳出来。
import { getSession } from '../../../lib/auth';
import {
  CATEGORIES,
  TEMPLATES,
  interestsOf,
  linkStatus,
  mpConfigured,
  subscriptionsOf,
  unreadCount,
} from '../../../lib/mp-notify.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: '不支持的请求方式' });
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: '请先登录' });
  }

  // 内容随「我是谁」变化，不能被任何中间层缓存
  res.setHeader('Cache-Control', 'no-store');

  try {
    const [link, interests, subs, unread] = await Promise.all([
      linkStatus(session.name),
      interestsOf(session.name),
      subscriptionsOf(session.name),
      unreadCount(session.name),
    ]);

    const configured = mpConfigured();
    return res.status(200).json({
      success: true,
      account: session.name,
      linked: link.linked,
      openidCount: link.count,
      openids: link.masked,
      unread,
      interests,
      categories: CATEGORIES,
      templates: Object.values(TEMPLATES).map((t) => ({
        key: t.key,
        label: t.label,
        desc: t.desc,
        ready: !!configured.templates[t.key],
        // 模板 id 必须给到前端：wx.requestSubscribeMessage 只认 id，不认我们的 key。
        // 它不是密钥（拿到也推不了消息，推送要 access_token），可以公开。
        tmplId: configured.templates[t.key] || '',
        remaining: (subs[t.key] && subs[t.key].remaining) || 0,
        rejected: !!(subs[t.key] && subs[t.key].rejected),
      })),
      configured: {
        canLogin: configured.canLogin,
        canPush: configured.canPush,
        templatesReady: Object.keys(configured.templates).filter((k) => configured.templates[k]),
        missingTemplates: configured.missing.templates,
      },
    });
  } catch (e) {
    console.error('订阅状态接口错误:', e);
    return res.status(500).json({ success: false, error: '订阅状态没取到，请稍后重试' });
  }
}
