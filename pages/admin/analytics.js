import Link from 'next/link';
import { getSession, isAdmin } from '../../lib/auth';
import { ensurePageViewTable, pool } from '../../lib/db';
import { toSerializable } from '../../lib/serialize.mjs';
import AdminShell, { AdminDenied } from '../../components/admin/AdminShell';

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

/* 纯 CSS 柱状图（不引图表库）：bars = [{label, value, sub}]
   柱子宽度设上限：只有 5 天数据时，70% 会变成一根 120px 的大红块，
   看着像「数据爆了」。压到 34px 之后 5 根和 24 根是同一套观感。 */
function BarChart({ bars, color = 'var(--brand)', height = 120 }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height, paddingTop: 6 }}>
      {bars.map((b, i) => (
        <div key={i} style={{ flex: 1, minWidth: 8, textAlign: 'center' }} title={`${b.label}：${b.value}${b.sub ? ' · ' + b.sub : ''}`}>
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 2 }}>{b.value || ''}</div>
          <div
            style={{
              height: `${Math.max(2, (b.value / max) * (height - 34))}px`,
              background: b.value > 0 ? color : 'var(--border)',
              borderRadius: 2,
              margin: '0 auto',
              width: '100%',
              maxWidth: 34,
            }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden' }}>{b.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPage({ denied, overview, trend, topUsers, topPaths, recent, hourly, newPlayers }) {
  if (denied) return <AdminDenied hint="访问数据只有管理员看得到。" />;

  // 环比：今日 vs 昨日
  const dPv = overview.pv || 0;
  const yPv = overview.pv_yesterday || 0;
  const diff = dPv - yPv;
  const diffPct = yPv > 0 ? Math.round((diff / yPv) * 100) : null;
  const weekPv = trend.reduce((s, r) => s + (r.pv || 0), 0);

  const yNote = `昨天 ${yPv}` + (diffPct === null ? '' : diff >= 0 ? ` · 多 ${diffPct}%` : ` · 少 ${Math.abs(diffPct)}%`);
  const badNew = newPlayers.filter((p) => missingOf(p).length > 0).length;

  return (
    <AdminShell
      title="访问"
      accent="统计"
      active="analytics"
      lead="谁看了哪个页面。应用层自己埋的点，和 Nginx 那套日志互相对得上。"
      metrics={[
        { n: dPv, label: '今日浏览', sub: yNote },
        { n: overview.uv ?? 0, label: '今日来的人' },
        { n: overview.users ?? 0, label: '其中登录的' },
        { n: weekPv, label: '近 7 日浏览', sub: `每天 ${Math.round(weekPv / 7)} 次` },
      ]}
      actions={
        <span className="adm-tool-note">
          30 天活跃 {overview.active_users ?? '—'} 人 · 匿名占 {overview.anon_pct == null ? '—' : overview.anon_pct + '%'} · 库里有{' '}
          {overview.total ?? 0} 条
        </span>
      }
    >
      <div className="adm-panel">
        <div className="adm-panel-head">
          <span className="adm-panel-title">最近 7 天</span>
          <span className="adm-panel-sub">柱子是浏览数，鼠标停一下能看到当天来了几个 IP</span>
        </div>
        {trend.length === 0 ? (
          <div className="adm-empty">这 7 天还没有记录</div>
        ) : (
          <>
            <BarChart bars={[...trend].reverse().map((r) => ({ label: String(r.d).slice(5), value: r.pv, sub: `${r.uv} 个 IP` }))} />
            <div className="adm-scroll" style={{ marginTop: 12 }}>
              <table className="adm-data">
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    <th scope="col" className="is-num">浏览</th>
                    <th scope="col" className="is-num">访客</th>
                    <th scope="col" className="is-num">登录</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((r) => (
                    <tr key={r.d}>
                      <td className="is-nowrap">{String(r.d).slice(0, 10)}</td>
                      <td className="is-num">{r.pv}</td>
                      <td className="is-num">{r.uv}</td>
                      <td className="is-num">{r.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head">
          <span className="adm-panel-title">一天里什么时候有人在</span>
          <span className="adm-panel-sub">近 30 天，按小时。晚上那一坨就是群里开黑的时间</span>
        </div>
        {hourly.some((h) => h.pv > 0) ? (
          <BarChart bars={hourly.map((h) => ({ label: `${h.h}`, value: h.pv }))} color="var(--gold)" height={100} />
        ) : (
          // 全 0 时柱状图是一排看不见的 2px 细线，不如直接说没数据
          <div className="adm-empty">这段时间还没有记录</div>
        )}
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head">
          <span className="adm-panel-title">最近注册</span>
          <span className="adm-panel-sub">
            最近 8 个
            {badNew > 0 ? (
              <>
                {' · '}
                <strong style={{ color: 'var(--color-warning)' }}>{badNew}</strong> 位资料没填全，
                <Link href="/admin/members" style={{ color: 'var(--brand)' }}>
                  去群友页补 →
                </Link>
              </>
            ) : null}
          </span>
        </div>
        <div className="adm-scroll">
          <table className="adm-data">
            <thead>
              <tr>
                <th scope="col">群昵称</th>
                <th scope="col">SteamID</th>
                <th scope="col">绑定账号</th>
                <th scope="col">资料</th>
                <th scope="col">注册</th>
              </tr>
            </thead>
            <tbody>
              {newPlayers.length === 0 && (
                <tr>
                  <td colSpan={5} className="is-weak" style={{ textAlign: 'center' }}>
                    还没有人注册
                  </td>
                </tr>
              )}
              {newPlayers.map((p) => {
                const miss = missingOf(p);
                return (
                  <tr key={p.id}>
                    <td className="is-strong">{p.group_nickname || p.nickname || '没起名'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{p.game_id || '—'}</td>
                    <td>{p.account || <span className="is-weak">没绑</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {miss.length === 0 ? (
                        <span className="adm-chip is-ok">齐了</span>
                      ) : (
                        <span className="adm-chip is-warn">缺 {miss.join('、')}</span>
                      )}
                    </td>
                    <td className="is-nowrap is-weak">{fmtDate(p.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 两列：活跃用户 + 热门页面。minmax(0,1fr) + 子项 min-width:0，
          否则长路径会把右边那列挤成一条 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
        <div className="adm-panel" style={{ margin: 0, minWidth: 0 }}>
          <div className="adm-panel-head">
            <span className="adm-panel-title">谁来得最勤</span>
            <span className="adm-panel-sub">近 30 天</span>
          </div>
          <div className="adm-scroll">
            <table className="adm-data">
              <thead>
                <tr>
                  <th scope="col">账号</th>
                  <th scope="col" className="is-num">浏览</th>
                  <th scope="col">最后来的</th>
                </tr>
              </thead>
              <tbody>
                {topUsers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="is-weak" style={{ textAlign: 'center' }}>
                      还没有
                    </td>
                  </tr>
                )}
                {topUsers.map((r) => (
                  <tr key={r.account_name}>
                    <td>{r.account_name}</td>
                    <td className="is-num">{r.pv}</td>
                    <td className="is-nowrap is-weak">{fmtTime(r.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="adm-panel" style={{ margin: 0, minWidth: 0 }}>
          <div className="adm-panel-head">
            <span className="adm-panel-title">大家在看什么</span>
            <span className="adm-panel-sub">近 30 天</span>
          </div>
          <div className="adm-scroll">
            <table className="adm-data">
              <thead>
                <tr>
                  <th scope="col">页面</th>
                  <th scope="col" className="is-num">浏览</th>
                  <th scope="col" className="is-num">访客</th>
                </tr>
              </thead>
              <tbody>
                {topPaths.length === 0 && (
                  <tr>
                    <td colSpan={3} className="is-weak" style={{ textAlign: 'center' }}>
                      还没有
                    </td>
                  </tr>
                )}
                {topPaths.map((r) => (
                  <tr key={r.path}>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.path}</td>
                    <td className="is-num">{r.pv}</td>
                    <td className="is-num">{r.uv}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="adm-panel">
        <div className="adm-panel-head">
          <span className="adm-panel-title">最近 50 次访问</span>
          <span className="adm-panel-sub">按时间倒着排</span>
        </div>
        <div className="adm-scroll">
          <table className="adm-data">
            <thead>
              <tr>
                <th scope="col">时间</th>
                <th scope="col">账号</th>
                <th scope="col">页面</th>
                <th scope="col">平台</th>
                <th scope="col">IP</th>
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="is-weak" style={{ textAlign: 'center' }}>
                    还没有
                  </td>
                </tr>
              )}
              {recent.map((r, i) => (
                <tr key={i}>
                  <td className="is-nowrap">{fmtTime(r.created_at)}</td>
                  <td>{r.account_name || <span className="is-weak">没登录</span>}</td>
                  <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.path}</td>
                  <td className="is-weak">{uaPlatform(r.ua)}</td>
                  <td className="is-weak">{r.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="adm-tool-note" style={{ margin: 0 }}>
        这里记的是「谁看了什么」，Nginx 那套是全量流量，两者互补。想看原始请求日志去 <code>/stats/</code>（要密码）。
      </p>
    </AdminShell>
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
      props: toSerializable({
        denied: false,
        overview: ov.rows[0],
        trend: tr.rows,
        topUsers: us.rows,
        topPaths: pa.rows,
        recent: rc.rows,
        hourly,
        newPlayers: np.rows.map((r) => ({ ...r, id: String(r.id) })),
      }),
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
