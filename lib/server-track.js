/**
 * 服务端访问埋点。
 *
 * 为什么需要：原来的埋点只有客户端一条路（_app.js 里发 /api/track），
 * 一旦手机端 JS 没跑起来，页面看着是死的，管理后台的访问统计也查无此人 ——
 * 用户报障时我们连「他到底有没有访问过」都无法确认（2026-10-22 线上问题）。
 *
 * 服务端在 getServerSideProps 里直接落一条 page_view，就不依赖客户端了。
 *
 * 两个必须注意的点：
 * 1. 只记「文档请求」。Next.js 的 <Link> 预取和客户端跳转会打 x-nextjs-data: 1
 *    的数据请求，同样会跑一遍 getServerSideProps；不排除掉的话，鼠标划过链接
 *    就算一次访问，统计直接被刷爆。
 * 2. 因此数据请求里 __pageViewTracked 为 false —— 那种情况客户端会自己上报，
 *    两边正好互补，不会重复计数（见 pages/_app.js 里的去重）。
 */
import { insertPageView } from './db';
import { getSession } from './auth';
import { getClientIp } from './rate-limit';

/**
 * 是否为 Next.js 的数据请求（预取 / 客户端跳转），而非一次真实的页面访问。
 *
 * 两个判据都留着：不同 Next 版本下发来的标志不一样，只看一个会在某个版本上漏判，
 * 结果就是「鼠标划过链接也算一次访问」，统计被预取流量刷爆。
 */
function isDataRequest(req) {
  if (!req || !req.headers) return false;
  if (req.headers['x-nextjs-data'] === '1') return true;
  if (req.headers['x-nextjs-data-1'] !== undefined) return true;
  if (req.headers.rsc || req.headers['next-router-prefetch']) return true;
  if (req.url && String(req.url).indexOf('/_next/data/') !== -1) return true;
  return false;
}

/**
 * 记一次服务端页面访问。
 * @returns {boolean} 是否已经记过（true 时前端应跳过自己的上报，避免重复计数）
 */
export async function trackServerPageView(req, path) {
  if (process.env.TRACK_DEBUG) {
    console.log('[track-debug]', JSON.stringify({
      url: req && req.url,
      data: isDataRequest(req),
      xnd: req && req.headers && req.headers['x-nextjs-data'],
      rsc: req && req.headers && req.headers.rsc,
      prefetch: req && req.headers && req.headers['next-router-prefetch'],
    }));
  }
  if (isDataRequest(req)) return false;
  try {
    const session = getSession(req);
    await insertPageView({
      account_name: session ? session.name : null,
      path: String(path || '/').slice(0, 200),
      referer: (req.headers && req.headers.referer) || null,
      ua: (req.headers && req.headers['user-agent']) || null,
      ip: getClientIp(req),
    });
    return true;
  } catch (e) {
    // 埋点写不进去绝不能让页面挂掉：用户只是少一条统计，页面还得正常出
    console.error('服务端埋点写入失败:', e && e.message);
    return false;
  }
}
