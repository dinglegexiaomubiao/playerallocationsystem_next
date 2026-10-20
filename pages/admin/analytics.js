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

export default function AnalyticsPage({ denied, overview, trend, topUsers, topPaths, recent }) {
  if (denied) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        无权访问
        <br />
        <Link href="/" style={{ color: 'var(--brand)', fontWeight: 600 }}>返回首页</Link>
      </div>
    );
  }

  const card = { background: 'var(--bg-2, #fff)', border: '1px solid var(--line, #e5e5e5)', borderRadius: 12, padding: 18 };
  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 };

  return (
    <>
      <Head>
        <title>访问统计 · 管理后台</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>访问<span className="hl">统计</span></h1>
          <p>页面浏览埋点 · 活跃用户 · 热门路径</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="adm-tabs" style={{ marginBottom: 16 }}>
            <Link className="adm-tab" href="/admin">赛事管理</Link>
            <Link className="adm-tab" href="/members">群友管理</Link>
            <Link className="adm-tab" href="/food">美食管理</Link>
            <Link className="adm-tab" href="/main">阵容分配</Link>
            <span className="adm-tab active">访问统计</span>
          </div>

          {/* 概览卡片 */}
          <div style={grid}>
            {[
              { n: overview.pv, l: '今日浏览 (PV)' },
              { n: overview.uv, l: '今日访客 (IP)' },
              { n: overview.users, l: '今日登录用户' },
              { n: overview.total, l: '累计记录' },
            ].map((s) => (
              <div style={card} key={s.l}>
                <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--brand, #2563eb)' }}>{s.n}</div>
                <div style={{ fontSize: 13, color: 'var(--text-3, #888)', marginTop: 4 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* 趋势 */}
          <h3 style={{ margin: '28px 0 10px', fontSize: 16 }}>最近 7 天</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="adm-table" style={{ width: '100%' }}>
              <thead>
                <tr><th>日期</th><th>浏览</th><th>访客</th></tr>
              </thead>
              <tbody>
                {trend.length === 0 && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-3)' }}>暂无数据</td></tr>
                )}
                {trend.map((r) => (
                  <tr key={r.d}>
                    <td>{String(r.d).slice(0, 10)}</td>
                    <td>{r.pv}</td>
                    <td>{r.uv}</td>
                  </tr>
                ))}
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
                <tr><th>时间</th><th>账号</th><th>页面</th><th>IP</th></tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-3)' }}>暂无数据</td></tr>
                )}
                {recent.map((r, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(r.created_at)}</td>
                    <td>{r.account_name || <span style={{ color: 'var(--text-3)' }}>匿名</span>}</td>
                    <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.path}</td>
                    <td style={{ color: 'var(--text-3)' }}>{r.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 18, fontSize: 12, color: 'var(--text-3)' }}>
            说明：这里是应用层埋点（谁看了什么），与 Nginx 日志统计互补。
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
    return { props: { denied: true, overview: {}, trend: [], topUsers: [], topPaths: [], recent: [] } };
  }

  try {
    await ensurePageViewTable();

    const [ov, tr, us, pa, rc] = await Promise.all([
      pool.query(`
        SELECT
          count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS pv,
          count(DISTINCT ip) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS uv,
          count(DISTINCT account_name) FILTER (WHERE created_at >= date_trunc('day', now()) AND account_name IS NOT NULL)::int AS users,
          count(*)::int AS total
        FROM public.page_views
      `),
      pool.query(`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d,
               count(*)::int AS pv,
               count(DISTINCT ip)::int AS uv
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
        SELECT account_name, path, ip, created_at
          FROM public.page_views
         ORDER BY created_at DESC LIMIT 50
      `),
    ]);

    return {
      props: {
        denied: false,
        overview: ov.rows[0],
        trend: tr.rows,
        topUsers: us.rows,
        topPaths: pa.rows,
        recent: rc.rows.map((r) => ({ ...r, created_at: r.created_at ? r.created_at.toISOString() : null })),
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
      },
    };
  }
}
