import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import useSession from '../hooks/useSession';
import ThemeToggle from './ThemeToggle';
import GuildInvitePrompt from './GuildInvitePrompt';
import { footerAccountItems } from '../lib/nav-items.mjs';

// 顶级导航：只放「全站板块」，个人相关入口按登录态追加
// 注意：这里是永不折行的原子单元，每一项都在偷宽度预算。
// 「我的赛事」已并入「个人信息」与「赛事信息」两页，不再单独占一个 tab。
const PRIMARY_NAV = [
  { href: '/', label: '首页' },
  { href: '/party', label: '开黑组队' },
  { href: '/activities', label: '活动招募' },
  { href: '/tournaments', label: '赛事信息' },
  { href: '/members', label: '群友信息' },
  { href: '/guilds', label: '帮派' },
  { href: '/map', label: '群友分布' },
  { href: '/food', label: '群友美食' },
];

// 登录后追加的次级入口
const ACCOUNT_NAV = [{ href: '/profile', label: '个人信息' }];

export default function Layout({ children }) {
  const router = useRouter();
  const { pathname } = router;
  const { me, name, isAdmin, logout, ready, refresh } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);
  // 窄屏抽屉菜单
  const [menuOpen, setMenuOpen] = useState(false);
  const firstRender = useRef(true);

  // 换页后自动收起抽屉，避免残留在新页面上
  //
  // 顺带解决一个真实 bug：登录/登出都是客户端跳转（router.push），
  // Layout 不会重新挂载，useSession 也就不会重新拉身份 —— 结果登录成功回到首页后
  // 导航还停在「登录/注册」，要么刷新才生效。这里在换页后补一次身份刷新。
  useEffect(() => {
    setMenuOpen(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    refresh();
  }, [pathname, refresh]);

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

  // 登录页保持纯净，不套用社区导航与页脚。
  // 但它同样需要能切日夜 —— 否则用户在这个页面被锁在某个主题里。
  if (pathname === '/login') {
    return (
      <>
        <div className="theme-toggle-floating">
          <ThemeToggle />
        </div>
        {children}
      </>
    );
  }

  const isActive = (href) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  const navItems = ready && me ? [...PRIMARY_NAV, ...ACCOUNT_NAV] : PRIMARY_NAV;

  // 导航右侧账号区（桌面）与抽屉底部（窄屏）复用同一份结构
  const accountBlock = !ready ? (
    <span className="nav-user-placeholder" aria-hidden="true" />
  ) : me ? (
    <>
      <span className="nav-user" title={isAdmin ? '管理员' : '已登录'}>
        {isAdmin && <span className="nav-role">管理</span>}
        <span className="nav-user-name">{name}</span>
      </span>
      {isAdmin && (
        <Link href="/admin" className="btn btn-sm btn-primary">
          管理后台
        </Link>
      )}
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={handleLogout}
        disabled={loggingOut}
      >
        {loggingOut ? '登出中…' : '登出'}
      </button>
    </>
  ) : (
    <>
      <Link href="/login" className="btn btn-sm btn-ghost">
        登录
      </Link>
      <Link href="/register" className="btn btn-sm btn-primary">
        注册
      </Link>
    </>
  );

  return (
    <div className={'site-root' + (pathname.startsWith('/admin') ? ' is-admin' : '')}>
      <header className="site-nav">
        <div className="wrap nav-inner">
          <Link href="/" className="logo" aria-label="深圳LaRoja Dota2社区 · 返回首页">
            <span className="mark" aria-hidden="true">
              刀
            </span>
            <span className="logo-text">
              <span className="logo-name">深圳LaRoja</span>
              <span className="logo-sub">Dota2 Community</span>
            </span>
          </Link>

          <nav className="nav-links" aria-label="主导航">
            {navItems.map((n) => (
              <Link key={n.href} href={n.href} className={isActive(n.href) ? 'active' : ''}>
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="nav-right">
            <ThemeToggle />
            {accountBlock}
          </div>

          <button
            type="button"
            className="nav-toggle"
            aria-label={menuOpen ? '关闭导航菜单' : '打开导航菜单'}
            aria-expanded={menuOpen}
            aria-controls="site-nav-drawer"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>

        {menuOpen && (
          <div className="nav-drawer" id="site-nav-drawer">
            <div className="wrap nav-drawer-inner">
              {navItems.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={'nav-drawer-link' + (isActive(n.href) ? ' active' : '')}
                >
                  {n.label}
                </Link>
              ))}
              <div className="nav-drawer-actions">
                <ThemeToggle className="is-drawer" />
                {accountBlock}
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="site-main">{children}</main>

      <footer className="site-footer">
        <div className="wrap">
          <div className="cols">
            <div>
              <div className="logo" style={{ color: 'var(--text)' }}>
                <span className="mark">刀</span>
                <span className="logo-text">
                  <span className="logo-name">深圳LaRoja</span>
                  <span className="logo-sub">Dota2 Community</span>
                </span>
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
              <Link href="/guilds">帮派</Link>
              <Link href="/food">群友美食</Link>
              <Link href="/party">开黑组队</Link>
              <Link href="/members/assign">阵容分配</Link>
              <Link href="/changelog">更新日志</Link>
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

      {/* 帮派邀请弹窗：挂在全局，进站有一次机会弹出来。
          自己处理「只弹一次」与「登录页不弹」的逻辑，这里不用加条件。 */}
      <GuildInvitePrompt />
    </div>
  );
}
