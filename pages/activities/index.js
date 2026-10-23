import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSession from '../../hooks/useSession';
import ActivityCard from '../../components/ActivityCard';
import ActivityForm from '../../components/ActivityForm';
import { ACTIVITY_TYPES } from '../../lib/options.mjs';

export default function ActivitiesPage() {
  const { me: session, ready } = useSession();

  const [posts, setPosts] = useState([]);
  const [me, setMe] = useState(null); // 含 bound / nickname
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [q, setQ] = useState('');
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
      if (openOnly && p.status !== 'open') return false;
      if (!kw) return true;
      const hay = [
        p.title,
        p.creator.nickname,
        p.typeLabel,
        p.region,
        p.location,
        p.cost,
        p.note,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(kw);
    });
  }, [posts, typeFilter, openOnly, q]);

  const openCount = posts.filter((p) => p.status === 'open').length;

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
              共 <b>{filtered.length}</b> 个活动
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
            <div className="empty">没有符合筛选条件的活动，换个条件试试。</div>
          )}

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
        </div>
      </section>
    </>
  );
}
