import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSession from '../../hooks/useSession';
import PartyCard from '../../components/PartyCard';
import PartyForm from '../../components/PartyForm';
import { PARTY_MODES } from '../../lib/options.mjs';

export default function PartyPage() {
  const { me: session, ready } = useSession();

  const [posts, setPosts] = useState([]);
  const [me, setMe] = useState(null); // 含 bound / score / positions / gameId
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modeFilter, setModeFilter] = useState('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => {
    setError('');
    fetch('/api/party')
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
      if (modeFilter !== 'all' && p.mode !== modeFilter) return false;
      if (openOnly && p.status !== 'open') return false;
      if (!kw) return true;
      const hay = [
        p.creator.nickname,
        p.game_id,
        p.play_time,
        p.my_rank,
        p.want_rank,
        p.note,
        p.modeLabel,
        (p.my_positions || []).join(' '),
        (p.want_positions || []).join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(kw);
    });
  }, [posts, modeFilter, openOnly, q]);

  const openCount = posts.filter((p) => p.status === 'open').length;

  return (
    <>
      <Head>
        <title>开黑组队 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <div className="hero-bar">
            <div className="hero-bar-main">
              <h1>
                开黑<span className="hl">组队</span>
              </h1>
              <p>
                共 {openCount} 张招募中的卡片 · 发一张卡片，队友报段位和上线时间，凑够 5 人就开
              </p>
            </div>
            <div className="hero-actions">
              {me && me.bound ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowForm((v) => !v)}
                >
                  {showForm ? '收起表单' : '+ 发起开黑'}
                </button>
              ) : ready ? (
                <Link href={session ? '/profile' : '/login?from=/party'} className="btn btn-primary">
                  {session ? '先补填选手资料' : '登录后发起开黑'}
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
            <PartyForm
              me={me}
              onClose={() => setShowForm(false)}
              onCreated={() => {
                setShowForm(false);
                setMsg('开黑卡片已发布');
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
                  placeholder="昵称、SteamID、段位、时间、备注…"
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
              <label>模式</label>
              <select
                value={modeFilter}
                onChange={(e) => setModeFilter(e.target.value)}
                className={modeFilter !== 'all' ? 'is-active' : ''}
              >
                <option value="all">全部模式</option>
                {PARTY_MODES.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
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
              共 <b>{filtered.length}</b> 张卡片
            </div>
          </div>

          {loading && <div className="empty">加载中…</div>}
          {!loading && error && <div className="empty">加载失败：{error}</div>}
          {!loading && !error && posts.length === 0 && (
            <div className="empty">
              还没有人发开黑卡片。
              <br />
              {me && me.bound ? (
                '点右上角「发起开黑」当第一个吧。'
              ) : (
                <Link href="/login?from=/party" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                  登录后发起第一张
                </Link>
              )}
            </div>
          )}
          {!loading && !error && posts.length > 0 && filtered.length === 0 && (
            <div className="empty">没有符合筛选条件的卡片，换个条件试试。</div>
          )}

          <div className="party-grid">
            {filtered.map((p) => (
              <PartyCard
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
