/**
 * 图片磁盘缓存：英雄头像、Steam 头像都走这里。
 *
 * 三层缓存，从快到慢：
 *   1. 内存 Map（同进程内，命中后连磁盘都不读）
 *   2. .cache/{kind}/{key} 磁盘文件（跨重启存活）
 *   3. 回源远端 URL（只有前两层都没有才会走）
 *
 * 另外做了 in-flight 去重：126 个英雄同时渲染时，同一个 slug 只会回源一次，
 * 其余请求等同一个 Promise —— 否则首屏就是 126 个并发外网请求，既慢又容易被限流。
 *
 * ⚠ 目录 .cache/ 已写进 .gitignore。如果部署环境是只读文件系统（如某些 Serverless），
 *   写盘会失败，此时自动降级成「只用内存缓存」，不阻断请求。
 */

const fs = require('fs');
const path = require('path');

const CACHE_ROOT = path.join(process.cwd(), '.cache');

const KINDS = {
  heroes: { dir: 'heroes', ttlMs: 30 * 24 * 60 * 60 * 1000 },   // 英雄头像基本不变，30 天
  avatars: { dir: 'avatars', ttlMs: 7 * 24 * 60 * 60 * 1000 },  // Steam 头像可能会换，7 天
};

// 内存缓存。key = `${kind}/${fileKey}`，value = { buffer, contentType, ts }
const memory = new Map();
const MEMORY_MAX = 240;

const inflight = new Map();

// 回源并发闸门。打开英雄弹窗时前端会一次请求 126 张图，
// 如果全部同时回源 Valve CDN，实测会有一半在超时后才陆续返回（首屏空白）。
// 限到 8 个并发，配合磁盘缓存与预热脚本，正常使用基本不会再触发回源。
const MAX_FETCH_CONCURRENT = 8;
let fetchActive = 0;
const fetchWaiters = [];

function acquireFetchSlot() {
  if (fetchActive < MAX_FETCH_CONCURRENT) {
    fetchActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => fetchWaiters.push(resolve));
}

function releaseFetchSlot() {
  fetchActive -= 1;
  if (fetchWaiters.length) {
    fetchActive += 1;
    fetchWaiters.shift()();
  }
}

function safeKey(key) {
  const s = String(key || '').trim();
  // 只允许字母数字下划线短横线点，杜绝 ../ 之类的路径穿越
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(s)) return null;
  return s;
}

function filePathOf(kind, key) {
  const conf = KINDS[kind];
  if (!conf) throw new Error('未知的缓存类型: ' + kind);
  const safe = safeKey(key);
  if (!safe) return null;
  return path.join(CACHE_ROOT, conf.dir, safe);
}

function remember(cacheKey, buffer, contentType) {
  if (memory.size >= MEMORY_MAX) {
    // 简单淘汰：删最早插入的一条（Map 保持插入顺序）
    const first = memory.keys().next();
    if (!first.done) memory.delete(first.value);
  }
  memory.set(cacheKey, { buffer, contentType, ts: Date.now() });
}

function contentTypeOf(url, fallback) {
  const u = String(url || '').toLowerCase();
  if (u.includes('.png')) return 'image/png';
  if (u.includes('.webp')) return 'image/webp';
  if (u.includes('.jpg') || u.includes('.jpeg')) return 'image/jpeg';
  return fallback || 'application/octet-stream';
}

/**
 * 取图片。命中磁盘/内存直接返回，否则回源并落盘。
 *
 * @param {'heroes'|'avatars'} kind
 * @param {string} key            缓存文件名（heroes 用 slug，avatars 用 playerId）
 * @param {string} remoteUrl      回源地址
 * @param {object} [opts]
 * @param {number} [opts.ttlMs]   覆盖默认 TTL
 * @param {number} [opts.timeout] 回源超时
 * @returns {Promise<null | { buffer: Buffer, contentType: string, fromCache: boolean }>}
 */
async function getImage(kind, key, remoteUrl, opts = {}) {
  const conf = KINDS[kind];
  if (!conf) throw new Error('未知的缓存类型: ' + kind);
  const safe = safeKey(key);
  if (!safe) return null;

  const cacheKey = kind + '/' + safe;
  const ttlMs = opts.ttlMs === undefined ? conf.ttlMs : opts.ttlMs;

  // 1) 内存
  const mem = memory.get(cacheKey);
  if (mem && Date.now() - mem.ts < ttlMs) {
    return { buffer: mem.buffer, contentType: mem.contentType, fromCache: true };
  }

  // 2) 磁盘
  const file = filePathOf(kind, safe);
  if (file) {
    try {
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs < ttlMs) {
        const buffer = fs.readFileSync(file);
        const contentType = contentTypeOf(file, contentTypeOf(remoteUrl));
        remember(cacheKey, buffer, contentType);
        return { buffer, contentType, fromCache: true };
      }
    } catch (error) {
      // 文件不存在或读不了，继续往下走
    }
  }

  // 3) 回源，同 key 并发只打一次
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const task = (async () => {
    try {
      await acquireFetchSlot();
      const res = await fetch(remoteUrl, {
        signal: AbortSignal.timeout(opts.timeout || 12000),
        headers: { 'User-Agent': 'playerallocation/1.0', Accept: 'image/*' },
      });
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length) return null;
      const contentType = (res.headers.get('content-type') || '').split(';')[0] || contentTypeOf(remoteUrl);

      remember(cacheKey, buffer, contentType);
      if (file) {
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, buffer);
        } catch (error) {
          // 只读文件系统：留个日志，内存缓存已生效，不影响本次返回
          console.warn('[image-cache] 写盘失败（降级为内存缓存）:', error.message);
        }
      }
      return { buffer, contentType, fromCache: false };
    } catch (error) {
      return null;
    } finally {
      releaseFetchSlot();
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, task);
  return task;
}

/** 预热用：只写盘不返回，失败静默 */
async function warm(kind, key, remoteUrl) {
  await getImage(kind, key, remoteUrl);
}

function stats() {
  return { memory: memory.size, inflight: inflight.size, root: CACHE_ROOT };
}

function clearMemory() {
  memory.clear();
}

module.exports = { getImage, warm, stats, clearMemory, CACHE_ROOT, KINDS };
