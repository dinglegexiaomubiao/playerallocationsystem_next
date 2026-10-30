// 小程序静默 wx.login 换 openid —— 只为「内容安全」这一件事。
//
// 为什么需要它：微信 security.msgSecCheck v2 **必须**带 openid，不带直接 40003
// （2026-10-29 实测）。而本项目是账号密码登录、不走 wx.login，本来没有 openid，
// 于是那道官方审核等于空转。这里让小程序端启动时静默换一个，之后每个请求带上
// `X-MP-Openid` 头，服务端 lib/mp-sec.mjs 就能真正调用官方接口。
//
// 三条边界，别越界：
//   1. 只返回 openid，**不绑定账号**。账号体系仍然是账号密码，两件事不要混。
//   2. openid 不是密钥（拿到也推不了消息、进不了后台），可以下发；但它仍是标识符，
//      所以这里不落库、不写日志。
//   3. 不需要登录态 —— 未登录也能提交反馈，那条路径同样要有 openid。
import { code2session, mpConfigured } from '../../../lib/mp-notify.mjs';

// 同一 IP 每分钟最多换 20 次：正常用户整个生命周期只需要几次，超出就是被刷
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map(); // ip -> { n, ts }

function rateLimited(ip) {
  const now = Date.now();
  const cur = hits.get(ip);
  if (!cur || now - cur.ts > WINDOW_MS) {
    hits.set(ip, { n: 1, ts: now });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  cur.n += 1;
  return cur.n > MAX_PER_WINDOW;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: '不支持的请求方式' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const cfg = mpConfigured();
  if (!cfg.canLogin) {
    // 没配 AppSecret：不是错误，直接告诉前端「没有」，前端就不再带这个头
    return res.status(200).json({ success: false, error: '服务端未配置小程序密钥', configured: false });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    'unknown';
  if (rateLimited(ip)) {
    return res.status(429).json({ success: false, error: '请求过于频繁，稍后再试' });
  }

  const code = String((req.body && req.body.code) || '').trim();
  if (!code) {
    return res.status(400).json({ success: false, error: '缺少 code' });
  }

  try {
    // 注意：code 一次性，同一 code 重复用会拿到 40163。前端每次都现调 wx.login。
    const { openid } = await code2session(code);
    return res.status(200).json({ success: true, openid });
  } catch (e) {
    // code 过期/已被使用是很常见的情况（用户切后台再回来），前端静默重试即可
    return res.status(400).json({ success: false, error: e.message || '换取 openid 失败' });
  }
}
