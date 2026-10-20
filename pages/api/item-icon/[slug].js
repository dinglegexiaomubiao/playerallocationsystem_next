/**
 * 物品图标代理：/api/item-icon/{slug}
 *
 * 和 /api/hero-icon 同一套路：本地磁盘缓存 + 白名单校验 + 长缓存头。
 * 一局比赛要渲染 10 人 × 6~9 个物品，直连 Valve CDN 在国内会明显拖慢首屏。
 *
 * slug 来自 lib/itemMapping.js（由 OpenDota constants 生成），
 * 只允许表里出现过的 slug，避免这个路由变成任意 URL 代理。
 */
import { ITEM_SLUGS } from '../../../lib/itemMapping';
import { getImage } from '../../../lib/image-cache';

const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const raw = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  const slug = String(raw || '').replace(/\.(png|jpe?g|webp)$/i, '');
  if (!ITEM_SLUGS.has(slug)) {
    return res.status(404).json({ success: false, error: '未知物品' });
  }

  const img = await getImage('items', slug, `${CDN}/${slug}.png`);
  if (!img) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ success: false, error: '物品图标暂不可用' });
  }

  res.setHeader('Content-Type', img.contentType);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Image-Cache', img.fromCache ? 'HIT' : 'MISS');
  return res.status(200).send(img.buffer);
}
