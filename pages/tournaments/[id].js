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
      matchCount: matches.length,
      championName:
        (t && (t.champion_team_name || t.champion_team?.name)) ||
        (teams.find((x) => Number(x.rank) === 1) || {}).name ||
        '',
    };
  }, [teams, matches, t]);

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
        <div style={{ color: 'var(--t-text-3)', fontSize: 14 }}>加载赛事数据…</div>
      </div>
    );
  }

  if (notFound || !t) {
    return (
      <div className="t-dark" style={{ minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--t-text-2)', marginBottom: 12 }}>赛事不存在</p>
          <Link href="/tournaments" style={{ color: 'var(--t-brand)', fontSize: 14 }}>
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

      <div className="t-wrap" style={{ paddingBottom: 60 }}>
        {/* ==================== 概览 ==================== */}
        {tab === 'overview' && (
          <div className="t-overview">
            <div>
              {groupedMatches.length > 0 && (
                <div className="t-panel">
                  <div className="t-panel-head">
                    <span className="t-panel-title">决赛结果</span>
                    <span className="t-panel-sub">{matches.length} 场比赛</span>
                  </div>
                  {groupedMatches.slice(-1).map((g) =>
                    g.items.map((m) => (
                      <MatchCard key={m.id} match={m} roundName={g.round.name} />
                    ))
                  )}
                </div>
              )}

              <div className="t-panel">
                <div className="t-panel-head">
                  <span className="t-panel-title">参赛队伍</span>
                  <button
                    type="button"
                    onClick={() => setTab('teams')}
                    style={{
                      background: 'none',
                      border: 0,
                      color: 'var(--t-brand)',
                      fontSize: 12.5,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      padding: 0,
                    }}
                  >
                    查看全部 {teams.length} 支 →
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {sortedTeams.map((tm) => {
                    const rk = rankMap.get(String(tm.id)) || 0;
                    return (
                      <span key={tm.id} className="t-chip" style={{ padding: '4px 10px', fontSize: 12.5 }}>
                        {rk > 0 && (
                          <span style={{ color: 'var(--t-gold)', marginRight: 5 }}>
                            {rk === 1 ? '冠' : rk === 2 ? '亚' : '季'}
                          </span>
                        )}
                        {tm.name}
                      </span>
                    );
                  })}
                  {teams.length === 0 && <span className="t-tr-muted">暂无队伍</span>}
                </div>
              </div>
            </div>

            <div>
              <div className="t-panel">
                <div className="t-panel-head">
                  <span className="t-panel-title">最终名次</span>
                </div>
                {results.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {results.map((r) => (
                      <div
                        key={r.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '9px 12px',
                          background: 'rgba(255,255,255,.03)',
                          borderRadius: 9,
                        }}
                      >
                        <span style={{ fontSize: 12.5, color: 'var(--t-text-3)' }}>{r.label}</span>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: r.key === 'gold' ? 'var(--t-gold)' : 'var(--t-text)',
                          }}
                        >
                          {r.name}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="t-empty" style={{ padding: '24px 0' }}>
                    名次尚未录入
                  </div>
                )}
              </div>

              <div className="t-panel">
                <div className="t-panel-head">
                  <span className="t-panel-title">赛事信息</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--t-text-3)' }}>时间</span>
                    <span>
                      {fmtDate(t.start_date)} — {fmtDate(t.end_date)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--t-text-3)' }}>报名选手</span>
                    <span>{signups.length} 人</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--t-text-3)' }}>参赛选手</span>
                    <span>{stats.playerCount} 人</span>
                  </div>
                  {t.sponsor_info && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                      <span style={{ color: 'var(--t-text-3)', flexShrink: 0 }}>赞助</span>
                      <span style={{ textAlign: 'right' }}>{t.sponsor_info}</span>
                    </div>
                  )}
                  {t.champion_prize && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--t-text-3)' }}>冠军奖金</span>
                      <span style={{ color: 'var(--t-gold)' }}>{t.champion_prize}</span>
                    </div>
                  )}
                  {t.runner_up_prize && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--t-text-3)' }}>亚军奖金</span>
                      <span>{t.runner_up_prize}</span>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 16 }}>
                  <SignupButton
                    tournamentId={id}
                    locked={t.status === 'finished' || t.status === 'done'}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== 赛程与对阵 ==================== */}
        {tab === 'matches' && (
          <div style={{ marginTop: 24 }}>
            {groupedMatches.length === 0 ? (
              <div className="t-empty">暂无赛程数据</div>
            ) : (
              groupedMatches.map((g) => (
                <div key={g.round.id || 'ungrouped'} style={{ marginBottom: 26 }}>
                  <div className="t-section-title" style={{ marginTop: 0 }}>
                    {g.round.name}
                    <span
                      style={{
                        fontSize: 12.5,
                        color: 'var(--t-text-3)',
                        fontWeight: 400,
                        marginLeft: 10,
                      }}
                    >
                      {g.items.length} 场
                    </span>
                  </div>
                  {g.items.map((m) => (
                    <MatchCard key={m.id} match={m} roundName={g.round.name} />
                  ))}
                </div>
              ))
            )}
          </div>
        )}

        {/* ==================== 参赛队伍 ==================== */}
        {tab === 'teams' && (
          <div style={{ marginTop: 24 }}>
            <TeamTable teams={teams} matches={matches} tournament={t} />
          </div>
        )}

        {/* ==================== 报名选手 ==================== */}
        {tab === 'players' && (
          <div style={{ marginTop: 24 }}>
            <PlayerTable signups={signups} teams={teams} />
          </div>
        )}
      </div>
    </div>
  );
}
