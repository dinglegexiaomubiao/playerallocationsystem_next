import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSession from '../../hooks/useSession';
import Avatar from '../../components/Avatar';
import HeroAvatar from '../../components/HeroAvatar';
import MatchHistory from '../../components/member/MatchHistory';
import AiPanel from '../../components/member/AiPanel';
import { rankLabel, rankCls } from '../../lib/tournament-format.mjs';
import { backLabelOf, memberHref } from '../../lib/member-href';

// 只到「日」，比赛时间不需要精确到分
function fmtDay(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function tier(score) {
  if (score >= 5420) return '冠绝一世';
  if (score >= 4620) return '超凡入圣';
  if (score >= 3850) return '万古流芳';
  if (score >= 3080) return '传奇';
  if (score >= 2310) return '统帅';
  return '中军以下';
}

export default function MemberDetail() {
  const router = useRouter();
  const { id } = router.query;

  // 来源页由跳转方通过 ?from= 带过来（见 lib/member-href.js）
  const from = Array.isArray(router.query.from) ? router.query.from[0] : router.query.from;
  const backLabel = backLabelOf(from);
  /* 页内跳到另一个群友（默契队友 / 仇人）时，来源要延续下去，
     否则链路一断，返回键又变回「回群友列表」 */
  const origin = from || String(router.asPath || '').split('?')[0];

  /* 返回键：知道来路就退一步，退回真正的上一页；
     直接把 router.push(from) 会把历史栈越堆越长（赛事→选手→赛事→…），
     浏览器后退变成在两个页面间来回跳。
     没有来路（直接打开链接 / 从外站进来）才回群友列表。 */
  const goBack = () => {
    if (from && typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(from || '/members');
    }
  };

  const [player, setPlayer] = useState(null);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { me, ready: sessionReady } = useSession();

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const list = d.players || [];
        setPlayers(list);
        const p = list.find((x) => String(x.id) === String(id));
        if (p) setPlayer(p);
        else setNotFound(true);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setNotFound(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const nameMap = useMemo(() => {
    const m = new Map();
    players.forEach((p) => m.set(String(p.id), p.nickname));
    return m;
  }, [players]);

  // 比赛记录由 /api/players 一起返回（按队伍归属 + 名次算好），这里只做兜底
  const records = useMemo(() => (player && Array.isArray(player.records) ? player.records : []), [player]);

  /* 出战记录：逐局展开，带替补标记。
     和上面的「比赛记录」不是一回事——那是按赛事聚合的名次，这是每局上没上场。 */
  const [appear, setAppear] = useState(null);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetch('/api/player-appearances?player_id=' + id)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setAppear(d && d.success ? d : { appearances: [], total: 0, standin_count: 0 });
      })
      .catch(() => {
        if (alive) setAppear({ appearances: [], total: 0, standin_count: 0 });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  // 反向查询：谁把当前选手标记为仇人（「被 xxx 视为仇人」）
  const enemiesOf = useMemo(() => {
    if (!player) return [];
    const curId = String(player.id);
    const result = [];
    players.forEach((p) => {
      const list = p.enemies || [];
      if (list.some((eid) => String(eid) === curId)) {
        result.push(p.nickname || p.group_nickname || String(p.id));
      }
    });
    return result;
  }, [player, players]);

  if (loading) return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  if (notFound || !player) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        没有找到这位群友。
        <br />
        <Link href="/members" style={{ color: 'var(--brand)', fontWeight: 600 }}>
          返回群友列表
        </Link>
      </div>
    );
  }

  const score = Number(player.score) || 0;
  return (
    <>
      <Head>
        <title>{player.nickname} · 群友详情 · 深圳LaRoja Dota2社区</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <button type="button" className="back-link" onClick={goBack}>
            ← {backLabel}
          </button>
          <div className="detail-head">
            <Avatar className="detail-avatar" src={player.avatar} name={player.nickname} eager />
            <div>
              <h1 style={{ fontSize: '1.9rem' }}>{player.nickname || '未命名'}</h1>
              {/* 身份可能是多个：SteamID 与群昵称都全部列出，主号带「主」标记。
                  卡片（PlayerCard）只显示主号，避免列表被撑高。 */}
              <div className="detail-sub">
                {(() => {
                  const list = (player.steamIds && player.steamIds.length
                    ? player.steamIds
                    : player.game_id
                      ? [{ accountId: String(player.game_id), isPrimary: true }]
                      : []);
                  if (list.length === 0) return 'steamID —';
                  return (
                    <span className="id-view">
                      <span style={{ opacity: 0.75 }}>steamID</span>
                      {list.map((s, i) => (
                        <span className={`id-chip${s.isPrimary ? ' is-main' : ''}`} key={i}>
                          {s.accountId}
                          {s.isPrimary && <i className="id-chip-tag">主</i>}
                        </span>
                      ))}
                    </span>
                  );
                })()}
              </div>
              {(() => {
                const nicks = player.groupNicknames && player.groupNicknames.length
                  ? player.groupNicknames
                  : player.group_nickname
                    ? [{ nickname: player.group_nickname, isPrimary: true }]
                    : [];
                if (nicks.length === 0) return null;
                return (
                  <div className="detail-sub">
                    <span className="id-view">
                      <span style={{ opacity: 0.75 }}>群昵称</span>
                      {nicks.map((n, i) => (
                        <span className={`id-chip${n.isPrimary ? ' is-main' : ''}`} key={i}>
                          {n.nickname}
                          {n.isPrimary && <i className="id-chip-tag">主</i>}
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })()}
            </div>
            <div className="detail-score">
              <div className="n">{score}</div>
              <div className="l">{tier(score)}</div>
              {/* 历史最高分由本人自填，可能没有；有就单独一行标出来 */}
              {player.peak_score ? (
                <div className="best">最高 {player.peak_score}</div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="detail-grid">
            {/* 主区：最近比赛（模式 / 版本筛选都在这一块里） */}
            <div className="detail-main">
              <MatchHistory accountId={player.game_id} />
            </div>

            {/* 侧栏：AI 分析（可收起）+ 本人填写的资料 */}
            <div className="detail-aside">
              <AiPanel
                player={player}
                nameMap={nameMap}
                me={me}
                sessionReady={sessionReady}
                loginHref={'/login?from=' + encodeURIComponent(router.asPath || '/members/' + id)}
              />

              <div className="side-card" style={{ marginTop: 18 }}>
                <h4>基本信息</h4>
                <div className="kv">
                  <span className="k">所处地区</span>
                  <span className="v">{player.region || '未填写'}</span>
                </div>
                <div className="kv">
                  <span className="k">擅长位置</span>
                  <span className="v">{(player.positions || []).join(' / ') || '未填写'}</span>
                </div>
                <div className="kv">
                  <span className="k">自报胜率</span>
                  <span className="v">{player.win_rate || 0}%</span>
                </div>
                <div className="kv">
                  <span className="k">冠军数</span>
                  <span className="v">{player.championships || 0} 个</span>
                </div>
                {player.self_intro && (
                  <div className="kv" style={{ alignItems: 'flex-start' }}>
                    <span className="k">自我评价</span>
                    <span className="v">{player.self_intro}</span>
                  </div>
                )}
              </div>

              <div className="side-card" style={{ marginTop: 18 }}>
                <h4>擅长英雄</h4>
                <div className="hero-chips">
                  {(player.heroes || []).length > 0 ? (
                    player.heroes.map((h, i) => (
                      <span className="hero-chip" key={i}>
                        <HeroAvatar name={h} className="hero-chip-avatar" />
                        {h}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>未填写</span>
                  )}
                </div>
              </div>

              <div className="side-card" style={{ marginTop: 18 }}>
                <h4>默契队友</h4>
                <div className="hero-chips">
                  {(player.synergy_players || []).length > 0 ? (
                    player.synergy_players.map((sid, i) => (
                      <Link className="hero-chip" href={memberHref(sid, origin)} key={i}>
                        {nameMap.get(String(sid)) || sid}
                      </Link>
                    ))
                  ) : (
                    <span style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>暂无</span>
                  )}
                </div>
              </div>

              <div className="side-card" style={{ marginTop: 18 }}>
                <h4>仇人</h4>
                <div className="hero-chips">
                  {(player.enemies || []).length > 0 ? (
                    player.enemies.map((sid, i) => (
                      <Link className="hero-chip hero-chip-enemy" href={memberHref(sid, origin)} key={i}>
                        {nameMap.get(String(sid)) || sid}
                      </Link>
                    ))
                  ) : (
                    <span style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>暂无</span>
                  )}
                </div>
                {enemiesOf.length > 0 && (
                  <div className="enemy-passive" style={{ marginTop: 10 }}>
                    被 {enemiesOf.join('、')} 视为仇人
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 比赛记录：名次来自 teams.rank，队伍归属来自 team_players / captain_id */}
          <h2 className="sec-title">
            比赛记录
            {records.length > 0 ? `（${records.length} 届）` : ''}
          </h2>
          {records.length === 0 ? (
            <div className="empty">还没有参加过群内比赛。</div>
          ) : (
            <div className="adm-table">
              <div className="adm-row adm-row-rec adm-head">
                <div>赛事</div>
                <div>队伍</div>
                <div>名次</div>
                <div>担任</div>
                <div>时间</div>
              </div>
              {records.map((r) => {
                const inner = (
                  <>
                    <div className="adm-name">{r.tournament_name}</div>
                    <div>{r.team_name}</div>
                    <div>
                      <span className={`rank-badge ${rankCls(r.team_rank)}`}>
                        {rankLabel(r.team_rank)}
                      </span>
                    </div>
                    <div>
                      {r.is_captain ? <span className="adm-captain-tag">队长</span> : r.position || '未标注'}
                    </div>
                    <div className="adm-date">{fmtDay(r.start_date) || '—'}</div>
                  </>
                );
                return r.tournament_id ? (
                  <Link
                    href={'/tournaments/' + r.tournament_id}
                    className="adm-row adm-row-rec adm-row-link"
                    key={r.team_id}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="adm-row adm-row-rec" key={r.team_id}>
                    {inner}
                  </div>
                );
              })}
            </div>
          )}

          {/* 出战记录：逐局展开，替补标记放这里最直接 */}
          {appear && appear.total > 0 && (
            <>
              <h2 className="sec-title">
                出战记录（{appear.total} 局
                {appear.standin_count > 0 ? ` · 其中替补 ${appear.standin_count} 局` : ''}）
              </h2>
              <div className="ap-tbl">
                <div className="ap-row ap-head">
                  <div>赛事</div>
                  <div>轮次</div>
                  <div>对阵</div>
                  <div>比分</div>
                  <div>身份</div>
                  <div>时间</div>
                </div>
                {appear.appearances.map((a) => (
                  <div className="ap-row" key={a.match_id}>
                    <div className="ap-ev">
                      <Link href={'/tournaments/' + a.tournament_id} className="ap-ev-link">
                        {a.tournament_name}
                      </Link>
                    </div>
                    <div className="ap-round">
                      {a.round_name || '对阵'}
                      {a.order_no ? ` 第${a.order_no}局` : ''}
                    </div>
                    <div className="ap-vs">
                      <span className="ap-team">{a.team_name || '—'}</span>
                      <span className="ap-vs-sep">vs</span>
                      <span className="ap-opp">{a.opponent_name || '—'}</span>
                    </div>
                    <div className={`ap-score ${a.win === true ? 'win' : a.win === false ? 'lose' : ''}`}>
                      {a.my_score === null || a.my_score === undefined
                        ? '—'
                        : `${a.my_score}:${a.opp_score}`}
                    </div>
                    <div>
                      {a.is_standin ? (
                        <span className="ap-standin">替补</span>
                      ) : (
                        <span className="ap-starter">首发</span>
                      )}
                    </div>
                    <div className="ap-date">{fmtDay(a.start_time) || '—'}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
