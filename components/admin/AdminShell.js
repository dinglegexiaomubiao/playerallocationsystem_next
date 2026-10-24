import Head from 'next/head';
import Link from 'next/link';

/**
 * 后台统一外壳：页头 + 一级导航 + 数据条。
 *
 * 为什么要有这个东西：7 个后台页各自复制了一份导航，已经漂移了 ——
 * 「活动管理」那页漏了「赛事管理」（回不到首页）、「开黑管理」那页把活动排到了开黑前面、
 * `赛事详情` 和 `/main` 干脆没有后台导航。复制粘贴的导航一定会漂，只能收成一份。
 *
 * 用法：
 *   <AdminShell title="群友" accent="管理" active="members"
 *               lead="补资料、改昵称、管账号"
 *               metrics={[{ n: 172, label: '群友' }, { n: 68, label: '缺 SteamID', warn: true }]}
 *               actions={<>...</>}>
 *     ...页面正文
 *   </AdminShell>
 *
 * 约定：
 * - `active` 写导航项的 key（赛事详情页也写 tournaments）—— 不靠路径自动匹配，
 *   因为 /admin/tournaments/12 用 startsWith('/admin') 会同时点亮「赛事」和别的项。
 * - `metrics` 是**一条**数据条，不是四张卡。真的没数就整个不传，别拿 0 凑数。
 * - `preview` 是想「去前台看看这条长什么样」时的跳转，后台每页几乎都需要。
 */

const NAV = [
  {
    label: '赛事',
    items: [
      // 这一项叫「赛季」不叫「赛事」：分组标签已经写了「赛事」，
      // 两项都写会变成「赛事 赛事 战绩」，读起来像重复了
      { key: 'tournaments', href: '/admin', label: '赛季' },
      { key: 'matches', href: '/admin/matches', label: '战绩' },
    ],
  },
  {
    label: '社区',
    items: [
      { key: 'members', href: '/admin/members', label: '群友' },
      { key: 'guilds', href: '/admin/guilds', label: '帮派' },
      { key: 'food', href: '/admin/food', label: '美食' },
      { key: 'reviews', href: '/admin/reviews', label: '评价' },
      { key: 'quotes', href: '/admin/quotes', label: '语录' },
      { key: 'party', href: '/admin/party', label: '开黑' },
      { key: 'activities', href: '/admin/activities', label: '活动' },
      { key: 'messages', href: '/admin/messages', label: '留言' },
    ],
  },
  {
    label: '站务',
    items: [
      { key: 'support', href: '/admin/support', label: '反馈' },
      { key: 'analytics', href: '/admin/analytics', label: '访问' },
      { key: 'roster', href: '/main', label: '阵容' },
    ],
  },
];

export default function AdminShell({
  title,
  accent = '',
  lead = '',
  active = '',
  metrics = null,
  actions = null,
  preview = null,
  badges = null,
  children,
}) {
  return (
    <>
      <Head>
        <title>{title + (accent || '') + ' · 管理后台'}</title>
      </Head>

      <section className="adm-shell">
        <div className="wrap">
          <AdminNav active={active} preview={preview} badges={badges} />

          <div className="adm-pagehead">
            <div className="adm-pagehead-main">
              <h1>
                {title}
                {accent ? <span className="hl">{accent}</span> : null}
              </h1>
              {lead ? <p className="adm-lead">{lead}</p> : null}
            </div>
            {actions ? <div className="adm-actions">{actions}</div> : null}
          </div>

          {metrics && metrics.length > 0 && <Metrics items={metrics} />}

          {children}
        </div>
      </section>
    </>
  );
}

/** 一级导航。组与组之间一条竖线，当前页是下划线而不是实心药丸 */
export function AdminNav({ active = '', preview = null, badges = null }) {
  return (
    <nav className="adm-nav" aria-label="后台导航">
      {NAV.map((group) => (
        <div className="adm-nav-group" key={group.label}>
          <span className="adm-nav-label">{group.label}</span>
          {group.items.map((it) => {
            const on = it.key === active;
            const n = badges && badges[it.key];
            return (
              <Link
                key={it.key}
                href={it.href}
                className={'adm-nav-link' + (on ? ' is-on' : '')}
                aria-current={on ? 'page' : undefined}
              >
                {it.label}
                {n > 0 ? <span className="adm-nav-badge">{n}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
      {preview ? (
        <a className="adm-nav-link" href={preview.href} style={{ marginLeft: 'auto' }}>
          {preview.label || '看前台'} ↗
        </a>
      ) : null}
    </nav>
  );
}

/**
 * 一条数据（不是四张卡）。
 *
 * 每项 `{ n, label, warn, sub }`。没数据时传 `n: 0` 也照显 ——
 * 「0 个待处理」本身是有用的信息，比藏起来好。
 * `sub` 是标签下面那行小字（比如「昨日 320 · ↑12%」），只在真的想补充时给。
 */
export function Metrics({ items }) {
  return (
    <div className="adm-metrics">
      {items.map((m) => (
        <div className={'adm-metric' + (m.warn ? ' is-warn' : '')} key={m.label}>
          <div className="adm-metric-n">{m.n}</div>
          <div className="adm-metric-l">{m.label}</div>
          {m.sub ? <div className="adm-metric-sub">{m.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

/** 无权访问。三个后台页原来各写一份、文案还不一样，统一到这里 */
export function AdminDenied({ hint = '' }) {
  return (
    <div className="empty" style={{ padding: '110px 0' }}>
      这页只给管理员看。
      {hint ? <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-3)' }}>{hint}</div> : null}
      <div style={{ marginTop: 12 }}>
        <Link href="/" style={{ color: 'var(--brand)', fontWeight: 600 }}>
          回首页
        </Link>
      </div>
    </div>
  );
}
