import fs from 'fs';
import path from 'path';

/**
 * GET /api/version —— 只回答一件事：服务器**现在**跑的是哪个构建。
 *
 * 存在的理由：页面 HTML 里也带着 buildId（`__NEXT_DATA__.buildId`）。
 * 两者不一致，就说明浏览器手上是旧 HTML，而它引用的 /_next/static/<旧buildId>/*
 * 在部署后已经 404 —— 这正是「页面能打开、但一条数据都没有」的成因。
 *
 * 诊断页 /diag 靠这个接口一眼判断用户是不是卡在旧版本上。
 */

let cached = null;

function readBuildId() {
  try {
    const p = path.join(process.cwd(), '.next', 'BUILD_ID');
    const id = fs.readFileSync(p, 'utf8').trim();
    if (id) return id;
  } catch {
    /* 读不到就返回 unknown，不要让诊断接口自己挂掉 */
  }
  return 'unknown';
}

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }
  // 进程内缓存：同一份构建不可能中途变，除非重新部署重启进程
  if (!cached) cached = readBuildId();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    buildId: cached,
    // 部署时间取 BUILD_ID 的 mtime，比「响应时间」更有用
    builtAt: (() => {
      try {
        return fs.statSync(path.join(process.cwd(), '.next', 'BUILD_ID')).mtime.toISOString();
      } catch {
        return null;
      }
    })(),
  });
}
