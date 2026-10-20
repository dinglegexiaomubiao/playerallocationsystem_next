import { useState, useEffect } from 'react';
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
          <p style={{ marginTop: 8 }}>{fmt(t.start_date)} ~ {fmt(t.end_date)}</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {/* ===== 1. 赛事信息（收窄一半）===== */}
          <div className="side-card" style={{ maxWidth: 560 }}>
            <h4>赛事信息</h4>
            <div className="kv">
              <span className="k">状态</span>
              <span className="v">{STATUS_LABEL[t.status] || '—'}</span>
            </div>
            <div className="kv">
              <span className="k">时间</span>
              <span className="v">{fmt(t.start_date)} ~ {fmt(t.end_date)}</span>
            </div>
            <div className="kv">
              <span className="k">参赛人数</span>
              <span className="v" title="报名名单与各队成员去重后的真实人数">
                {attendeeCount} 人
              </span>
            </div>
            <div className="kv">
              <span className="k">参赛队伍</span>
              <span className="v">{teams.length} 支</span>
            </div>
            {t.sponsor_info && (
              <div className="kv">
                <span className="k">赞助</span>
                <span className="v">{t.sponsor_info}</span>
              </div>
            )}
            {t.champion_prize && (
              <div className="kv">
                <span className="k">冠军奖金</span>
                <span className="v">{t.champion_prize}</span>
              </div>
            )}
            {t.runner_up_prize && (
              <div className="kv">
                <span className="k">亚军奖金</span>
                <span className="v">{t.runner_up_prize}</span>
              </div>
            )}

            {isFinished && (
              <div className="result-box">
                <div className="result-title">比赛结果</div>
                {results.length > 0 ? (
                  <div className="result-list">
                    {results.map((r) => (
                      <div className={`result-row ${r.key}`} key={r.key}>
                        <span className="result-medal" aria-hidden="true">{r.medal}</span>
                        <span className="result-label">{r.label}</span>
                        <span className="result-name">{r.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="result-empty">本届名次尚未录入</div>
                )}
              </div>
            )}

            <SignupButton
              tournamentId={id}
              locked={t.status === 'finished' || t.status === 'done'}
            />
          </div>

          {/* ===== 2. 赛程与对阵（含选手与数据）===== */}
          {matches.length > 0 && (
            <div style={{ marginTop: 30 }}>
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
                        const hasDetail = (m.dota_players || []).length > 0;
                        const dur = m.dota_duration
                          ? `${Math.floor(m.dota_duration / 60)}:${String(m.dota_duration % 60).padStart(2, '0')}`
                          : null;
                        const radiant = (m.dota_players || []).filter((p) => p.is_radiant);
                        const dire = (m.dota_players || []).filter((p) => !p.is_radiant);
                        const line = (p) => (
                          <div
                            key={p.account_id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'minmax(56px,1fr) minmax(52px,88px) 62px',
                              gap: 6,
                              alignItems: 'center',
                              padding: '3px 0',
                              borderBottom: '1px solid rgba(0,0,0,.04)',
                              fontSize: 12.5,
                            }}
                          >
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                fontWeight: p.is_standin ? 600 : 400,
                                color: p.is_standin ? '#B9770E' : 'inherit',
                              }}
                              title={p.is_standin ? '替补上场' : p.nickname || ''}
                            >
                              {p.group_nickname || p.nickname || p.account_id}
                              {p.is_standin && <span style={{ fontSize: 10, marginLeft: 3 }}>替</span>}
                            </span>
                            <span
                              style={{
                                color: 'var(--text-3, #888)',
                                fontSize: 11.5,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {p.hero_name || '—'}
                            </span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
                              {p.kills}/{p.deaths}/{p.assists}
                            </span>
                          </div>
                        );

                        return (
                          <div className={`match-card ${m.is_grudge ? 'grudge' : ''}`} key={m.id}>
                            {/* 头部：轮次说明 + 比赛 ID + 时长 */}
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 8,
                                fontSize: 11.5,
                                color: 'var(--text-3, #999)',
                                marginBottom: 8,
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {m.note || '对局'}
                              </span>
                              <span style={{ whiteSpace: 'nowrap' }}>
                                {m.dota_match_id ? `match ${m.dota_match_id}` : ''}
                                {dur ? ` · ${dur}` : ''}
                              </span>
                            </div>

                            {/* 对阵与比分 */}
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 14,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span style={{ fontWeight: 700, fontSize: 15 }}>{m.team_a_name || '待定'}</span>
                              {m.team_a_score !== null && m.team_b_score !== null ? (
                                <span className="match-score" style={{ fontSize: 18 }}>
                                  {m.team_a_score} : {m.team_b_score}
                                </span>
                              ) : (
                                <span className="match-pending">未开赛</span>
                              )}
                              <span style={{ fontWeight: 700, fontSize: 15 }}>{m.team_b_name || '待定'}</span>
                            </div>

                            <div style={{ textAlign: 'center', marginTop: 6, minHeight: 18 }}>
                              {m.is_grudge && <span className="match-grudge-note">⚔ 恩怨局</span>}
                              {m.winner_name && (
                                <span className="match-winner" style={{ marginLeft: m.is_grudge ? 8 : 0 }}>
                                  🏆 {m.winner_name} 胜
                                </span>
                              )}
                            </div>

                            {/* 双方选手与数据 */}
                            {hasDetail && (
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: '1fr 1fr',
                                  gap: 14,
                                  marginTop: 10,
                                  paddingTop: 8,
                                  borderTop: '1px dashed rgba(0,0,0,.08)',
                                }}
                              >
                                <div>
                                  <div style={{ fontSize: 11, color: 'var(--text-3,#999)', marginBottom: 3 }}>
                                    天辉 · {m.team_a_name || ''}
                                  </div>
                                  {radiant.map(line)}
                                </div>
                                <div>
                                  <div style={{ fontSize: 11, color: 'var(--text-3,#999)', marginBottom: 3 }}>
                                    夜魇 · {m.team_b_name || ''}
                                  </div>
                                  {dire.map(line)}
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

          {/* ===== 3. 参赛队伍（含位置 / 队长 / 交战记录）===== */}
          <div style={{ marginTop: 26 }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 14 }}>
              参赛队伍（{teams.length}）
              {sortedTeams.some((x) => Number(x.rank) > 0) && (
                <span className="team-order-hint">按名次排序</span>
              )}
            </h2>
            {teams.length === 0 ? (
              <div className="empty">暂无队伍数据</div>
            ) : (
              <div className="team-grid">
                {sortedTeams.map((team) => {
                  const members = team.players || [];
                  const total = members.reduce((s, p) => s + (Number(p.score) || 0), 0);

                  // 交战过的队伍：从赛程里反查该队参与过的对手
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

                  // 队内仇人检测：任意方向命中即标记
                  const idSet = new Set(members.map((p) => String(p.id)));
                  const feuds = [];
                  members.forEach((p) => {
                    (p.enemies || []).forEach((eid) => {
                      const e = String(eid);
                      if (idSet.has(e) && e !== String(p.id)) {
                        const pair = [p.nickname, members.find((m) => String(m.id) === e)?.nickname || e].sort();
                        if (!feuds.some((f) => f[0] === pair[0] && f[1] === pair[1])) feuds.push(pair);
                      }
                    });
                  });

                  return (
                    <div className="team-card" key={team.id}>
                      <div className="team-head">
                        <div className="team-name">
                          {Number(team.rank) > 0 && (
                            <span
                              className={
                                'team-rank r' + (Number(team.rank) <= 3 ? Number(team.rank) : 'n')
                              }
                            >
                              {rankLabel(team.rank)}
                            </span>
                          )}
                          {team.name}
                        </div>
                        <div className="team-score">{total}</div>
                      </div>

                      {fought.length > 0 && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-3, #888)', marginBottom: 8 }}>
                          交战：{fought.join('、')}
                        </div>
                      )}

                      {feuds.length > 0 && (
                        <div className="team-feuds">
                          {feuds.map((f, i) => (
                            <span className="feud-tag" key={i}>⚔ {f[0]} 和 {f[1]} 为仇人</span>
                          ))}
                        </div>
                      )}

                      <div className="team-players">
                        {members.length > 0 ? (
                          members.map((p) => {
                            const isCap = String(p.id) === String(team.captain_id);
                            const posList = String(p.positions || '')
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean);
                            return (
                              <Link key={p.id} href={'/members/' + p.id} className="team-player">
                                <span className="tp-name">
                                  {isCap && (
                                    <span
                                      title="队长"
                                      style={{ color: '#E8A33D', marginRight: 4, fontSize: 12 }}
                                    >
                                      ★
                                    </span>
                                  )}
                                  {p.group_nickname || p.nickname}
                                </span>
                                <span
                                  className="tp-pos"
                                  style={{
                                    fontSize: 11,
                                    color: 'var(--text-3, #999)',
                                    flex: 1,
                                    textAlign: 'left',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {posList.length > 0 ? posList.slice(0, 2).join('/') : '—'}
                                </span>
                                <span className="tp-score">{p.score || 0}</span>
                              </Link>
                            );
                          })
                        ) : (
                          <div style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>暂无选手</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ===== 4. 报名选手 ===== */}
          <div style={{ marginTop: 26 }}>
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
