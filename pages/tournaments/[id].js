import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

const STATUS_LABEL = { planned: '筹备中', active: '进行中', finished: '已结束', done: '已结束' };

function statusCls(s) {
  if (s === 'active') return 'b-active';
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
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    Promise.all([
      fetch('/api/tournaments/' + id).then((r) => r.json()).catch(() => ({})),
      fetch('/api/teams?tournament_id=' + id).then((r) => r.json()).catch(() => ({ teams: [] })),
    ]).then(([td, teamd]) => {
      if (!alive) return;
      if (td && td.success && td.tournament) setT(td.tournament);
      else setNotFound(true);
      setTeams(teamd.teams || []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);

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
        <title>{t.name} · 赛事详情 · DOTA 群英荟</title>
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
          <div className="side-card">
            <h4>赛事信息</h4>
            <div className="kv">
              <span className="k">状态</span>
              <span className="v">{STATUS_LABEL[t.status] || '—'}</span>
            </div>
            <div className="kv">
              <span className="k">时间</span>
              <span className="v">{fmt(t.start_date)} ~ {fmt(t.end_date)}</span>
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
          </div>

          <div style={{ marginTop: 26 }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, marginBottom: 14 }}>参赛队伍（{teams.length}）</h2>
            {teams.length === 0 ? (
              <div className="empty">暂无队伍数据</div>
            ) : (
              <div className="team-grid">
                {teams.map((team) => {
                  const total = (team.players || []).reduce((s, p) => s + (Number(p.score) || 0), 0);
                  return (
                    <div className="team-card" key={team.id}>
                      <div className="team-head">
                        <div className="team-name">{team.name}</div>
                        <div className="team-score">{total}</div>
                      </div>
                      <div className="team-players">
                        {(team.players || []).length > 0 ? (
                          team.players.map((p) => (
                            <Link key={p.id} href={'/members/' + p.id} className="team-player">
                              <span className="tp-name">{p.nickname}</span>
                              <span className="tp-score">{p.score || 0}</span>
                            </Link>
                          ))
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
        </div>
      </section>
    </>
  );
}
