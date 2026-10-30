/**
 * 单张照片上传：收到 dataURL → 认文件头 → 落盘 → 只回一个相对路径。
 *
 * 为什么一次只传一张：
 *   - 单张失败不影响其它张，前端可以只重传出错的那张；
 *   - 请求体小（压缩后 200~400KB），弱网下不会整批超时。
 *
 * ⚠ 这里**不做内容审核**（用户选的是「直接公开 + 管理员可删」）。
 *   想收紧就在这个位置加 mediaCheckAsync，其余调用方不用改。
 */
import { getSession, denyIfNotLoggedIn } from '../../../lib/auth';
import { getClientIp } from '../../../lib/rate-limit';
import { allowAction, MAX_PHOTO_BYTES } from '../../../lib/memories.mjs';
import { saveDataUrl } from '../../../lib/memory-store.mjs';

// base64 比原图大 1/3，4MB 原图 ≈ 5.4MB 请求体，留点余量
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  }

  const session = getSession(req);
  if (denyIfNotLoggedIn(req, res, '登录后才能上传照片')) return;

  const gate = allowAction('upload:' + ((session && session.name) || getClientIp(req)), 60);
  if (!gate.ok) {
    return res
      .status(429)
      .json({ success: false, error: `传得太快了，${gate.retryAfterSec} 秒后再试` });
  }

  try {
    const body = req.body || {};
    const out = await saveDataUrl(body.data, { maxBytes: MAX_PHOTO_BYTES });
    if (!out.ok) return res.status(400).json({ success: false, error: out.error });
    return res.status(201).json({ success: true, p: out.p });
  } catch (e) {
    console.error('[memories] 照片落盘失败:', e);
    return res.status(500).json({ success: false, error: '照片没存上，重试一次' });
  }
}
