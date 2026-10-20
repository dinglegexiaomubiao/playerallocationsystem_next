import Link from 'next/link';
import { useRouter } from 'next/router';

const NAV = [
  { href: '/', label: '首页' },
  { href: '/tournaments', label: '赛事信息' },
  { href: '/members', label: '群友信息' },
  { href: '/food', label: '群友美食' },
];

export default function Layout({ children }) {
  const router = useRouter();
  const { pathname } = router;

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
            <span className="mark">刀</span> DOTA<b>群英荟</b>
          </Link>
          <nav className="nav-links">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={isActive(n.href) ? 'active' : ''}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="nav-right">
            <Link href="/login" className="btn btn-ghost">
              登录
            </Link>
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
                <span className="mark">刀</span> DOTA<b style={{ color: 'var(--accent)' }}>群英荟</b>
              </div>
              <p style={{ marginTop: 10, fontSize: '.85rem', maxWidth: 260 }}>
                一个属于我们自己的 Dota2 社区：赛事、群友、美食，全都在这里。
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
              <Link href="/login">登录</Link>
              <Link href="/login">注册</Link>
              <Link href="/login">管理后台</Link>
            </div>
          </div>
          <div className="copy">
            © 2026 DOTA 群英荟 · 社区由群友共建，数据仅限内部使用。
          </div>
        </div>
      </footer>
    </div>
  );
}
