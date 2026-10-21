/**
 * 管理员重置群友的登录密码（仅管理员）。
 *
 * 为什么不能「查原密码」：库里存的是 `salt:sha256(salt+password)`，单向不可逆。
 * 所以这里的语义是「作废旧密码 + 生成一次性临时密码」。
 *
 * POST { playerId } 或 { accountName }
 *   → 200 { ok, accountName, tempPassword, expiresHint }
 *
 * 三条安全约定：
 *   1. 临时密码用 crypto.randomInt 生成，且**明文只在这一次响应里返回**，
 *      不写库、不进日志。管理员关掉弹窗就再也看不到，只能再重置一次。
 *   2. 同时把 must_change_password 置 true：本人登录后会被强制先去改密码。
 *   3. 顺带清掉该账号的登录失败锁定，否则他刚拿到临时密码还是被挡在门外。
 */
import { denyIfNotAdmin, getSession } from '../../../lib/auth';
import { pool, ensurePasswordResetColumns } from '../../../lib/db';
import { hashPasswordWithSalt, generateTempPassword } from '../../../lib/password';
import { resetFail } from '../../../lib/rate-limit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ ok: false, error: `方法 ${req.method} 不被允许` });
  }

  if (denyIfNotAdmin(req, res, '仅管理员可重置密码')) return;

  const playerId = req.body?.playerId == null ? '' : String(req.body.playerId).trim();
  const accountName = String(req.body?.accountName || '').trim();

  if (!playerId && !accountName) {
    return res.status(400).json({ ok: false, error: '缺少 playerId 或 accountName' });
  }

  try {
    await ensurePasswordResetColumns();

    // 一个群友最多一个登录账号（play_score.player_id 有唯一索引）
    const found = playerId
      ? await pool.query(
          `SELECT s.name, p.nickname FROM public.play_score s
             LEFT JOIN public.players p ON p.id = s.player_id
            WHERE s.player_id = $1 LIMIT 1`,
          [playerId]
        )
      : await pool.query(
          `SELECT s.name, p.nickname FROM public.play_score s
             LEFT JOIN public.players p ON p.id = s.player_id
            WHERE s.name = $1 LIMIT 1`,
          [accountName]
        );

    if (found.rowCount === 0) {
      return res.status(404).json({
        ok: false,
        error: playerId ? '该群友还没有绑定登录账号，无法重置密码' : '账号不存在',
      });
    }

    const row = found.rows[0];
    const tempPassword = generateTempPassword(8);
    const by = getSession(req)?.name || 'admin';

    await pool.query(
      `UPDATE public.play_score SET
         password = $1,
         must_change_password = true,
         password_reset_at = now(),
         password_reset_by = $2
       WHERE name = $3`,
      [hashPasswordWithSalt(tempPassword), by, row.name]
    );

    // 他可能刚因为输错密码被锁住，解锁才能用新密码
    resetFail(`user:${String(row.name).toLowerCase()}`);

    return res.status(200).json({
      ok: true,
      accountName: row.name,
      nickname: row.nickname || null,
      tempPassword,
      // 前端只用这句提示，不要把规则散落到 UI 里
      expiresHint: '临时密码只在本次显示，登录后必须立刻改密',
      mustChangePassword: true,
    });
  } catch (e) {
    console.error('重置密码失败:', e);
    return res.status(500).json({ ok: false, error: '重置失败：' + e.message });
  }
}
