/**
 * 按账号或昵称搜人 —— 给「谁能改这条回忆」的输入框做候选。
 *
 * 为什么要专门开一个接口：群友平时说的是昵称（「阿强」），
 * 而权限表里存的是登录账号（`qiang1994`）。让人自己把昵称翻译成账号，
 * 结果一定是「我明明加了他，他却改不了」。
 *
 * 只回账号、昵称、玩家 id 三样：任何登录用户都能调这个接口（发布框里要挑人），
 * 所以不能顺手把等级、分数、地区一起带出来当彩蛋。
 * 每次最多 8 条，够选就行，不做分页。
 */
import { getSession, denyIfNotLoggedIn } from '../../../lib/auth';
import { searchAccounts, allowAction } from '../../../lib/memories.mjs';
import { getClientIp } from '../../../lib/rate-limit';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  }

  const session = getSession(req);
  if (denyIfNotLoggedIn(req, res, '登录后才能找人')) return;

  // 一分钟 40 次：输入框防抖之后远远够用；挡的是拿字典把全站账号刷一遍
  const gate = allowAction(
    'acc-search:' + ((session && session.name) || getClientIp(req)),
    40,
    60 * 1000
  );
  if (!gate.ok) {
    return res.status(429).json({ success: false, error: `搜得太快了，${gate.retryAfterSec} 秒后再试` });
  }

  try {
    const q = String(req.query.q || '').slice(0, 40);
    if (!q.trim()) return res.status(200).json({ success: true, accounts: [] });
    const accounts = await searchAccounts(q);
    return res.status(200).json({ success: true, accounts });
  } catch (e) {
    console.error('[accounts/search] 失败:', e);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  }
}
