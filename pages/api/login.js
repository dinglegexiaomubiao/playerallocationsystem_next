import { initDatabase, query } from '../../lib/db';
import { setSessionCookie, isAdminName } from '../../lib/auth';
import { getClientIp, getLock, recordFail, resetFail, formatRetry } from '../../lib/rate-limit';
import { hashPasswordWithSalt, verifyPassword, needsRehash } from '../../lib/password';
import { ensurePasswordResetColumns } from '../../lib/db';

let dbInitialized = false;

/**
 * 登录接口 —— 只校验已有账号，绝不建号
 *
 * 账号不存在一律返回 401，前端引导用户去 /register 走完整注册流程。
 * 建号逻辑集中在 /api/register，两者不再共用同一入口。
 */
export default async function handler(req, res) {
  if (!dbInitialized) {
    try {
      await initDatabase();
      dbInitialized = true;
    } catch (error) {
      console.error('数据库初始化失败:', error);
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  }

  const { username, password } = req.body || {};

  if (!username) {
    return res.status(400).json({ error: '用户名不能为空' });
  }

  const trimmedUsername = String(username).trim();
  const trimmedPassword = password ? String(password).trim() : '';

  if (!trimmedPassword) {
    return res.status(400).json({ error: '请输入密码' });
  }

  // ---- 登录失败限流：同一 IP 或同一账号在 10 分钟内失败 5 次即锁定 ----
  const limitKeys = [
    `ip:${getClientIp(req)}`,
    `user:${trimmedUsername.toLowerCase()}`,
  ];
  let locked = null;
  for (const k of limitKeys) {
    const st = getLock(k);
    if (st) {
      locked = st;
      break;
    }
  }
  if (locked) {
    res.setHeader('Retry-After', String(locked.retryAfterSec));
    return res.status(429).json({
      error: `登录尝试次数过多，请 ${formatRetry(locked.retryAfterSec)} 后再试`,
      retryAfterSec: locked.retryAfterSec,
    });
  }
  const markFail = () => {
    for (const k of limitKeys) recordFail(k);
  };
  const clearFail = () => {
    for (const k of limitKeys) resetFail(k);
  };

  try {
    // 管理员重置过密码的账号带 must_change_password，登录后要强制去改密
    await ensurePasswordResetColumns();

    const result = await query(
      `SELECT name, count, password, coalesce(must_change_password, false) AS must_change_password
         FROM public.play_score WHERE name = $1`,
      [trimmedUsername]
    );

    // ---- 账号不存在：不再自动注册，引导去注册页 ----
    if (result.rows.length === 0) {
      markFail();
      return res.status(401).json({
        error: '该账号不存在，请先注册',
        code: 'USER_NOT_FOUND',
      });
    }

    const user = result.rows[0];
    const existingPassword = user.password;

    // 存量账号若没有密码，不能靠「首次登录随便设一个」放行——
    // 那等于任何人知道用户名就能接管该账号。改由管理员重置。
    if (!existingPassword) {
      return res.status(401).json({
        error: '该账号尚未设置密码，请联系管理员重置',
        code: 'PASSWORD_NOT_SET',
      });
    }

    if (!verifyPassword(trimmedPassword, existingPassword)) {
      markFail();
      return res.status(401).json({ error: '密码错误' });
    }

    // 旧格式（无盐）密码校验通过后，自动升级为加盐格式
    if (needsRehash(existingPassword)) {
      await query(
        'UPDATE public.play_score SET password = $1 WHERE name = $2',
        [hashPasswordWithSalt(trimmedPassword), trimmedUsername]
      );
    }

    // 更新登录次数
    const updated = await query(
      'UPDATE public.play_score SET count = count + 1 WHERE name = $1 RETURNING count',
      [trimmedUsername]
    );
    // 下发会话 cookie，供后续接口识别身份（含管理员判定）
    clearFail();
    setSessionCookie(res, trimmedUsername);
    return res.status(200).json({
      name: trimmedUsername,
      count: updated.rows[0].count,
      message: '登录成功',
      isAdmin: isAdminName(trimmedUsername),
      // true 表示这个密码是管理员重置的临时密码，前端要强制他去改
      mustChangePassword: !!user.must_change_password,
    });
  } catch (error) {
    console.error('登录错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
}
