/**
 * 照片读取：/api/media/memories/2026/10/<uuid>.jpg
 *
 * 为什么不让 Nginx 直接出静态：站点的 Nginx 配置在宝塔面板里，
 * 每次加 location 都得动面板；走这个路由则**部署完就能用**，零服务器配置。
 * 图片设了 immutable 长缓存，重复浏览不会再打到 Node。
 *
 * 安全：
 *   - 只接受 memories/YYYY/MM/<uuid>.<jpg|png|webp> 这一种形状（白名单正则），
 *     其它一律 404 —— 天然挡掉 `..` 穿越和读取任意文件；
 *   - 校验通过后仍然用 path.join 拼绝对路径，并且只读不写。
 */
import fs from 'fs';
import { isPhotoPath } from '../../../lib/memories.mjs';
import { openStored } from '../../../lib/memory-store.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', ['GET', 'HEAD']);
    return res.status(405).json({ success: false, error: '方法不允许' });
  }

  const seg = req.query.path;
  const rel = Array.isArray(seg) ? seg.join('/') : String(seg || '');
  if (!isPhotoPath(rel)) {
    return res.status(404).json({ success: false, error: '没有这张照片' });
  }

  const { abs, mime, exists } = openStored(rel);
  if (!exists) return res.status(404).json({ success: false, error: '没有这张照片' });

  // 文件名带 uuid，内容永不变，可以放心 immutable
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'HEAD') {
    const st = await fs.promises.stat(abs);
    res.setHeader('Content-Length', String(st.size));
    return res.status(200).end();
  }

  const stream = fs.createReadStream(abs);
  stream.on('error', (e) => {
    console.error('[media] 读取失败:', rel, e && e.message);
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  return stream.pipe(res);
}
