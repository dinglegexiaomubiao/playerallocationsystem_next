import { getSession, isAdmin, clearSessionCookie } from '../../../lib/auth';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'GET') {
    const session = getSession(req);
    return res.status(200).json({
      loggedIn: !!session,
      name: session ? session.name : null,
      isAdmin: isAdmin(req),
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
