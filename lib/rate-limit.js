/**
 * 轻量登录失败限流（内存版）。
 *
 * 设计取舍：
 * - 本项目是单人部署的小站，不需要 Redis；进程内 Map 足够挡住脚本暴力撞库。
 * - 进程重启后计数清零，属可接受行为（攻击者拿不到这个控制权）。
 * - 同时按 IP 和用户名两个维度计数：前者防单机爆破，后者防分布式撞同一个账号。
 */

const WINDOW_MS = 10 * 60 * 1000; // 10 分钟窗口
const MAX_FAILS = 5; // 窗口内最多失败 5 次
const SWEEP_LIMIT = 500; // Map 超过这个size才做一次过期清扫

const buckets = new Map();

// 取真实客户端 IP（兼容 Nginx / Vercel / 云函数等常见反代头）
export function getClientIp(req) {
  const xff = req && req.headers ? req.headers['x-forwarded-for'] : null;
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  const real = req && req.headers ? req.headers['x-real-ip'] : null;
  if (real) return String(real).trim();
  if (req && req.socket && req.socket.remoteAddress) return String(req.socket.remoteAddress);
  return 'unknown';
}

function sweep() {
  if (buckets.size < SWEEP_LIMIT) return;
  const t = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt <= t) buckets.delete(k);
  }
}

/**
 * 是否已被锁。返回 null 表示未锁；否则返回 { retryAfterSec, fails }。
 */
export function getLock(key) {
  const b = buckets.get(key);
  if (!b) return null;
  const t = Date.now();
  if (b.resetAt <= t) {
    buckets.delete(key);
    return null;
  }
  if (b.count < MAX_FAILS) return null;
  return { retryAfterSec: Math.max(1, Math.ceil((b.resetAt - t) / 1000)), fails: b.count };
}

/**
 * 记一次失败。返回 { count, remaining }。
 */
export function recordFail(key) {
  sweep();
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= t) {
    buckets.set(key, { count: 1, resetAt: t + WINDOW_MS });
    return { count: 1, remaining: MAX_FAILS - 1 };
  }
  b.count += 1;
  return { count: b.count, remaining: Math.max(0, MAX_FAILS - b.count) };
}

// 登录成功即清空该 key 的失败记录
export function resetFail(key) {
  buckets.delete(key);
}

export function formatRetry(sec) {
  if (sec >= 60) return `${Math.ceil(sec / 60)} 分钟`;
  return `${sec} 秒`;
}

export { MAX_FAILS, WINDOW_MS };
