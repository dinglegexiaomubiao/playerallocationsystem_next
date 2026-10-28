// 关注类别（开黑 / 活动 / 赛事）。
//
// 和「额度」分开的两件事：额度决定「能不能发」，关注类别决定「发什么」。
// 用户只想看赛事，汇总里就不该出现开黑条目 —— 一条消息只有 20 字的空间。
import { getSession } from '../../../lib/auth';
import { CATEGORIES, interestsOf, setInterests } from '../../../lib/mp-notify.mjs';

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: '请先登录' });
  }
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    try {
      return res.status(200).json({
        success: true,
        categories: CATEGORIES,
        interests: await interestsOf(session.name),
      });
    } catch (e) {
      console.error('读关注类别失败:', e);
      return res.status(500).json({ success: false, error: '读取失败，请稍后重试' });
    }
  }

  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const list = Array.isArray(body.interests) ? body.interests : [];
      const saved = await setInterests(session.name, list);
      return res.status(200).json({ success: true, interests: saved, categories: CATEGORIES });
    } catch (e) {
      console.error('保存关注类别失败:', e);
      return res.status(500).json({ success: false, error: '保存失败，请重试' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
}
