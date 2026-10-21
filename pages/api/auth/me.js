import { getSession, isAdmin, clearSessionCookie } from '../../../lib/auth';
import { pool, ensurePasswordResetColumns } from '../../../lib/db';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'GET') {
    const session = getSession(req);

    // 被管理员重置过密码的账号，全站守卫要靠这个标记把人推到改密页
    let mustChangePassword = false;
    if (session) {
      try {
        await ensurePasswordResetColumns();
        const r = await pool.query(
          'SELECT coalesce(must_change_password, false) AS m FROM public.play_score WHERE name = $1',
          [session.name]
        );
        mustChangePassword = !!r.rows[0]?.m;
      } catch (e) {
        // 查失败不能让登录态失效，退化成「不需要改密」
        console.error('读取改密标记失败:', e.message);
      }
    }

    return res.status(200).json({
      loggedIn: !!session,
      name: session ? session.name : null,
      isAdmin: isAdmin(req),
      mustChangePassword,
    });
  }

  // 退出登录
  if (req.method === 'DELETE') {
    clearSessionCookie(res);
    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', ['GET', 'DELETE']);
  return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
}
