/**
 * 售后工单的通知出口：邮件（SMTP）+ 可选 Webhook（企业微信 / 钉钉 / Slack）。
 *
 * 设计原则：
 *   1. **不阻塞主流程**：通知失败只记 notify_error，绝不让用户看到提交失败；
 *   2. **未配置就是静默跳过**：本地开发不需要配邮箱，数据照样入表；
 *   3. 只依赖 nodemailer，任何标准 SMTP 都能用（QQ / 163 / Gmail / 企业邮箱）。
 *
 * 需要的环境变量（全部可选，配了才生效）：
 *   SUPPORT_SMTP_HOST   smtp.qq.com
 *   SUPPORT_SMTP_PORT   465            # 465=SSL，587=STARTTLS
 *   SUPPORT_SMTP_USER   you@qq.com
 *   SUPPORT_SMTP_PASS   <授权码，不是登录密码>
 *   SUPPORT_MAIL_TO     you@qq.com     # 收件人，多个用逗号分隔
 *   SUPPORT_MAIL_FROM   可选，默认同 SUPPORT_SMTP_USER
 *   SUPPORT_WEBHOOK_URL 可选，POST JSON 到企业微信/钉钉机器人
 *   SUPPORT_MAIL_ERRORS 设为 1 时，自动采集的前端报错也发邮件（默认只发用户反馈）
 */

const KIND_LABEL = { error: '自动报错', feedback: '用户反馈', signup: '新用户注册' };

const esc = (s) =>
  String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function smtpConfig() {
  const host = process.env.SUPPORT_SMTP_HOST;
  const user = process.env.SUPPORT_SMTP_USER;
  const pass = process.env.SUPPORT_SMTP_PASS;
  const to = process.env.SUPPORT_MAIL_TO;
  if (!host || !user || !pass || !to) return null;
  const port = Number(process.env.SUPPORT_SMTP_PORT || 465);
  return {
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    from: process.env.SUPPORT_MAIL_FROM || user,
    to: to.split(',').map((s) => s.trim()).filter(Boolean),
  };
}

function buildSubject(report) {
  const kind = KIND_LABEL[report.kind] || report.kind;
  const who = report.account_name || '未登录访客';
  const brief = String(report.message || report.category || '').replace(/\s+/g, ' ').slice(0, 40);
  // 注册通知没有「页面」概念，标题按自己的格式拼，免得出现空的 ｜｜
  if (report.kind === 'signup') return `[Dota2社区·新注册] ${who}｜${brief}`;
  const page = (report.page_url || '').replace(/^https?:\/\/[^/]+/, '') || '/';
  return `[Dota2社区·售后] ${kind}｜${who}｜${page}｜${brief}`;
}

function buildHtml(report) {
  const d = report.detail || {};
  const rows = [
    ['工单号', report.id],
    ['类型', KIND_LABEL[report.kind] || report.kind],
    ['分类', report.category],
    ['账号', report.account_name || '（未登录）'],
    ['是否管理员', report.is_admin ? '是' : '否'],
    ['页面', report.page_url],
    ['平台', report.platform],
    ['IP', report.ip],
    ['联系方式', report.contact],
    ['时间', report.created_at],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  return `<div style="font:14px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937">
  <h2 style="margin:0 0 12px;font-size:17px">${esc(buildSubject(report))}</h2>
  <table style="border-collapse:collapse;margin-bottom:14px">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;white-space:nowrap">${esc(k)}</td>
<td style="padding:4px 0">${esc(v)}</td></tr>`
      )
      .join('')}
  </table>
  <div style="padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;white-space:pre-wrap">${esc(
    report.message || '（无描述）'
  )}</div>
  ${
    Object.keys(d).length
      ? `<h3 style="font-size:13px;color:#6b7280;margin:16px 0 6px">技术细节</h3>
  <pre style="padding:12px;background:#0f172a;color:#e2e8f0;border-radius:8px;overflow:auto;font-size:12px">${esc(
    JSON.stringify(d, null, 2)
  )}</pre>`
      : ''
  }
