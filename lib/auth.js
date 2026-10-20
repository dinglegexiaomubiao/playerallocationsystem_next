import crypto from 'crypto';

/**
 * 轻量会话：HMAC 签名的 httpOnly cookie。
 * 不引入额外依赖，密钥从环境变量派生（缺省时退化为 DATABASE_URL，保证各部署不同）。
 */

const ADMIN_NAME = 'dom';
const COOKIE_NAME = 'dd_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 天

const SECRET = crypto
  .createHash('sha256')
  .update(
    String(process.env.AUTH_SECRET || process.env.DATABASE_URL || 'dota2-community-local-dev')
  )
  .digest();

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function createToken(name) {
  const payload = Buffer.from(JSON.stringify({ n: String(name), t: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || !data.n) return null;
    if (!data.t || Date.now() - Number(data.t) > MAX_AGE_SEC * 1000) return null;
    return { name: String(data.n) };
  } catch {
    return null;
  }
}

// 从请求里取当前会话（未登录返回 null）
export function getSession(req) {
  const raw = req && req.cookies ? req.cookies[COOKIE_NAME] : null;
  return verifyToken(raw);
}

export function isAdmin(req) {
  const s = getSession(req);
  return !!s && s.name.toLowerCase() === ADMIN_NAME;
}

export function setSessionCookie(res, name) {
  const token = createToken(name);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/**
 * 批量导入（Excel）的服务端闸门。
 * 前端发起导入时会带上 x-excel-import: 1，此时必须是管理员；
 * 未带该头的普通单条新增不受影响。
 * 返回 true 表示被拒绝，调用方直接 return。
 */
export function denyIfImportNotAdmin(req, res) {
  if (req.headers['x-excel-import'] !== '1') return false;
  if (isAdmin(req)) return false;
  res.status(403).json({
    success: false,
    error: 'Excel 批量导入仅限管理员操作，请使用管理员账号登录后再试',
  });
  return true;
}

export { ADMIN_NAME, COOKIE_NAME };
