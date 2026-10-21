/**
 * 本人改密码（已登录）。
 *
 * POST { oldPassword, newPassword }
 *
 * 两种场景共用这一个接口：
 *   1. 正常改密：想换就换，要验旧密码；
 *   2. 被管理员重置后强制改密：旧密码 = 管理员给的临时密码，同样要验——
 *      这样「拿到临时密码的人」和「本人」是同一个，别人没法半路截走账号。
 *
 * 改完把 must_change_password 置 false，否则他会一直被困在改密页。
 */
import { getSession, denyIfNotLoggedIn } from '../../../lib/auth';
import { pool, ensurePasswordResetColumns } from '../../../lib/db';
import {
  hashPasswordWithSalt,
  verifyPassword,
  checkPasswordStrength,
} from '../../../lib/password';
import { getClientIp, recordFail, resetFail, getLock, formatRetry } from '../../../lib/rate-limit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ ok: false, error: `方法 ${req.method} 不被允许` });
  }

  if (denyIfNotLoggedIn(req, res, '请先登录')) return;
  const session = getSession(req);
  const name = session.name;

  const oldPassword = String(req.body?.oldPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');

  // 旧密码也要限流：否则登录后可以拿这个接口当「免限流的密码爆破器」
  const limitKey = `pwd:${name.toLowerCase()}:${getClientIp(req)}`;
  const lock = getLock(limitKey);
  if (lock) {
    res.setHeader('Retry-After', String(lock.retryAfterSec));
    return res.status(429).json({
      ok: false,
      error: `尝试次数过多，请 ${formatRetry(lock.retryAfterSec)} 后再试`,
    });
  }

  const weak = checkPasswordStrength(newPassword);
  if (weak) return res.status(400).json({ ok: false, error: weak });
  if (oldPassword === newPassword) {
    return res.status(400).json({ ok: false, error: '新密码不能和原密码相同' });
  }

  try {
    await ensurePasswordResetColumns();

    const r = await pool.query('SELECT name, password FROM public.play_score WHERE name = $1', [name]);
    if (r.rowCount === 0) {
      return res.status(404).json({ ok: false, error: '账号不存在' });
    }
    const { password: stored } = r.rows[0];

    if (!verifyPassword(oldPassword, stored)) {
      recordFail(limitKey);
      return res.status(401).json({ ok: false, error: '原密码不对' });
    }

    await pool.query(
      `UPDATE public.play_score SET
         password = $1,
         must_change_password = false
       WHERE name = $2`,
      [hashPasswordWithSalt(newPassword), name]
    );
    resetFail(limitKey);

    return res.status(200).json({ ok: true, message: '密码已更新' });
  } catch (e) {
    console.error('修改密码失败:', e);
    return res.status(500).json({ ok: false, error: '修改失败：' + e.message });
  }
}
