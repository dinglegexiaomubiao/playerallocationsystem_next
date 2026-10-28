// 绑定微信 openid：小程序 wx.login 拿到 code，这里换 openid 并记到当前账号名下。
//
// 为什么要有这一步：小程序没有 cookie，推送又只认 openid。用户在网页端登录过
// 不代表小程序知道他是谁 —— 小程序那边是 Bearer token，微信那边是 openid，
// 两边必须显式对上，否则「有人报名了」这类定向通知根本不知道该发给谁。
//
// 没配 AppSecret 时**不是错误**：返回 linked:false + reason:'no_config'，
// 前端把「订阅提醒」入口置灰并说明原因即可。这样后端可以先上线，密钥后补。
import { getSession } from '../../../lib/auth';
import { bindOpenid, code2session, linkStatus, mpConfigured } from '../../../lib/mp-notify.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: '不支持的请求方式' });
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: '请先登录后再绑定微信' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const cfg = mpConfigured();
  if (!cfg.canLogin) {
    return res.status(200).json({
      success: true,
      linked: false,
      reason: 'no_config',
      message: '服务端还没配置小程序密钥，绑定功能暂未开启',
    });
  }

  try {
    const code = req.body && req.body.code;
    const { openid, unionid } = await code2session(code);
    await bindOpenid({ accountName: session.name, openid, unionid });
    const st = await linkStatus(session.name);
    return res.status(200).json({ success: true, linked: true, ...st });
  } catch (e) {
    console.error('绑定 openid 失败:', e.message);
    return res.status(400).json({ success: false, error: e.message || '绑定失败，请重试' });
  }
}
