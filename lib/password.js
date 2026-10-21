import crypto from 'crypto';

/**
 * 密码散列工具（登录 / 注册共用，避免两处逻辑漂移）
 *
 * 存储格式：`<salt>:<sha256(salt + password)>`
 * 历史格式：直接 `sha256(password)`（无盐），仅用于兼容存量账号，
 *          校验通过后由 verifyPassword 的调用方决定是否升级。
 */

export function hashPassword(password, salt = '') {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

export function hashPasswordWithSalt(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${hashPassword(password, salt)}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = String(stored).split(':');
  if (hash === undefined) {
    // 旧格式：无盐 SHA256
    return hashPassword(password) === stored;
  }
  return hashPassword(password, salt) === hash;
}

// 是否值得升级为加盐格式（旧格式 or 无盐）
export function needsRehash(stored) {
  return !!stored && !String(stored).includes(':');
}

/* ============================================================
   临时密码（管理员重置用）
   ------------------------------------------------------------
   为什么不用 `Math.random()`：它是可预测的 PRNG，知道若干输出就能推出后续。
   这里必须用 crypto.randomInt。

   去掉 0/O/1/l/I 这些易混字符：管理员要口头/微信念给群友，抄错一个字符
   就会变成「密码不对、再重置一次」的死循环。剩 32 个字符，8 位约 1.1e12 组合，
   配上登录接口「10 分钟 5 次」的限流，暴力猜基本不可行。
   ============================================================ */
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateTempPassword(len = 8) {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += TEMP_ALPHABET[crypto.randomInt(0, TEMP_ALPHABET.length)];
  }
  return out;
}

/** 新密码规则（注册/改密共用），返回错误文案或 null */
export function checkPasswordStrength(pwd) {
  const s = String(pwd || '');
  if (s.length < 6) return '密码至少 6 位';
  if (s.length > 64) return '密码不能超过 64 个字符';
  if (/^\s+$/.test(s)) return '密码不能只有空格';
  return null;
}
