import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSession from '../../hooks/useSession';
import ActivityCard from '../../components/ActivityCard';
import ActivityForm from '../../components/ActivityForm';
import { ACTIVITY_TYPES } from '../../lib/options.mjs';
import { regionShort } from '../../lib/regions';

// 帖子时间 → 本地日期 key（YYYY-MM-DD），用于按天筛选
const dateKeyOf = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function ActivitiesPage() {
  const { me: session, ready } = useSession();

  const [posts, setPosts] = useState([]);
  const [me, setMe] = useState(null); // 含 bound / nickname
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [showExpired, setShowExpired] = useState(false); // 过期活动折叠区默认收起
  const [q, setQ] = useState('');
  const [dateFilter, setDateFilter] = useState(''); // 按日期查历史记录（YYYY-MM-DD，本地时区）
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    setError('');
    fetch('/api/activities')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setPosts(d.posts || []);
          setMe(d.me || null);
        } else {
          setError(d.error || '加载失败');
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message || '加载失败');
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, session]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return posts.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (regionFilter !== 'all' && p.region !== regionFilter) return false;
      // 选了日期 = 查那天的记录：忽略状态/过期条件，历史贴也要能翻到
      if (dateFilter && dateKeyOf(p.meet_at) !== dateFilter) return false;
      // 「只看招募中」= 状态 open 且还没过期（时间过了的招不到人，不算招募中）
      if (!dateFilter && openOnly && (p.status !== 'open' || p.expired)) return false;
      if (!kw) return true;
      const hay = [
        p.title,
        p.creator.nickname,
        p.typeLabel,
        p.region,
        p.location,
        p.note,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(kw);
    });
  }, [posts, typeFilter, regionFilter, openOnly, q, dateFilter]);

  // 地区下拉选项：从现有活动的 region 聚合（RegionPicker 输出的标准化路径，直接做 value）
  const regionOptions = useMemo(() => {
    const seen = new Set();
    posts.forEach((p) => {
      if (p.region) seen.add(p.region);
    });
    return [...seen].sort((a, b) => a.localeCompare(b, 'zh'));
  }, [posts]);

  // 招募中（没过期）排前面正常展示；过期的一律折叠到底部，默认收起
  const activePosts = filtered.filter((p) => !p.expired);
  const expiredPosts = filtered.filter((p) => p.expired);
  const openCount = posts.filter((p) => p.status === 'open' && !p.expired).length;

  return (
    <>
      <Head>
        <title>活动招募 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <div className="hero-bar">
            <div className="hero-bar-main">
              <h1>
                活动<span className="hl">招募</span>
              </h1>
              <p>
                共 {openCount} 个招募中的活动 · 约饭、爬山、打球、钓鱼，发个局组上队友人
              </p>
            </div>
            <div className="hero-actions">
              {ready && session ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowForm((v) => !v)}
                >
                  {showForm ? '收起表单' : '+ 发起活动'}
                </button>
              ) : ready ? (
                <Link href="/login?from=/activities" className="btn btn-primary">
                  登录后发起活动
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {msg && <div className="adm-msg">{msg}</div>}

          {showForm && (
            <ActivityForm
              me={me}
              onClose={() => setShowForm(false)}
              onCreated={(id, title) => {
                setShowForm(false);
                setMsg(title ? `已发布「${title}」` : '活动已发布');
                load();
              }}
            />
          )}

          <div className="filter-bar">
            <div className="filter-field filter-field-search">
              <label>搜索</label>
              <div className="filter-search">
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="活动名称、昵称、地点、费用、备注…"
                  className={q ? 'is-active' : ''}
                />
                {q && (
                  <button
                    type="button"
                    className="filter-search-clear"
                    aria-label="清空搜索"
                    onClick={() => setQ('')}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            <div className="filter-field">
              <label>类型</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className={typeFilter !== 'all' ? 'is-active' : ''}
              >
                <option value="all">全部类型</option>
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label>地区</label>
              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className={regionFilter !== 'all' ? 'is-active' : ''}
              >
                <option value="all">全部地区</option>
                {regionOptions.map((r) => (
                  <option key={r} value={r}>
                    {regionShort(r) || r}
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-field">
              <label>日期</label>
              <div className="filter-date">
                <input
                  type="date"
                  value={dateFilter}
                  max="2100-12-31"
                  onChange={(e) => setDateFilter(e.target.value)}
                  className={dateFilter ? 'is-active' : ''}
                  aria-label="按日期查看活动记录"
                />
                {dateFilter && (
                  <button type="button" className="filter-date-clear" onClick={() => setDateFilter('')} aria-label="清除日期">
                    ×
                  </button>
                )}
              </div>
            </div>
            <div className="filter-field" style={{ flex: '0 0 auto' }}>
              <label>状态</label>
              <div className="chips">
                <button
                  type="button"
                  className={'chip' + (openOnly ? ' active' : '')}
                  onClick={() => setOpenOnly((v) => !v)}
                >
                  只看招募中
                </button>
              </div>
            </div>
            <div className="filter-summary">
              {dateFilter ? (
                <>
                  <b>{dateFilter}</b> 共 <b>{filtered.length}</b> 个
                </>
              ) : (
                <>
                  共 <b>{activePosts.length}</b> 个活动
                  {expiredPosts.length > 0 && (
                    <span className="filter-summary-sub">（另有 {expiredPosts.length} 条已过期，在下方折叠区）</span>
                  )}
                </>
              )}
            </div>
          </div>

          {loading && <div className="empty">加载中…</div>}
          {!loading && error && <div className="empty">加载失败：{error}</div>}
          {!loading && !error && posts.length === 0 && (
            <div className="empty">
              还没有人发起活动。
              <br />
              {ready && session ? (
                '点右上角「发起活动」当第一个吧。'
              ) : (
                <Link href="/login?from=/activities" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                  登录后发起第一个
                </Link>
              )}
            </div>
          )}
          {!loading && !error && posts.length > 0 && filtered.length === 0 && (
            <div className="empty">
              {dateFilter ? '这一天没有活动记录，换个日期看看。' : '没有符合筛选条件的活动，换个条件试试。'}
            </div>
          )}

          {dateFilter ? (
            /* 按日期查记录：平铺当天全部活动（含已过期/已关闭），不做折叠 */
            <div className="party-grid">
              {filtered.map((p) => (
                <ActivityCard
                  key={p.id}
                  post={p}
                  me={me}
                  onChanged={() => {
                    setMsg('');
                    load();
                  }}
                />
              ))}
            </div>
          ) : (
            <>
              <div className="party-grid">
                {activePosts.map((p) => (
                  <ActivityCard
                    key={p.id}
                    post={p}
                    me={me}
                    onChanged={() => {
                      setMsg('');
                      load();
                    }}
                  />
                ))}
              </div>

              {/* 过期活动折叠区：默认收起，点一下展开 */}
              {!loading && !error && expiredPosts.length > 0 && (
                <div className="pg-expired-fold">
                  <button type="button" className="pg-expired-toggle" onClick={() => setShowExpired((v) => !v)}>
                    <span className="pg-expired-arrow">{showExpired ? '▾' : '▸'}</span>
                    已过期活动（{expiredPosts.length}）
                    <span className="pg-expired-hint">{showExpired ? '收起' : '展开'}</span>
                  </button>
                  {showExpired && (
                    <div className="party-grid" style={{ marginTop: 12 }}>
                      {expiredPosts.map((p) => (
                        <ActivityCard
                          key={p.id}
                          post={p}
                          me={me}
                          onChanged={() => {
                            setMsg('');
                            load();
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
