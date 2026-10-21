// 邮件通知自检：管理员点一下就知道 SMTP 通不通、为什么不通。
// 只做一件事——用真实配置发一封测试邮件，把错误原文原样带回来。
// 配 QQ 邮箱时最常见的坑是拿「登录密码」当授权码，报错是
// 535 Login Fail，看到原文才不会瞎猜。
import { denyIfNotAdmin } from '../../../lib/auth';
import { supportNotifyConfigured, notifySupportReport } from '../../../lib/notify';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  }
  if (denyIfNotAdmin(req, res, '仅管理员可测试邮件通知')) return;

  const cfg = supportNotifyConfigured();
  if (!cfg.email && !cfg.webhook) {
    return res.status(200).json({
      success: false,
      configured: cfg,
      error:
        '没有任何通知渠道：需要在服务器 .env.local 里配置 SUPPORT_SMTP_HOST / SUPPORT_SMTP_PORT / SUPPORT_SMTP_USER / SUPPORT_SMTP_PASS / SUPPORT_MAIL_TO',
    });
  }

  const now = new Date().toISOString();
  const result = await notifySupportReport({
    id: 'TEST',
    kind: 'feedback',
    category: 'bug',
    message: `这是一封测试邮件，用来确认反馈通知能正常送达。\n\n发信时间：${now}\n如果收到这封邮件说明 SMTP 配置正确，以后有新的群友反馈会自动发到同一个邮箱。`,
    detail: { source: '后台「测试邮件」按钮', checked_at: now },
    page_url: '/admin/support',
    account_name: '系统自检',
    is_admin: true,
    platform: '服务器',
    ip: '127.0.0.1',
    contact: null,
    created_at: now,
  });

  return res.status(200).json({
    success: !!result.ok,
    configured: cfg,
    channel: result.channel || null,
    error: result.ok ? null : result.error || '发送失败',
  });
}
