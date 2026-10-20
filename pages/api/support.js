// 售后 / 反馈：POST 收集（公开，含未登录时的加载报错），GET / PATCH 管理（仅管理员）
import {
  insertSupportReport,
  countRecentSimilarReports,
  listSupportReports,
  updateSupportReport,
  ensureSupportTable,
} from '../../lib/db';
import { getSession, isAdminName, denyIfNotAdmin } from '../../lib/auth';
import { getClientIp } from '../../lib/rate-limit';
import { notifySupportReport, supportNotifyConfigured } from '../../lib/notify';

// 每类来源的入库上限：10 分钟内同一 IP、同一分类最多 3 条。
// 前端已经做了去重，这里再兜一层，避免有人手动刷接口把表写爆。
const DEDUPE_WINDOW_MIN = 10;
const DEDUPE_MAX = 3;

// 进程内硬限流：无论什么分类，同一 IP 每分钟最多 20 次
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 20;
const rlBuckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const b = rlBuckets.get(ip);
  if (!b || b.resetAt <= now) {
    rlBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  b.count += 1;
  if (rlBuckets.size > 1000) {
    for (const [k, v] of rlBuckets) if (v.resetAt <= now) rlBuckets.delete(k);
  }
  return b.count > RATE_MAX;
}

// 从 UA 里解析出「系统 · 浏览器」，比存一整串 UA 更好扫
function parsePlatform(ua) {
  if (!ua) return null;
  const s = String(ua);
  let os = '未知系统';
  if (/Windows NT 10\.0/.test(s)) os = 'Windows 10/11';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Android/.test(s)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  let br = '未知浏览器';
  if (/MicroMessenger/i.test(s)) br = '微信内置浏览器';
  else if (/\bQQ\//.test(s)) br = 'QQ 内置浏览器';
  else if (/Edg\//.test(s)) br = 'Edge';
  else if (/OPR\/|Opera/.test(s)) br = 'Opera';
  else if (/Firefox\//.test(s)) br = 'Firefox';
  else if (/Chrome\//.test(s)) br = 'Chrome';
  else if (/Safari\//.test(s)) br = 'Safari';

  const m = /(?:Chrome|Firefox|Edg|OPR)\/(\d+)/.exec(s);
  return `${os} · ${br}${m ? ' ' + m[1] : ''}`;
}

// 技术细节只留扁平、短小的字段：不接收嵌套结构，也不接收超长串
function sanitizeDetail(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  const keys = Object.keys(input).slice(0, 20);
  for (const k of keys) {
    const v = input[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 500);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => String(x).slice(0, 100));
  }
  return Object.keys(out).length ? out : null;
}

const clip = (v, n) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, n) : null;
};

export default async function handler(req, res) {
  try {
    await ensureSupportTable();
  } catch (e) {
    console.error('售后表初始化失败:', e);
    return res.status(500).json({ success: false, error: '数据库未就绪' });
  }

  const session = getSession(req);

  // ---------- 提交（公开：未登录用户也要能报错/反馈） ----------
  if (req.method === 'POST') {
    const ip = getClientIp(req);
    if (rateLimited(ip)) {
      return res.status(429).json({ success: false, error: '提交太频繁，请稍后再试' });
    }

    const b = req.body || {};
    const kind = b.kind === 'error' ? 'error' : 'feedback';
    const message = clip(b.message, 4000);
    const category = clip(b.category, 30);

    if (kind === 'feedback' && !message) {
      return res.status(400).json({ success: false, error: '请先描述你遇到的问题或想要的功能' });
    }
    if (kind === 'error' && !message && !category) {
      return res.status(400).json({ success: false, error: '缺少错误信息' });
    }

    // 同源 + 同错误内容短时间内重复上报直接丢弃（返回成功，避免前端反复重试）
    try {
      const recent = await countRecentSimilarReports({
        kind,
        ip,
        category,
        message,
        withinMinutes: DEDUPE_WINDOW_MIN,
      });
      if (recent >= DEDUPE_MAX) {
        return res.status(200).json({ success: true, deduped: true });
      }
    } catch (e) {
      // 去重失败不影响主流程
    }

    let saved;
    try {
      saved = await insertSupportReport({
        kind,
        category,
        message,
        detail: sanitizeDetail(b.detail),
        page_url: clip(b.page_url, 1000),
        account_name: session ? session.name : clip(b.account_name, 60),
        is_admin: session ? isAdminName(session.name) : false,
        user_agent: clip(req.headers['user-agent'], 500),
        platform: parsePlatform(req.headers['user-agent']),
        ip,
        contact: clip(b.contact, 120),
      });
    } catch (e) {
      console.error('写入售后表失败:', e);
      return res.status(500).json({ success: false, error: '提交失败，请稍后再试' });
    }

    // 通知是「尽力而为」：失败只记原因，不影响用户端的结果
    let notify = { ok: false, skipped: true };
    try {
      notify = await notifySupportReport({
        id: saved.id,
        kind,
        category,
        message,
        detail: sanitizeDetail(b.detail),
        page_url: clip(b.page_url, 1000),
        account_name: session ? session.name : clip(b.account_name, 60),
        is_admin: false,
        platform: parsePlatform(req.headers['user-agent']),
        ip,
        contact: clip(b.contact, 120),
        created_at: saved.created_at,
      });
    } catch (e) {
      notify = { ok: false, error: e.message || String(e) };
    }

    try {
      if (notify.ok) {
        await updateSupportReport(saved.id, { notified_at: new Date().toISOString() });
      } else if (!notify.skipped) {
        await updateSupportReport(saved.id, { notify_error: notify.error || '通知失败' });
      }
    } catch (e) {
      /* 状态回写失败可忽略 */
    }

    return res.status(200).json({ success: true, id: saved.id, notified: notify.ok });
  }

  // ---------- 列表（管理员） ----------
  if (req.method === 'GET') {
    if (denyIfNotAdmin(req, res, '仅管理员可查看售后工单')) return;
    const { kind, status, limit, offset } = req.query;
    try {
      const data = await listSupportReports({ kind, status, limit, offset });
      return res.status(200).json({ success: true, ...data, notify: supportNotifyConfigured() });
    } catch (e) {
      console.error('读取售后表失败:', e);
      return res.status(500).json({ success: false, error: '读取失败' });
    }
  }

  // ---------- 改状态（管理员） ----------
  if (req.method === 'PATCH') {
    if (denyIfNotAdmin(req, res, '仅管理员可处理工单')) return;
    const { id, status } = req.body || {};
    if (!id || !status) {
      return res.status(400).json({ success: false, error: '缺少 id 或 status' });
    }
    const ok = await updateSupportReport(id, { status: clip(status, 20) });
    return res.status(ok ? 200 : 404).json({ success: ok });
  }

  res.setHeader('Allow', ['POST', 'GET', 'PATCH']);
  return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
}
