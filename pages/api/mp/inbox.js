// 站内信：小程序「消息」页。
//
// 为什么站内信是主渠道而不是备胎：一次性订阅的推送成功率不在我们手里
// （额度用完 / 用户拒收 / 微信限流都会失败），而「有人报名了你的招募」
// 这件事必须留得下来。所以每条通知先落这张表，推送只是锦上添花。
//
// GET   ?before=<id>&limit=30  倒序翻页
// POST  { id } 标记单条已读 / { all: true } 全部已读
import { getSession } from '../../../lib/auth';
import { listInbox, markInboxRead } from '../../../lib/mp-notify.mjs';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: '请先登录' });
  }
  // 每个人看到的是自己的消息，绝不能被缓存
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const limit = req.query.limit || 30;
      const before = req.query.before || null;
      const r = await listInbox(session.name, { limit, before });
      return res.status(200).json({ success: true, ...r });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const changed = await markInboxRead(session.name, {
        id: body.id || null,
        all: body.all === true,
      });
      return res.status(200).json({ success: true, changed });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (e) {
    console.error('站内信接口错误:', e);
    return res.status(500).json({ success: false, error: '消息没取到，请稍后重试' });
  }
}
