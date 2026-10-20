import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import SignupButton from '../../components/SignupButton';
import TournamentHero from '../../components/tournament/TournamentHero';
import MatchCard from '../../components/tournament/MatchCard';
import TeamTable from '../../components/tournament/TeamTable';
import PlayerTable from '../../components/tournament/PlayerTable';

const TABS = [
  { key: 'overview', label: '赛事概览' },
  { key: 'matches', label: '赛程与对阵' },
  { key: 'teams', label: '参赛队伍' },
  { key: 'players', label: '报名选手' },
];

const COVER = '/images/tournament/hero-red.jpg';

/* 轮次的语义顺序：数据库里 order_no 是分批写入的（手建 + 脚本自动建），
   单靠 order_no 排会出现「决赛排在淘汰赛前面」。按名字兜底。 */
const ROUND_ORDER = { 小组赛: 1, 淘汰赛: 2, 半决赛: 3, 决赛: 4 };

const fmtDate = (v) => {
  if (!v) return '待定';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function TournamentDetail() {
  const router = useRouter();
  const { id } = router.query;

  const [t, setT] = useState(null);
  const [signups, setSignups] = useState([]);
  const [teams, setTeams] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      fetch('/api/tournaments/' + id).then((r) => r.json()).catch(() => ({})),
      fetch('/api/teams?tournament_id=' + id).then((r) => r.json()).catch(() => ({ teams: [] })),
      fetch('/api/tournaments/' + id + '/matches')
        .then((r) => r.json())
        .catch(() => ({ rounds: [], matches: [] })),
    ]).then(([td, teamd, matchd]) => {
      if (!alive) return;
      if (td && td.success && td.tournament) {
        setT(td.tournament);
        setSignups(td.signups || []);
      } else {
        setNotFound(true);
      }
      setTeams(teamd.teams || []);
      setRounds(matchd.rounds || []);
      setMatches(matchd.matches || []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  /* 统计口径：
     参赛选手 = 各队成员去重（team_players）
     报名选手 = tournament_players 快照，含未组队的人
     两者不同，页面上分别展示 */
  const stats = useMemo(() => {
    const ids = new Set();
    teams.forEach((tm) => (tm.players || []).forEach((p) => ids.add(String(p.id))));
    return {
      teamCount: teams.length,
      playerCount: ids.size,
      signupCount: signups.length,
      matchCount: matches.length,
    };
  }, [teams, matches, signups]);

  /* 名次可以有多个。数据来源按可信度排：
     1) tournament_placements —— 一行一个名次，天然支持并列多个冠军
     2) teams.rank —— 人工录入的单值
     3) tournaments.champion/runner_up/third —— 最早的单值字段，仅兜底
     页面内部统一用 placesMap：team_id → 名次数组（同一队一般只有一个，用数组防止重复记名） */
  const placesMap = useMemo(() => {
    const m = new Map();
    const add = (id, place) => {
      const k = String(id);
      const p = Number(place) || 0;
      if (!k || p <= 0) return;
      if (!m.has(k)) m.set(k, []);
      if (!m.get(k).includes(p)) m.get(k).push(p);
    };

    (t?.placements || []).forEach((x) => add(x.team_id, x.place));
    teams.forEach((tm) => add(tm.id, tm.rank));
    if (t) {
      // 只有在名次表完全为空时才回退旧字段，避免两套数据打架
      if (m.size === 0) {
        add(t.champion_team_id, 1);
        add(t.runner_up_team_id, 2);
        add(t.third_place_team_id, 3);
      }
    }
    m.forEach((arr) => arr.sort((a, b) => a - b));
    return m;
  }, [teams, t]);

  /* 排序用「最好的那个名次」 */
  const bestPlace = (id) => {
    const arr = placesMap.get(String(id));
    return arr && arr.length ? arr[0] : 999;
  };

  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) => {
      const ra = bestPlace(a.id);
      const rb = bestPlace(b.id);
      if (ra !== rb) return ra - rb;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
    });
  }, [teams, placesMap]);

  /* 荣誉带：每一档把所有队伍都列出来（可能是多个） */
  const honors = useMemo(() => {
    const NAME = { 1: '冠军', 2: '亚军', 3: '季军' };
    const fromTable = (t?.placements || []).reduce((acc, x) => {
      const p = Number(x.place);
      if (!NAME[p] || !x.team_name) return acc;
      if (!acc[p]) acc[p] = [];
      if (!acc[p].includes(x.team_name)) acc[p].push(x.team_name);
      return acc;
    }, {});

    // 名次表为空 → 用单值字段
    if (Object.keys(fromTable).length === 0) {
      const legacy = [
        [1, t?.champion_team_name],
        [2, t?.runner_up_team_name],
        [3, t?.third_place_team_name],
      ];
      legacy.forEach(([p, n]) => {
        if (n) fromTable[p] = [n];
      });
      // 再看 teams.rank
      if (Object.keys(fromTable).length === 0) {
        teams.forEach((tm) => {
          const r = Number(tm.rank);
          if (NAME[r]) {
            if (!fromTable[r]) fromTable[r] = [];
            fromTable[r].push(tm.name);
          }
        });
      }
    }

    return [1, 2, 3]
      .filter((p) => fromTable[p] && fromTable[p].length > 0)
      .map((p) => ({ label: NAME[p], names: fromTable[p] }));
  }, [t, teams]);

  /* 按轮次分组（没有轮次时归到「对阵」） */
  const groupedMatches = useMemo(() => {
    const list = rounds.length > 0 ? rounds : [{ id: null, name: '对阵' }];
    const ordered = [...list].sort((a, b) => {
      const ra = ROUND_ORDER[a.name] ?? 50;
      const rb = ROUND_ORDER[b.name] ?? 50;
      if (ra !== rb) return ra - rb;
      const oa = Number(a.order_no) || 0;
      const ob = Number(b.order_no) || 0;
      if (oa !== ob) return oa - ob;
      return Number(a.id || 0) - Number(b.id || 0);
    });
    return ordered
      .map((rd) => ({
        round: rd,
        items: matches
          .filter((m) => (rd.id ? String(m.round_id) === String(rd.id) : !m.round_id))
          .sort((x, y) => (Number(x.order_no) || 0) - (Number(y.order_no) || 0) || Number(x.id) - Number(y.id)),
      }))
      .filter((g) => g.items.length > 0);
  }, [rounds, matches]);

  if (loading) {
    return (
      <div className="t-dark" style={{ minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
        <div className="t-eyebrow">加载赛事数据…</div>
      </div>
    );
  }

  if (notFound || !t) {
    return (
      <div className="t-dark" style={{ minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--t-text-2)', marginBottom: 12 }}>赛事不存在</p>
          <Link href="/tournaments" style={{ color: 'var(--t-red-ink)', fontSize: 13 }}>
            返回赛事列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="t-dark">
      <Head>
        <title>{t.name} · 深圳LaRoja Dota2社区</title>
      </Head>

      <TournamentHero tournament={t} coverImage={COVER} stats={stats} honors={honors} />

      <div className="t-tabs">
        <div className="t-wrap t-tabs-inner">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              className={`t-tab ${tab === x.key ? 'active' : ''}`}
              onClick={() => setTab(x.key)}
            >
              {x.label}
              {x.key === 'teams' && <span className="t-tab-count">{teams.length}</span>}
              {x.key === 'players' && <span className="t-tab-count">{signups.length}</span>}
              {x.key === 'matches' && <span className="t-tab-count">{matches.length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="t-wrap" style={{ paddingBottom: 70 }}>
        {/* ==================== 概览 ==================== */}
        {tab === 'overview' && (
          <div className="t-overview">
            <div className="t-overview-main">
              {groupedMatches.length > 0 && (
                <section className="t-block">
                  <div className="t-block-head">
                    {/* 这里只渲染最后一轮，标题就写清楚是哪一轮，
                        原来固定写「赛果」+ 总场次，会让人以为下面列了全部 15 场 */}
                    <h2 className="t-block-title">
                      赛果 · {groupedMatches[groupedMatches.length - 1].round.name}
                    </h2>
                    <span className="t-block-sub">
                      {groupedMatches[groupedMatches.length - 1].items.length} 局
                    </span>
                  </div>
                  {groupedMatches[groupedMatches.length - 1].items.map((m) => (
                    <MatchCard
                      key={m.id}
                      match={m}
                      roundName={groupedMatches[groupedMatches.length - 1].round.name}
                    />
                  ))}
                </section>
              )}

              <section className="t-block">
                <div className="t-block-head">
                  <h2 className="t-block-title">参赛队伍</h2>
                  <button type="button" className="t-block-link" onClick={() => setTab('teams')}>
                    全部 {teams.length} 支 →
                  </button>
                </div>
                {sortedTeams.length === 0 ? (
                  <div className="t-tr-muted">暂无队伍</div>
                ) : (
                  <div className="t-team-list">
                    {sortedTeams.map((tm) => {
                      const rk = bestPlace(tm.id);
                      const rkl = rk === 1 ? '冠' : rk === 2 ? '亚' : rk === 3 ? '季' : '';
                      return (
                        <span className="t-team-item" key={tm.id}>
                          {rkl && <span className="rk">{rkl}</span>}
                          {tm.name}
                        </span>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            <aside className="t-overview-side">
              <section className="t-block">
                <div className="t-block-head">
                  <h2 className="t-block-title">最终名次</h2>
                </div>
                {honors.length > 0 ? (
                  <div className="t-deflist">
                    {honors.map((h) => (
                      <div className="t-def" key={h.label}>
                        <span className="t-def-k">{h.label}</span>
                        <span className={`t-def-v ${h.label === '冠军' ? 'bronze' : ''}`}>
                          {h.names.join(' / ')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="t-tr-muted">名次尚未录入</div>
                )}
              </section>

              <section className="t-block">
                <div className="t-block-head">
                  <h2 className="t-block-title">赛事信息</h2>
                </div>
                <div className="t-deflist">
                  <div className="t-def">
                    <span className="t-def-k">时间</span>
                    <span className="t-def-v">
                      {fmtDate(t.start_date)} — {fmtDate(t.end_date)}
                    </span>
                  </div>
                  <div className="t-def">
                    <span className="t-def-k">报名选手</span>
                    <span className="t-def-v">{signups.length} 人</span>
                  </div>
                  <div className="t-def">
                    <span className="t-def-k">参赛选手</span>
                    <span className="t-def-v">{stats.playerCount} 人</span>
                  </div>
                  {t.sponsor_info && (
                    <div className="t-def">
                      <span className="t-def-k">赞助</span>
                      <span className="t-def-v">{t.sponsor_info}</span>
                    </div>
                  )}
                  {t.champion_prize && (
                    <div className="t-def">
                      <span className="t-def-k">冠军奖金</span>
                      <span className="t-def-v bronze">{t.champion_prize}</span>
                    </div>
                  )}
                  {t.runner_up_prize && (
                    <div className="t-def">
                      <span className="t-def-k">亚军奖金</span>
                      <span className="t-def-v">{t.runner_up_prize}</span>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 18 }}>
                  <SignupButton
                    tournamentId={id}
                    locked={t.status === 'finished' || t.status === 'done'}
                  />
                </div>
              </section>
            </aside>
          </div>
        )}

        {/* ==================== 赛程与对阵 ==================== */}
        {tab === 'matches' && (
          <div style={{ marginTop: 22 }}>
            {groupedMatches.length === 0 ? (
              <div className="t-empty">暂无赛程数据</div>
            ) : (
              groupedMatches.map((g, gi) => (
                <section key={g.round.id || 'ungrouped'} style={{ marginTop: gi === 0 ? 0 : 34 }}>
                  <div className="t-section-title">
                    {g.round.name}
                    <span
                      style={{
                        marginLeft: 4,
                        fontFamily: 'var(--t-mono)',
                        fontSize: 10.5,
                        letterSpacing: 0,
                        color: 'var(--t-text-3)',
                        fontWeight: 400,
                      }}
                    >
                      {g.items.length} 场
                    </span>
                  </div>
                  {g.items.map((m) => (
                    <MatchCard key={m.id} match={m} roundName={g.round.name} />
                  ))}
                </section>
              ))
            )}
          </div>
        )}

        {/* ==================== 参赛队伍 ==================== */}
        {tab === 'teams' && (
          <div style={{ marginTop: 26 }}>
            <TeamTable teams={teams} matches={matches} tournament={t} />
          </div>
        )}

        {/* ==================== 报名选手 ==================== */}
        {tab === 'players' && (
          <div style={{ marginTop: 26 }}>
            <PlayerTable signups={signups} teams={teams} />
          </div>
        )}
      </div>
    </div>
  );
}
