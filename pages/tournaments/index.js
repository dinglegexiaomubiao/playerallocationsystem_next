import { useState, useEffect, useMemo, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSession from '../../hooks/useSession';
import MyTournamentTable from '../../components/MyTournamentTable';
import TournamentFilterBar from '../../components/tournament/TournamentFilterBar';
import {
  mergeMyTournaments,
  statusGroup,
  STATUS_GROUP_LABEL,
} from '../../lib/tournament-format.mjs';

function fmt(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

const EMPTY_FILTER = { status: [], rel: [], q: '' };

/* 状态分组 → 列表里的颜色类名（.lr-status 只认 plan/live/done 三个） */
const STATUS_CLS = { planning: 'plan', live: 'live', finished: 'done' };

/* URL ↔ 筛选状态：刷新、分享、浏览器后退都要能还原 */
function readFilter(query) {
  const arr = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []);
  return {
    status: arr(query.status).filter((x) => ['planning', 'live', 'finished'].includes(x)),
    rel: arr(query.rel).filter((x) => ['signed', 'joined', 'captain', 'placed'].includes(x)),
    q: typeof query.q === 'string' ? query.q : '',
  };
}

export default function TournamentsPage() {
  const router = useRouter();
  const { me, ready } = useSession();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [mine, setMine] = useState([]);
  const [mineBound, setMineBound] = useState(true);
  const [mineLoading, setMineLoading] = useState(false);

  const [tab, setTab] = useState('all');
  const [filter, setFilter] = useState(EMPTY_FILTER);

  /* 首次进来从 URL 还原 tab 与筛选；之后只在用户操作时写回 */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!router.isReady || hydrated) return;
    setTab(router.query.tab === 'mine' ? 'mine' : 'all');
    setFilter(readFilter(router.query));
    setHydrated(true);
  }, [router.isReady, router.query, hydrated]);

  useEffect(() => {
    let alive = true;
    fetch('/api/tournaments')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setList(d.tournaments || []);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !me) {
      setMine([]);
      return;
    }
    let alive = true;
    setMineLoading(true);
    Promise.all([
      fetch('/api/profile').then((r) => r.json()).catch(() => ({})),
      fetch('/api/my-tournaments').then((r) => r.json()).catch(() => ({})),
    ])
      .then(([d, m]) => {
        if (!alive) return;
        setMine(mergeMyTournaments(d.tournaments || [], m.tournaments || []));
        setMineBound(m.bound !== false && d.bound !== false);
        setMineLoading(false);
      })
      .catch(() => alive && setMineLoading(false));
    return () => {
      alive = false;
    };
  }, [ready, me]);

  /* URL 同步：用 replace + shallow，避免每次点 chip 都进历史栈 */
  const syncUrl = useCallback(
    (nextTab, nextFilter) => {
      if (!hydrated) return;
      const q = {};
      if (nextTab === 'mine') q.tab = 'mine';
      if (nextFilter.status.length) q.status = nextFilter.status.join(',');
      if (nextFilter.rel.length) q.rel = nextFilter.rel.join(',');
      if (nextFilter.q) q.q = nextFilter.q;
      router.replace({ pathname: '/tournaments', query: q }, undefined, { shallow: true });
    },
    [router, hydrated]
  );

  const changeTab = (next) => {
    setTab(next);
    syncUrl(next, filter);
  };

  const changeFilter = (next) => {
    setFilter(next);
    syncUrl(tab, next);
  };

  /* ---------- 「我的」关系集合：一次算好，供筛选和计数复用 ---------- */
  const mineSets = useMemo(() => {
    const signed = new Set();
    const joined = new Set();
    const captain = new Set();
    const placed = new Set();
    for (const it of mine) {
      const id = String(it.tournament_id);
      if (it.signupStatus || it.signedAt || (it.teams || []).length || it.isCaptain) signed.add(id);
      if ((it.teams || []).length > 0 || it.rank !== null && it.rank !== undefined) joined.add(id);
      if (it.isCaptain) captain.add(id);
      if (Number(it.rank) >= 1 && Number(it.rank) <= 3) placed.add(id);
    }
    return { signed, joined, captain, placed };
  }, [mine]);

  /* ---------- 列表过滤 ---------- */
  const baseList = tab === 'mine' ? null : list;

  const filtered = useMemo(() => {
    const src = baseList || [];
    const k = filter.q.trim().toLowerCase();
    return src.filter((t) => {
      if (filter.status.length > 0) {
        const g = statusGroup(t.status);
        if (!filter.status.includes(g)) return false;
      }
      if (k && !String(t.name || '').toLowerCase().includes(k)) return false;
      if (filter.rel.length > 0) {
        const id = String(t.id);
        // 同组内 OR：命中任意一个关系即可
        const hit = filter.rel.some((r) => {
          if (r === 'signed') return mineSets.signed.has(id);
          if (r === 'joined') return mineSets.joined.has(id);
          if (r === 'captain') return mineSets.captain.has(id);
          if (r === 'placed') return mineSets.placed.has(id);
          return false;
        });
        if (!hit) return false;
      }
      return true;
    });
  }, [baseList, filter, mineSets]);

  /* ---------- 我的赛事 Tab：同一套筛选，但关系组隐藏（本来就全是我的） ---------- */
  const mineFiltered = useMemo(() => {
    const k = filter.q.trim().toLowerCase();
    return mine.filter((it) => {
      if (filter.status.length > 0) {
        const g = statusGroup(it.status);
        if (!filter.status.includes(g)) return false;
      }
      if (k && !String(it.name || '').toLowerCase().includes(k)) return false;
      return true;
    });
  }, [mine, filter]);

  /* ---------- chip 上的计数：在当前其他筛选条件下，各选项能命中多少 ---------- */
  const counts = useMemo(() => {
    const src = tab === 'mine' ? mine : list;
    const q = filter.q.trim().toLowerCase();
    const byQ = src.filter((t) => !q || String(t.name || '').toLowerCase().includes(q));
    const statusCounts = { planning: 0, live: 0, finished: 0 };
    byQ.forEach((t) => {
      statusCounts[statusGroup(t.status)] += 1;
    });
    const relCounts = { signed: 0, joined: 0, captain: 0, placed: 0 };
    if (tab === 'all') {
      byQ.forEach((t) => {
        const id = String(t.id);
        if (mineSets.signed.has(id)) relCounts.signed += 1;
        if (mineSets.joined.has(id)) relCounts.joined += 1;
        if (mineSets.captain.has(id)) relCounts.captain += 1;
        if (mineSets.placed.has(id)) relCounts.placed += 1;
      });
    }
    return { status: statusCounts, rel: relCounts };
  }, [tab, mine, list, filter.q, mineSets]);

  /* 缺起止日期的赛事在按状态筛时容易被漏，给一句提示 */
  const hiddenByDate = useMemo(() => {
    if (filter.status.length === 0) return 0;
    const src = tab === 'mine' ? mine : list;
    return src.filter((t) => !t.start_date && !t.end_date).length;
  }, [tab, mine, list, filter.status]);

  /* ---------- 我的赛事统计（P3） ---------- */
  const myStats = useMemo(() => {
    const total = mine.length;
    let champ = 0;
    let second = 0;
    let third = 0;
    let caps = 0;
    let joined = 0;
    for (const it of mine) {
      const r = Number(it.rank);
      if (r === 1) champ += 1;
      else if (r === 2) second += 1;
      else if (r === 3) third += 1;
      if (it.isCaptain) caps += 1;
      if ((it.teams || []).length > 0) joined += 1;
    }
    return { total, champ, second, third, caps, joined };
  }, [mine]);

  const canSeeMine = ready && me;

  return (
    <>
      <Head>
        <title>赛事信息 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <h1>
            赛事<span className="hl">信息</span>
          </h1>
          <p>
            共 {list.length} 届赛事
            {canSeeMine && mine.length > 0 ? ` · 我参与 ${mine.length} 届` : ''}
            {' '}· 历届群内对决赛程与战报
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {/* 数据来源声明 */}
          <div className="src-note">
            <span>Laroja超级联赛部分信息由孙哥提供，感谢孙哥提供的比赛资料。</span>
          </div>
          {/* ---------- 两个 Tab ---------- */}
          <div className="lr-tabs" role="tablist" aria-label="赛事视图">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'all'}
              className={`lr-tab ${tab === 'all' ? 'is-on' : ''}`}
              onClick={() => changeTab('all')}
            >
              全部赛事
              <span className="lr-tab-n">{list.length}</span>
            </button>
            {canSeeMine && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'mine'}
                className={`lr-tab ${tab === 'mine' ? 'is-on' : ''}`}
                onClick={() => changeTab('mine')}
              >
                我的赛事
                <span className="lr-tab-n">{mine.length}</span>
              </button>
            )}
          </div>

          {/* ---------- 我的赛事：先给一排指标，再给表 ---------- */}
          {tab === 'mine' && canSeeMine && (
            <>
              {mineLoading ? (
                <div className="empty" style={{ padding: '30px 0' }}>
                  加载中…
                </div>
              ) : !mineBound ? (
                <div className="empty" style={{ padding: '24px 0' }}>
                  账号还没绑选手资料，先
                  <Link href="/profile" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                    补填选手资料
                  </Link>
                  。
                </div>
              ) : mine.length === 0 ? (
                <div className="empty" style={{ padding: '30px 0' }}>
                  你还没报过名。下一届开赛前群里会喊，记得蹲。
                  <br />
                  <button type="button" className="tf-clear" onClick={() => changeTab('all')}>
                    去看看全部赛事
                  </button>
                </div>
              ) : (
                <>
                  <div className="my-stats">
                    <span className="my-stat">
                      <b>{myStats.total}</b>届参与
                    </span>
                    <span className="my-stat">
                      <b>{myStats.joined}</b>届进队
                    </span>
                    <span className="my-stat gold">
                      <b>{myStats.champ}</b>冠军
                    </span>
                    <span className="my-stat">
                      <b>{myStats.second}</b>亚军
                    </span>
                    <span className="my-stat">
                      <b>{myStats.third}</b>季军
                    </span>
                    <span className="my-stat">
                      <b>{myStats.caps}</b>次队长
                    </span>
                  </div>

                  <TournamentFilterBar
                    value={filter}
                    onChange={changeFilter}
                    counts={counts}
                    total={mineFiltered.length}
                    showRel={false}
                    hiddenByDate={hiddenByDate}
                  />

                  {mineFiltered.length === 0 ? (
                    <div className="empty" style={{ padding: '26px 0' }}>
                      没有符合条件的赛事
                    </div>
                  ) : (
                    <MyTournamentTable items={mineFiltered} />
                  )}
                </>
              )}
            </>
          )}

          {/* ---------- 全部赛事 ---------- */}
          {tab === 'all' && (
            <>
              {loading && <div className="empty">加载中…</div>}
              {error && <div className="empty">加载失败：{error}</div>}
              {!loading && !error && list.length === 0 && (
                <div className="empty">还没有赛事记录</div>
              )}

              {!loading && !error && list.length > 0 && (
                <>
                  <TournamentFilterBar
                    value={filter}
                    onChange={changeFilter}
                    counts={counts}
                    total={filtered.length}
                    showRel={Boolean(canSeeMine)}
                    hiddenByDate={hiddenByDate}
                  />

                  {filtered.length === 0 ? (
                    <div className="empty" style={{ padding: '26px 0' }}>
                      没有符合条件的赛事
                      <br />
                      <button
                        type="button"
                        className="tf-clear"
                        onClick={() => changeFilter(EMPTY_FILTER)}
                      >
                        清除筛选
                      </button>
                    </div>
                  ) : (
                    <div className="lr-tbl">
                      <div className="lr-thead">
                        <span>赛事</span>
                        <span>状态</span>
                        <span>时间</span>
                        <span>冠军</span>
                      </div>
                      {filtered.map((t) => {
                        const g = statusGroup(t.status);
                        const champ = t.champions_text || t.champion_team_name || '';
                        const mineFlags = canSeeMine
                          ? [
                              mineSets.signed.has(String(t.id)) ? '已报名' : null,
                              mineSets.joined.has(String(t.id)) ? '已进队' : null,
                              mineSets.captain.has(String(t.id)) ? '队长' : null,
                            ].filter(Boolean)
                          : [];
                        return (
                          <Link href={'/tournaments/' + t.id} className="lr-trow" key={t.id}>
                            <span className="lr-cell-main">
                              <span className="lr-name">
                                {t.name || '未命名赛事'}
                                {mineFlags.length > 0 && (
                                  <span className="lr-mine-flag">{mineFlags.join(' · ')}</span>
                                )}
                              </span>
                              {t.sponsor_info && <span className="lr-sub">{t.sponsor_info}</span>}
                            </span>
                            <span className={`lr-status ${STATUS_CLS[g]}`}>
                              {STATUS_GROUP_LABEL[g]}
                            </span>
                            <span className="lr-time">
                              {t.start_date || t.end_date
                                ? `${fmt(t.start_date)} — ${fmt(t.end_date)}`
                                : '时间待定'}
                            </span>
                            <span className={`lr-champ ${champ ? 'has' : ''}`}>
                              {champ || '—'}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
