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