</div>`;
}

async function sendMail(report) {
  const cfg = smtpConfig();
  if (!cfg) return { ok: false, skipped: true, error: '未配置 SUPPORT_SMTP_*，跳过邮件通知' };

  // 动态引入：没配邮件时连模块都不用加载
  const nodemailer = (await import('nodemailer')).default;
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.auth,
    connectionTimeout: 8000,
    socketTimeout: 10000,
  });

  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to.join(','),
    subject: buildSubject(report),
    text: `${buildSubject(report)}\n\n${report.message || ''}\n\n${JSON.stringify(report.detail || {}, null, 2)}`,
    html: buildHtml(report),
  });
  return { ok: true, channel: 'email' };
}

async function sendWebhook(report) {
  const url = process.env.SUPPORT_WEBHOOK_URL;
  if (!url) return { ok: false, skipped: true, error: '未配置 SUPPORT_WEBHOOK_URL' };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // 企业微信/钉钉机器人都能识别的通用文本格式
      msgtype: 'text',
      text: { content: buildSubject(report) + '\n' + (report.message || '').slice(0, 400) },
      // 同时保留原始字段，方便自建服务消费
      report,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Webhook 返回 ${res.status}`);
  return { ok: true, channel: 'webhook' };
}

/**
 * 给一条工单发通知。永不抛异常。
 * @returns {Promise<{ok:boolean, channel?:string, skipped?:boolean, error?:string}>}
 */
export async function notifySupportReport(report) {
  // 自动报错默认不发邮件，否则前端一抖动邮箱就炸了；需要时用 SUPPORT_MAIL_ERRORS=1 打开
  if (report.kind === 'error' && process.env.SUPPORT_MAIL_ERRORS !== '1') {
    return { ok: false, skipped: true, error: '自动报错不发邮件（SUPPORT_MAIL_ERRORS≠1）' };
  }

  const results = [];
  try {
    results.push(await sendMail(report));
  } catch (e) {
    results.push({ ok: false, channel: 'email', error: e.message || String(e) });
  }
  try {
    const w = await sendWebhook(report);
    if (!w.skipped) results.push(w);
  } catch (e) {
    results.push({ ok: false, channel: 'webhook', error: e.message || String(e) });
  }

  const sent = results.filter((r) => r.ok);
  if (sent.length) return { ok: true, channel: sent.map((r) => r.channel).join(',') };
  const reasons = results.filter((r) => !r.skipped).map((r) => `${r.channel}: ${r.error}`);
  return {
    ok: false,
    skipped: results.every((r) => r.skipped),
    error: reasons.join('; ') || results.map((r) => r.error).filter(Boolean).join('; '),
  };
}

export function supportNotifyConfigured() {
  return { email: !!smtpConfig(), webhook: !!process.env.SUPPORT_WEBHOOK_URL };
}

/**
 * 新用户注册通知。
 *
 * 与售后工单共用同一套 SMTP / Webhook 出口，但**不写工单表**——
 * 「有人注册了」是运营信号，不该混进待处理的客诉队列。
 * 未配置渠道时静默跳过（与工单通知行为一致），永不抛异常。
 *
 * 之所以需要这个函数：注册接口以前从不触发任何通知，
 * 所以即便配好了邮箱 / 机器人，有人注册也依然「一点反应都没有」。
 */
export async function notifySignup({ account, group_nickname, game_id, ip, platform, created_at }) {
  const nick = String(group_nickname || '').trim() || String(account || '').trim() || '（未命名）';
  return notifySupportReport({
    kind: 'signup',
    category: 'signup',
    message: `新用户注册：${nick}\nSteamID：${game_id || '未填写'}\n登录账号：${account || '—'}`,
    detail: { account, group_nickname, game_id, ip, platform, created_at },
    account_name: nick,
    ip,
    platform,
    created_at,
  });
}
