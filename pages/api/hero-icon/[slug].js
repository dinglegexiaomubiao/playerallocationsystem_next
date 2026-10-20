/**
 * 英雄头像代理：/api/hero-icon/{slug}
 *
 * 为什么不直接让前端引 Valve CDN：
 *   1. 国内访问 cdn.cloudflare.steamstatic.com 实测要 2s 左右，126 个英雄首屏会很卡；
 *   2. CDN 挂掉/被墙时整页都是裂图。
 * 走本机代理后，第一次回源、之后读 .cache/heroes/ 磁盘缓存，并给浏览器发
 * immutable 强缓存头，第二次起连请求都不会打到服务端。
 *
 * slug 走白名单校验（来自 lib/heroSlugs.js），避免变成任意 URL 的代理。
 */
import heroSlugByName from '../../../lib/heroSlugs';
import { getImage } from '../../../lib/image-cache';

const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes';
const VALID_SLUGS = new Set(Object.values(heroSlugByName));

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const raw = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  const slug = String(raw || '').replace(/\.(png|jpe?g|webp)$/i, '');
  if (!VALID_SLUGS.has(slug)) {
    return res.status(404).json({ success: false, error: '未知英雄' });
  }

  const img = await getImage('heroes', slug, `${CDN}/${slug}.png`);
  if (!img) {
    // 不缓存失败结果，下次访问还会再试一次
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ success: false, error: '英雄头像暂不可用' });
  }

  res.setHeader('Content-Type', img.contentType);
  // 英雄立绘基本不随版本变，可以放心长缓存
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Image-Cache', img.fromCache ? 'HIT' : 'MISS');
  res.setHeader('Content-Length', String(img.buffer.length));
  return res.status(200).end(img.buffer);
}
