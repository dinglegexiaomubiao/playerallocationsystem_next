import Head from 'next/head';
import Link from 'next/link';
import { getSession, isAdmin } from '../../lib/auth';
import { ensurePageViewTable, pool } from '../../lib/db';

const fmtTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* 从 UA 粗提平台，给「最近访问」多一列可读信息 */
const uaPlatform = (ua) => {
  const s = String(ua || '');
  if (/Windows/i.test(s)) return 'Windows';
  if (/iPhone|iPad|iPod/i.test(s)) return 'iOS';
  if (/Android/i.test(s)) return 'Android';
  if (/Macintosh|Mac OS/i.test(s)) return 'macOS';
  if (/Linux/i.test(s)) return 'Linux';
  return '—';
};

/* 新注册的人常常只填了账号和昵称，分数/位置/地区都留空。
   这里算出来，后台一眼就能看出谁需要去补资料。 */
const missingOf = (p) => {
  const miss = [];
  if (p.score === null || p.score === undefined || Number(p.score) === 0) miss.push('分数');
  if (!String(p.positions || '').trim()) miss.push('位置');
  if (!String(p.region || '').trim()) miss.push('地区');
  return miss;
};

/* 纯 CSS 柱状图（不引图表库）：bars = [{label, value, sub}] */
function BarChart({ bars, color = 'var(--brand, #2563eb)', height = 120 }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height, paddingTop: 6 }}>
      {bars.map((b, i) => (
        <div key={i} style={{ flex: 1, minWidth: 8, textAlign: 'center' }} title={`${b.label}：${b.value}${b.sub ? ' · ' + b.sub : ''}`}>
          <div style={{ fontSize: 10, color: 'var(--text-2)', marginBottom: 2 }}>{b.value || ''}</div>
          <div
            style={{
              height: `${Math.max(2, (b.value / max) * (height - 34))}px`,
              background: b.value > 0 ? color : 'var(--border, #ddd)',
              borderRadius: 3,
              margin: '0 auto',
              width: '70%',
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden' }}>{b.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage({ denied, overview, trend, topUsers, topPaths, recent, hourly, newPlayers }) {
  if (denied) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        无权访问
        <br />
        <Link href="/" style={{ color: 'var(--brand)', fontWeight: 600 }}>返回首页</Link>
      </div>
    );
  }

  // 卡片统一用 .adm-card（layout.css，深色令牌）。
  // 原来写的是 var(--bg-2, #fff)，而 --bg-2 这个变量根本不存在 → 回退成白底，
  // 夜间模式下七块白卡特别刺眼。顺带加了 grid，宽屏一行排 7 个。
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 };

  // 环比：今日 vs 昨日
  const dPv = overview.pv || 0;
  const yPv = overview.pv_yesterday || 0;
  const diff = dPv - yPv;
  const diffPct = yPv > 0 ? Math.round((diff / yPv) * 100) : null;
  const weekPv = trend.reduce((s, r) => s + (r.pv || 0), 0);

  return (
    <>
      <Head>
        <title>访问统计 · 管理后台</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>访问<span className="hl">统计</span></h1>
          <p>页面浏览埋点 · 活跃用户 · 热门路径 · 新注册</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="adm-tabs" style={{ marginBottom: 16 }}>
            <Link className="adm-tab" href="/admin">赛事管理</Link>
            <Link className="adm-tab" href="/admin/members">群友管理</Link>
            <Link className="adm-tab" href="/admin/food">美食管理</Link>
            <Link className="adm-tab" href="/admin/party">开黑管理</Link>
              <Link className="adm-tab" href="/admin/activities">活动管理</Link>
            <Link className="adm-tab" href="/main">阵容分配</Link>
            <span className="adm-tab active">访问统计</span>
            <Link className="adm-tab" href="/admin/support">群友反馈</Link>
          </div>

          {/* 概览卡片：今日 + 环比 + 周期汇总。
              每项都兜底成 '—'：某天统计表还没写入时是 undefined，
              直接渲染会出现「只有标签、没有数字」的空卡片。 */}
          <div style={grid}>
            {[
              { n: dPv ?? 0, l: '今日浏览 (PV)', sub: `昨日 ${yPv}${diffPct === null ? '' : diff >= 0 ? ` · ↑${diffPct}%` : ` · ↓${Math.abs(diffPct)}%`}` },
              { n: overview.uv ?? 0, l: '今日访客 (IP)' },
              { n: overview.users ?? 0, l: '今日登录用户' },
              { n: weekPv ?? 0, l: '近 7 日 PV', sub: `日均 ${Math.round(weekPv / 7)}` },
              { n: overview.active_users ?? '—', l: '30 日活跃用户' },
              { n: `${overview.anon_pct == null ? '—' : overview.anon_pct + '%'}`, l: '30 日匿名占比' },
              { n: overview.total ?? 0, l: '累计记录' },
            ].map((s) => (
              <div className="adm-card" key={s.l}>
                <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--brand)', fontVariantNumeric: 'tabular-nums' }}>{s.n}</div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>{s.l}</div>
                {s.sub && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* 7 天趋势柱状图 + 表 */}
          <h3 style={{ margin: '28px 0 10px', fontSize: 16 }}>最近 7 天趋势</h3>
          <div className="adm-card">
            {trend.length === 0 ? (
              <div style={{ color: 'var(--text-3)', padding: 20, textAlign: 'center' }}>暂无数据</div>
            ) : (
              <BarChart bars={[...trend].reverse().map((r) => ({ label: String(r.d).slice(5), value: r.pv, sub: `${r.uv} 个 IP` }))} />
            )}
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table className="adm-table" style={{ width: '100%' }}>
                <thead>
                  <tr><th>日期</th><th>浏览</th><th>访客(IP)</th><th>登录用户</th></tr>
                </thead>
                <tbody>
                  {trend.map((r) => (
                    <tr key={r.d}>
                      <td>{String(r.d).slice(0, 10)}</td>
                      <td>{r.pv}</td>
                      <td>{r.uv}</td>
                      <td>{r.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 时段分布 */}
          <h3 style={{ margin: '28px 0 10px', fontSize: 16 }}>时段分布（近 30 天，按小时）</h3>
          <div className="adm-card">
            {hourly.some((h) => h.pv > 0) ? (
              <BarChart bars={hourly.map((h) => ({ label: `${h.h}时`, value: h.pv }))} color="var(--ok)" height={100} />
            ) : (
              // 全 0 时柱状图是一排看不见的 2px 细线，不如直接说没数据
              <div style={{ color: 'var(--text-3)', padding: 20, textAlign: 'center' }}>暂无数据</div>
            )}
          </div>

          {/* 最近注册：谁刚加入（匿名访客注册后第一时间在这里可见） */}
          <h3 style={{ margin: '28px 0 10px', fontSize: 16 }}>最近注册</h3>
          {(() => {
            const bad = newPlayers.filter((p) => missingOf(p).length > 0).length;
            if (newPlayers.length === 0 || bad === 0) return null;
            return (
              <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-2)' }}>
                这 {newPlayers.length} 位里有 <strong style={{ color: 'var(--accent, #c23c2a)' }}>{bad}</strong> 位资料不全，
                <Link href="/admin/members" style={{ color: 'var(--brand)', marginLeft: 4 }}>去群友管理补录 →</Link>
              </p>
            );
          })()}
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table" style={{ width: '100%' }}>
              <thead>
                <tr><th>群昵称</th><th>SteamID</th><th>绑定账号</th><th>资料</th><th>注册时间</th></tr>
              </thead>
              <tbody>
                {newPlayers.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)' }}>暂无注册记录</td></tr>
                )}
                {newPlayers.map((p) => {
                  const miss = missingOf(p);
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 600 }}>{p.group_nickname || p.nickname || '未命名'}</td>
                      <td style={{ fontFamily: 'monospace' }}>{p.game_id || '—'}</td>
                      <td>{p.account || <span style={{ color: 'var(--text-3)' }}>未绑定</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {miss.length === 0 ? (
                          <span style={{ color: 'var(--ok, #16a34a)', fontSize: 12 }}>齐全</span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '1px 8px',
                              borderRadius: 999,
                              fontSize: 12,
                              background: 'var(--accent-soft, #fdecea)',
                              color: 'var(--accent, #c23c2a)',
                            }}
                          >
                            缺 {miss.join('、')}
                          </span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--text-3)' }}>{fmtDate(p.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 两列：活跃用户 + 热门页面 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginTop: 28 }}>
            <div>
              <h3 style={{ marginBottom: 10, fontSize: 16 }}>活跃用户（近 30 天）</h3>
              <table className="adm-table" style={{ width: '100%' }}>
                <thead>
                  <tr><th>账号</th><th>浏览</th><th>最后访问</th></tr>
                </thead>
                <tbody>
                  {topUsers.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-3)' }}>暂无数据</td></tr>
                  )}
                  {topUsers.map((r) => (
                    <tr key={r.account_name}>
                      <td>{r.account_name}</td>
                      <td>{r.pv}</td>
                      <td>{fmtTime(r.last)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 style={{ marginBottom: 10, fontSize: 16 }}>热门页面（近 30 天）</h3>
              <table className="adm-table" style={{ width: '100%' }}>
                <thead>
                  <tr><th>路径</th><th>浏览</th><th>访客</th></tr>
                </thead>
                <tbody>
                  {topPaths.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-3)' }}>暂无数据</td></tr>
                  )}
                  {topPaths.map((r) => (
                    <tr key={r.path}>
                      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.path}</td>
                      <td>{r.pv}</td>
                      <td>{r.uv}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 最近明细 */}
          <h3 style={{ margin: '28px 0 10px', fontSize: 16 }}>最近访问</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table" style={{ width: '100%' }}>
              <thead>
                <tr><th>时间</th><th>账号</th><th>页面</th><th>平台</th><th>IP</th></tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-3)' }}>暂无数据</td></tr>
                )}
                {recent.map((r, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.created_at)}</td>
                    <td>{r.account_name || <span style={{ color: 'var(--text-3)' }}>匿名</span>}</td>
                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.path}</td>
                    <td style={{ color: 'var(--text-3)' }}>{uaPlatform(r.ua)}</td>
                    <td style={{ color: 'var(--text-3)' }}>{r.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 18, fontSize: 12, color: 'var(--text-3)' }}>
            说明：这里是应用层埋点（谁看了什么），与 Nginx 日志统计互补。
            未登录的访问记为「匿名」，注册登录后的访问会自动带上账号；新注册的群友在「最近注册」里可见。
            Nginx 全量流量报表见 <code>/stats/</code>（需密码）。
          </p>
        </div>
      </section>
    </>
  );
}

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) {
    return { redirect: { destination: '/login?from=/admin/analytics', permanent: false } };
  }
  if (!isAdmin(req)) {
    return { props: { denied: true, overview: {}, trend: [], topUsers: [], topPaths: [], recent: [], hourly: [], newPlayers: [] } };
  }

  try {
    await ensurePageViewTable();

    const [ov, tr, us, pa, rc, hr, np] = await Promise.all([
      pool.query(`
        SELECT
          count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS pv,
          count(*) FILTER (WHERE created_at >= date_trunc('day', now()) - interval '1 day'
                             AND created_at < date_trunc('day', now()))::int AS pv_yesterday,
          count(DISTINCT ip) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS uv,
          count(DISTINCT account_name) FILTER (WHERE created_at >= date_trunc('day', now()) AND account_name IS NOT NULL)::int AS users,
          count(DISTINCT account_name) FILTER (WHERE account_name IS NOT NULL AND created_at >= now() - interval '30 days')::int AS active_users,
          round(100.0 * count(*) FILTER (WHERE account_name IS NULL AND created_at >= now() - interval '30 days')
                / GREATEST(count(*) FILTER (WHERE created_at >= now() - interval '30 days'), 1))::int AS anon_pct,
          count(*)::int AS total
        FROM public.page_views
      `),
      pool.query(`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d,
               count(*)::int AS pv,
               count(DISTINCT ip)::int AS uv,
               count(DISTINCT account_name) FILTER (WHERE account_name IS NOT NULL)::int AS users
          FROM public.page_views
         WHERE created_at >= now() - interval '7 days'
         GROUP BY 1 ORDER BY 1 DESC
      `),
      pool.query(`
        SELECT account_name, count(*)::int AS pv, max(created_at) AS last
          FROM public.page_views
         WHERE account_name IS NOT NULL AND created_at >= now() - interval '30 days'
         GROUP BY 1 ORDER BY pv DESC LIMIT 10
      `),
      pool.query(`
        SELECT path, count(*)::int AS pv, count(DISTINCT ip)::int AS uv
          FROM public.page_views
         WHERE created_at >= now() - interval '30 days'
         GROUP BY 1 ORDER BY pv DESC LIMIT 10
      `),
      pool.query(`
        SELECT account_name, path, ip, ua, created_at
          FROM public.page_views
         ORDER BY created_at DESC LIMIT 50
      `),
      pool.query(`
        SELECT extract(hour from created_at)::int AS h, count(*)::int AS pv
          FROM public.page_views
         WHERE created_at >= now() - interval '30 days'
         GROUP BY 1 ORDER BY 1
      `),
      // 最近注册的选手 + 绑定账号：匿名访客注册后第一时间在这里可见。
      // 排序必须用 id 而不是 created_at —— created_at 是 varchar 且只到「天」，
      // 同一天注册的人全部并列，LIMIT 8 会随机截断，刚落地的账号可能被挤出去。
      pool.query(`
        SELECT p.id, p.nickname, p.group_nickname, p.game_id, p.created_at,
               p.score, p.positions, p.region, s.name AS account
          FROM public.players p
          LEFT JOIN public.play_score s ON s.player_id = p.id
         ORDER BY p.id DESC
         LIMIT 8
      `),
    ]);

    // 补齐 0~23 小时，缺的补 0
    const hourMap = new Map(hr.rows.map((r) => [Number(r.h), r.pv]));
    const hourly = Array.from({ length: 24 }, (_, h) => ({ h, pv: hourMap.get(h) || 0 }));

    return {
      props: {
        denied: false,
        overview: ov.rows[0],
        trend: tr.rows,
        topUsers: us.rows,
        topPaths: pa.rows,
        recent: rc.rows.map((r) => ({ ...r, created_at: r.created_at ? r.created_at.toISOString() : null })),
        hourly,
        newPlayers: np.rows.map((r) => ({ ...r, id: String(r.id) })),
      },
    };
  } catch (error) {
    console.error('统计页查询失败:', error.message);
    return {
      props: {
        denied: false,
        overview: { pv: 0, uv: 0, users: 0, total: 0 },
        trend: [],
        topUsers: [],
        topPaths: [],
        recent: [],
        hourly: [],
        newPlayers: [],
      },
    };
  }
}
