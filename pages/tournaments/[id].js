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
      championName:
        (t && (t.champion_team_name || t.champion_team?.name)) ||
        (teams.find((x) => Number(x.rank) === 1) || {}).name ||
        '',
    };
  }, [teams, matches, t, signups]);

  /* 名次口径：teams.rank 优先，为空时回退到赛事的 champion/runner_up/third_place。
     第十一届就是这种情况——teams.rank 全空，冠军只记在 tournaments.champion_team_id。 */
  const rankMap = useMemo(() => {
    const m = new Map();
    teams.forEach((tm) => {
      const r = Number(tm.rank) || 0;
      if (r > 0) m.set(String(tm.id), r);
    });
    if (t) {
      if (t.champion_team_id) m.set(String(t.champion_team_id), 1);
      if (t.runner_up_team_id) m.set(String(t.runner_up_team_id), 2);
      if (t.third_place_team_id) m.set(String(t.third_place_team_id), 3);
    }
    return m;
  }, [teams, t]);

  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) => {
      const ra = rankMap.get(String(a.id)) || 999;
      const rb = rankMap.get(String(b.id)) || 999;
      if (ra !== rb) return ra - rb;
      return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
    });
  }, [teams, rankMap]);

  const results = useMemo(() => {
    if (!t) return [];
    const pick = (name, rank) =>
      name || (teams.find((x) => Number(x.rank) === rank) || {}).name || '';
    return [
      { key: 'gold', label: '冠军', name: pick(t.champion_team_name, 1) },
      { key: 'silver', label: '亚军', name: pick(t.runner_up_team_name, 2) },
      { key: 'bronze', label: '季军', name: pick(t.third_place_team_name, 3) },
    ].filter((x) => x.name);
  }, [t, teams]);

  /* 按轮次分组（没有轮次时归到「对阵」） */
  const groupedMatches = useMemo(() => {
    const list = rounds.length > 0 ? rounds : [{ id: null, name: '对阵' }];
    return list
      .map((rd) => ({
        round: rd,
        items: matches.filter((m) =>
          rd.id ? String(m.round_id) === String(rd.id) : !m.round_id
        ),
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

      <TournamentHero tournament={t} coverImage={COVER} stats={stats} />

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
                    <h2 className="t-block-title">赛果</h2>
                    <span className="t-block-sub">{matches.length} 场</span>
                  </div>
                  {groupedMatches.slice(-1).map((g) =>
                    g.items.map((m) => (
                      <MatchCard key={m.id} match={m} roundName={g.round.name} />
                    ))
                  )}
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
                      const rk = rankMap.get(String(tm.id)) || 0;
                      return (
                        <span className="t-team-item" key={tm.id}>
                          {rk > 0 && (
                            <span className="rk">{rk === 1 ? '冠' : rk === 2 ? '亚' : '季'}</span>
                          )}
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
                {results.length > 0 ? (
                  <div className="t-deflist">
                    {results.map((r) => (
                      <div className="t-def" key={r.key}>
                        <span className="t-def-k">{r.label}</span>
                        <span className={`t-def-v ${r.key === 'gold' ? 'bronze' : ''}`}>
                          {r.name}
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
