import { useState, useEffect, Fragment } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import SignupButton from '../../components/SignupButton';

const STATUS_LABEL = {
  planning: '筹办中',
  ongoing: '进行中',
  elimination: '淘汰赛',
  semifinal: '半决赛',
  final: '决赛',
  finished: '已完赛',
  postponed: '延期',
  planned: '筹备中',
  active: '进行中',
  done: '已结束',
};

function statusCls(s) {
  if (s === 'active' || s === 'ongoing') return 'b-active';
  if (s === 'finished' || s === 'done') return 'b-done';
  return 'b-planned';
}

function fmt(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export default function TournamentDetail() {
  const router = useRouter();
  const { id } = router.query;

  const [t, setT] = useState(null);
  const [teams, setTeams] = useState([]);
  const [signups, setSignups] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    Promise.all([
      fetch('/api/tournaments/' + id).then((r) => r.json()).catch(() => ({})),
      fetch('/api/teams?tournament_id=' + id).then((r) => r.json()).catch(() => ({ teams: [] })),
      fetch('/api/tournaments/' + id + '/matches').then((r) => r.json()).catch(() => ({ rounds: [], matches: [] })),
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

  // 名次中文：1 冠军 / 2 亚军 / 3 季军 / 其余第 N 名
  const rankLabel = (r) => {
    const n = Number(r);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n === 1) return '冠军';
    if (n === 2) return '亚军';
    if (n === 3) return '季军';
    return `第 ${n} 名`;
  };

  // 队伍按名次升序（未定名次的排最后），同名义次按队名
  const sortedTeams = [...teams].sort((a, b) => {
    const ra = Number(a.rank);
    const rb = Number(b.rank);
    const ha = Number.isFinite(ra) && ra > 0;
    const hb = Number.isFinite(rb) && rb > 0;
    if (ha && hb) return ra - rb;
    if (ha) return -1;
    if (hb) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
  });

  // 参赛人数 = 报名名单 ∪ 各队成员去重后的真实人数
  // （老赛事 tournament_players 是空的，只按报名表数会显示 0）
  const rosterIds = new Set(signups.map((s) => String(s.player_id)));
  teams.forEach((tm) => (tm.players || []).forEach((p) => rosterIds.add(String(p.id))));
  const attendeeCount = rosterIds.size;

  const isFinished = t ? t.status === 'finished' || t.status === 'done' : false;
  // 同名次可能有多支队伍（历史上录重过），用 / 连接，不静默丢掉
  const namesByRank = (r) =>
    teams.filter((x) => Number(x.rank) === Number(r)).map((x) => x.name).filter(Boolean);
  const pickName = (explicit, r) => explicit || namesByRank(r).join(' / ') || null;
  // 比赛结果：优先用赛事表记录的队伍，其次回退到 teams.rank
  const results = t
    ? [
        { key: 'gold', medal: '🥇', label: '冠军', name: pickName(t.champion_team_name, 1) },
        { key: 'silver', medal: '🥈', label: '亚军', name: pickName(t.runner_up_team_name, 2) },
        { key: 'bronze', medal: '🥉', label: '季军', name: pickName(t.third_place_team_name, 3) },
      ].filter((x) => x.name)
    : [];

  if (loading) return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  if (notFound || !t) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        赛事不存在。
        <br />
        <Link href="/tournaments" style={{ color: 'var(--brand)', fontWeight: 600 }}>
          返回赛事列表
        </Link>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{t.name} · 赛事详情 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <Link href="/tournaments" className="back-link">
            ← 返回赛事列表
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.9rem' }}>{t.name}</h1>
            <span className={`t-badge ${statusCls(t.status)}`}>{STATUS_LABEL[t.status] || '赛程'}</span>
          </div>
          <p style={{ marginTop: 8 }}>
            {fmt(t.start_date)} — {fmt(t.end_date)}
            {teams.length > 0 && <> · {teams.length} 支队伍</>}
            {attendeeCount > 0 && <> · {attendeeCount} 名选手</>}
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {/* ===== 1. 结论指标（冠军 / 亚军 / 季军 / 场次）===== */}
          <div className="info-strip" style={{ maxWidth: 'none' }}>
            {results.map((r) => (
              <div className="info-cell" key={r.key}>
                <span className="k">{r.label}</span>
                <span className="v">{r.name}</span>
              </div>
            ))}
            {results.length === 0 && isFinished && (
              <div className="info-cell">
                <span className="k">比赛结果</span>
                <span className="v" style={{ color: 'var(--text-3)', fontWeight: 500 }}>名次待录入</span>
              </div>
            )}
            <div className="info-cell">
              <span className="k">总场次</span>
              <span className="v">{matches.length || 0}</span>
            </div>
            {t.champion_prize && (
              <div className="info-cell">
                <span className="k">冠军奖金</span>
                <span className="v">{t.champion_prize}</span>
              </div>
            )}
            {t.runner_up_prize && (
              <div className="info-cell">
                <span className="k">亚军奖金</span>
                <span className="v">{t.runner_up_prize}</span>
              </div>
            )}
            {t.sponsor_info && (
              <div className="info-cell">
                <span className="k">赞助</span>
                <span className="v" style={{ fontSize: '.9rem' }}>{t.sponsor_info}</span>
              </div>
            )}
            <div className="info-cell">
              <span className="k">报名通道</span>
              <span className="v" style={{ paddingTop: 2 }}>
                <SignupButton
                  tournamentId={id}
                  locked={t.status === 'finished' || t.status === 'done'}
                />
              </span>
            </div>
          </div>

          {/* ===== 2. 赛程与对阵 ===== */}
          {matches.length > 0 && (
            <div style={{ marginTop: 34 }}>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 14 }}>赛程与对阵</h2>
              <div className="match-bracket">
                {(rounds.length > 0 ? rounds : [{ id: null, name: '对阵' }]).map((rd) => {
                  const rdMatches = matches.filter((m) =>
                    rd.id ? String(m.round_id) === String(rd.id) : !m.round_id
                  );
                  if (rdMatches.length === 0) return null;
                  return (
                    <div className="match-round" key={rd.id || 'ungrouped'}>
                      <div className="match-round-title">{rd.name}</div>

                      {rdMatches.map((m) => {
                        const ps = m.dota_players || [];
                        const radiant = ps.filter((p) => p.is_radiant);
                        const dire = ps.filter((p) => !p.is_radiant);
                        const played = m.team_a_score !== null && m.team_b_score !== null;
                        const dur = m.dota_duration
                          ? `${Math.floor(m.dota_duration / 60)}:${String(m.dota_duration % 60).padStart(2, '0')}`
                          : null;
                        const aLose = played && m.winner_name && m.winner_name !== m.team_a_name;
                        const bLose = played && m.winner_name && m.winner_name !== m.team_b_name;

                        const row = (p) => (
                          <div className="duel-row" key={p.account_id}>
                            <span className="duel-name" title={p.nickname || String(p.account_id)}>
                              {p.group_nickname || p.nickname || p.account_id}
                              {p.is_standin && <span className="st">替</span>}
                            </span>
                            <span className="duel-hero">{p.hero_name || '—'}</span>
                            <span className="duel-kda">{p.kills}/{p.deaths}/{p.assists}</span>
                          </div>
                        );

                        return (
                          <div className={`duel-card ${m.is_grudge ? 'grudge' : ''}`} key={m.id}>
                            <div className="duel-head">
                              <span className="duel-tag">
                                {rd.name || '对阵'}
                                {m.order_no ? ` · 第 ${m.order_no} 局` : ''}
                              </span>
                              <span className="duel-meta">
                                {dur ? `${dur} · ` : ''}
                                {m.dota_match_id || ''}
                              </span>
                            </div>

                            <div className="duel-board">
                              <div className={`duel-team a ${aLose ? 'lose' : ''}`}>
                                {m.team_a_name || '待定'}
                              </div>
                              {played ? (
                                <div className="duel-score">
                                  {m.team_a_score} : {m.team_b_score}
                                </div>
                              ) : (
                                <div className="duel-score pending">未开赛</div>
                              )}
                              <div className={`duel-team b ${bLose ? 'lose' : ''}`}>
                                {m.team_b_name || '待定'}
                              </div>
                            </div>

                            {(m.winner_name || m.is_grudge) && (
                              <div className="duel-win">
                                {m.is_grudge && <span className="grudge">⚔ 恩怨局</span>}
                                {m.winner_name ? `🏆 ${m.winner_name} 胜` : ''}
                              </div>
                            )}

                            {ps.length > 0 && (
                              <div className="duel-rosters">
                                <div className="duel-col radiant">
                                  <div className="duel-col-head">
                                    天辉 <b>{m.team_a_name || ''}</b>
                                  </div>
                                  {radiant.map(row)}
                                </div>
                                <div className="duel-col dire">
                                  <div className="duel-col-head">
                                    夜魇 <b>{m.team_b_name || ''}</b>
                                  </div>
                                  {dire.map(row)}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===== 3. 参赛队伍（表格，阵容默认展开）===== */}
          <div style={{ marginTop: 34 }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 14 }}>
              参赛队伍（{teams.length}）
              {sortedTeams.some((x) => Number(x.rank) > 0) && (
                <span className="team-order-hint">按名次排序</span>
              )}
            </h2>
            {teams.length === 0 ? (
              <div className="empty">暂无队伍数据</div>
            ) : (
              <div className="team-table">
                <div className="tt-head">
                  <span>#</span>
                  <span>队伍</span>
                  <span>队长</span>
                  <span style={{ textAlign: 'right' }}>总分</span>
                  <span>交战</span>
                </div>

                {sortedTeams.map((team, idx) => {
                  const members = team.players || [];
                  const total = members.reduce((s, p) => s + (Number(p.score) || 0), 0);
                  const rank = Number(team.rank) || 0;

                  const captain =
                    members.find((p) => String(p.id) === String(team.captain_id)) || null;

                  const fought = [
                    ...new Set(
                      matches
                        .filter(
                          (m) =>
                            String(m.team_a_id) === String(team.id) ||
                            String(m.team_b_id) === String(team.id)
                        )
                        .map((m) =>
                          String(m.team_a_id) === String(team.id) ? m.team_b_name : m.team_a_name
                        )
                        .filter(Boolean)
                    ),
                  ];

                  return (
                    <Fragment key={team.id}>
                      <div className="tt-row">
                        <span className={`tt-rank ${rank > 0 && rank <= 3 ? 'r' + rank : ''}`}>
                          {rank > 0 ? rank : idx + 1}
                        </span>
                        <span className="tt-team">{team.name}</span>
                        <span className="tt-cap">
                          {captain ? (
                            <>
                              {captain.group_nickname || captain.nickname}
                              <span className="star">★</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </span>
                        <span className="tt-total">{total}</span>
                        <span className="tt-fought" title={fought.join('、')}>
                          {fought.length > 0 ? fought.join('、') : '—'}
                        </span>
                      </div>

                      {members.length > 0 && (
                        <div className="tt-roster">
                          {members.map((p) => {
                            const isCap = String(p.id) === String(team.captain_id);
                            const posList = String(p.positions || '')
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean);
                            return (
                              <Link
                                key={p.id}
                                href={'/members/' + p.id}
                                className={`tt-member ${isCap ? 'cap' : ''}`}
                                style={{ color: 'inherit', textDecoration: 'none' }}
                              >
                                {p.group_nickname || p.nickname}
                                {posList.length > 0 && (
                                  <span className="pos">{posList.slice(0, 2).join(' / ')}</span>
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>

          {/* ===== 4. 报名选手 ===== */}
          <div style={{ marginTop: 34 }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 14 }}>
              报名选手（{signups.length}）
            </h2>
            {signups.length > 0 ? (
              <div className="signup-grid">
                {signups.map((s) => (
                  <Link key={s.player_id} href={'/members/' + s.player_id} className="signup-chip">
                    <span className="sc-name">{s.nickname || s.group_nickname || '群友'}</span>
                    {s.is_captain && <span className="sc-cap">队长</span>}
                    <span className="sc-score">{s.score || 0}</span>
                    <span className="sc-pos">
                      {(s.positions ? String(s.positions).split(',').filter(Boolean) : []).slice(0, 2).join(' / ') ||
                        '未填位置'}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty">
                {attendeeCount > 0
                  ? '本届没有单独的报名记录，名单以上方「参赛队伍」成员为准。'
                  : '暂无报名选手'}
              </div>
            )}
          </div>

        </div>
      </section>
    </>
  );
}
