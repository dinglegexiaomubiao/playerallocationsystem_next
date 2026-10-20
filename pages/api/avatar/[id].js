/**
 * 选手头像：/api/avatar/{playerId}
 *
 * 取图顺序（每一层都是缓存）：
 *   1. 进程内 Map（60s）—— 一个页面上同一选手的头像可能被请求多次
 *   2. players.avatar_url（7 天内有效）—— 抓过一次就落库，不重复打 OpenDota
 *   3. 用 game_id（Dota2 account_id）现抓一次 OpenDota，成功后顺手落库
 *   4. 图片本身再进 .cache/avatars/ 磁盘缓存
 *
 * 全链路失败就返回 404，前端自动回退到「昵称首字」的色块头像。
 */
import { pool, ensureAvatarColumns } from '../../../lib/db';
import { getImage } from '../../../lib/image-cache';
import { fetchPlayerProfile, normalizeAccountId } from '../../../lib/steam';

const URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MEM_TTL_MS = 60 * 1000;

// playerId -> { url, ts }，避免图片反复加载时每次都查库
const mem = new Map();
const MEM_MAX = 300;

function remember(id, url) {
  if (mem.size >= MEM_MAX) {
    const first = mem.keys().next();
    if (!first.done) mem.delete(first.value);
  }
  mem.set(String(id), { url, ts: Date.now() });
}

async function resolveAvatarUrl(playerId) {
  const key = String(playerId);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.ts < MEM_TTL_MS) return hit.url;

  const { rows } = await pool.query(
    'SELECT game_id, avatar_url, avatar_synced_at FROM public.players WHERE id = $1',
    [playerId]
  );
  if (!rows.length) return null;
  const row = rows[0];

  const syncedAt = row.avatar_synced_at ? new Date(row.avatar_synced_at).getTime() : 0;
  const fresh = row.avatar_url && Date.now() - syncedAt < URL_TTL_MS;
  if (fresh) {
    remember(key, row.avatar_url);
    return row.avatar_url;
  }

  const accountId = normalizeAccountId(row.game_id);
  if (!accountId) {
    remember(key, null);
    return null;
  }

  const profile = await fetchPlayerProfile(accountId);
  if (!profile) {
    // 抓不到也别死循环重试，记一个空值撑一会儿
    remember(key, row.avatar_url || null);
    return row.avatar_url || null;
  }

  await pool.query(
    'UPDATE public.players SET avatar_url = $1, steam_name = COALESCE($2, steam_name), avatar_synced_at = NOW() WHERE id = $3',
    [profile.avatarfull, profile.personaname, playerId]
  );
  remember(key, profile.avatarfull);
  return profile.avatarfull;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const raw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const playerId = String(raw || '').trim();
  if (!/^\d{1,20}$/.test(playerId)) {
    return res.status(400).json({ success: false, error: '选手 id 不合法' });
  }

  try {
    await ensureAvatarColumns();
    const url = await resolveAvatarUrl(playerId);
    if (!url) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(404).json({ success: false, error: '暂无头像' });
    }

    const img = await getImage('avatars', playerId, url);
    if (!img) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(404).json({ success: false, error: '头像下载失败' });
    }

    res.setHeader('Content-Type', img.contentType);
    // 头像是会换的，缓存 1 天；磁盘层的 7 天 TTL 到点会自动回源
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Image-Cache', img.fromCache ? 'HIT' : 'MISS');
    res.setHeader('Content-Length', String(img.buffer.length));
    return res.status(200).end(img.buffer);
  } catch (error) {
    console.error('[avatar] 取头像失败:', error.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ success: false, error: '取头像失败' });
  }
}
