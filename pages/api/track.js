/**
 * 访问埋点：记录「谁在什么时候看了哪个页面」。
 *
 * 设计取舍：
 * - 一律返回 204（无内容）。埋点不是核心业务，失败绝不能影响用户操作。
 * - 只记页面路径，忽略 /api/* 和 /_next/*，避免把自己刷爆。
 * - 按 IP 限流，超出静默丢弃：这里要的是活跃度画像，不是精确 PV（那由 GoAccess 负责）。
 * - 未登录也记，account_name 留空，用于统计匿名访问量。
 */
import { getSession } from '../../lib/auth';
import { insertPageView } from '../../lib/db';
import { getClientIp } from '../../lib/rate-limit';

const buckets = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 60;

function allow(ip) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.start >= WINDOW_MS) {
    buckets.set(ip, { start: now, n: 1 });
    // 简单防膨胀：条目太多时清一次过期项
    if (buckets.size > 500) {
      for (const [k, v] of buckets) {
        if (now - v.start >= WINDOW_MS) buckets.delete(k);
      }
    }
    return true;
  }
  b.n += 1;
  return b.n <= MAX_PER_WINDOW;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const ip = getClientIp(req);
    if (!allow(ip)) return res.status(204).end();

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const path = String(body.path || '').slice(0, 200);

    // 只记前端页面，接口和静态资源没有统计价值
    if (!path.startsWith('/')) return res.status(204).end();
    if (path.startsWith('/api/') || path.startsWith('/_next/')) return res.status(204).end();

    const session = getSession(req);

    await insertPageView({
      account_name: session ? session.name : null,
      path,
      referer: req.headers.referer || null,
      ua: req.headers['user-agent'] || null,
      ip,
    });
  } catch (error) {
    // 数据库不可用、表没建好等等，都不能让前端看到错误
    console.error('访问埋点写入失败:', error.message);
  }

  return res.status(204).end();
}
