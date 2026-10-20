import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import useSession from '../hooks/useSession';
import { footerAccountItems } from '../lib/nav-items.mjs';

const NAV = [
  { href: '/', label: '首页' },
  { href: '/tournaments', label: '赛事信息' },
  { href: '/members', label: '群友信息' },
  { href: '/food', label: '群友美食' },
];

export default function Layout({ children }) {
  const router = useRouter();
  const { pathname } = router;
  const { me, name, isAdmin, logout, ready } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    await logout();
    setLoggingOut(false);
    // 需要登录才能看的页面，登出后直接回首页，避免停在无权页
    if (pathname === '/main' || pathname.startsWith('/main/')) {
      router.replace('/');
    }
  };

  // 登录页保持纯净，不套用社区导航与页脚
  if (pathname === '/login') {
    return <>{children}</>;
  }

  const isActive = (href) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="site-root">
      <header className="site-nav">
        <div className="wrap nav-inner">
          <Link href="/" className="logo">
            <span className="mark">刀</span> 深圳LaRoja<b>Dota2社区</b>
          </Link>
          <nav className="nav-links">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={isActive(n.href) ? 'active' : ''}>
                {n.label}
              </Link>
            ))}
            {ready && me && (
              <Link href="/profile" className={isActive('/profile') ? 'active' : ''}>
                个人信息
              </Link>
            )}
            {ready && me && (
              <Link href="/my-tournaments" className={isActive('/my-tournaments') ? 'active' : ''}>
                我的赛事
              </Link>
            )}
          </nav>
          <div className="nav-right">
            {!ready ? (
              <span className="nav-user-placeholder" aria-hidden="true" />
            ) : me ? (
              <>
                <span className="nav-user" title={isAdmin ? '管理员' : '已登录'}>
                  {isAdmin && <span className="nav-role">管理</span>}
                  <span className="nav-user-name">{name}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleLogout}
                  disabled={loggingOut}
                >
                  {loggingOut ? '登出中…' : '登出'}
                </button>
              </>
            ) : (
              <Link href="/login" className="btn btn-ghost">
                登录
              </Link>
            )}
            <Link href="/members" className="btn btn-primary">
              进入社区
            </Link>
          </div>
        </div>
      </header>

      <main className="site-main">{children}</main>

      <footer className="site-footer">
        <div className="wrap">
          <div className="cols">
            <div>
              <div className="logo" style={{ color: '#fff' }}>
                <span className="mark">刀</span> 深圳LaRoja<b style={{ color: 'var(--accent)' }}>Dota2社区</b>
              </div>
              <p style={{ marginTop: 10, fontSize: '.85rem', maxWidth: 300 }}>
                不止 Dota2：吃饭、攀岩、游泳、爬山、篮球、骑车，日常都在组织。
                <br />
                本页信息均由群友提供。
              </p>
            </div>
            <div>
              <h5>板块</h5>
              <Link href="/tournaments">赛事信息</Link>
              <Link href="/members">群友信息</Link>
              <Link href="/food">群友美食</Link>
              <Link href="/members/assign">阵容分配</Link>
            </div>
            <div>
              <h5>社区</h5>
              <Link href="#">关于我们</Link>
              <Link href="#">加入群聊</Link>
              <Link href="#">投稿美食</Link>
              <Link href="#">反馈建议</Link>
            </div>
            <div>
              <h5>账号</h5>
              {/* ready 之前不渲染，避免已登录用户先看到「登录 / 注册」再跳变 */}
              {ready &&
                footerAccountItems(me).map((item) => {
                  if (item.type === 'user') {
                    return (
                      <span className="footer-user" key={item.key}>
                        {item.label}
                      </span>
                    );
                  }
                  if (item.type === 'action') {
                    return (
                      <a
                        href="#"
                        key={item.key}
                        onClick={(e) => {
                          e.preventDefault();
                          handleLogout();
                        }}
                      >
                        {item.label}
                      </a>
                    );
                  }
                  return (
                    <Link href={item.href} key={item.key}>
                      {item.label}
                    </Link>
                  );
                })}
            </div>
          </div>
          <div className="copy">
            © 2026 深圳LaRoja Dota2社区 · 网页信息均由群友提供，数据仅限内部使用。
          </div>
        </div>
      </footer>
    </div>
  );
}
