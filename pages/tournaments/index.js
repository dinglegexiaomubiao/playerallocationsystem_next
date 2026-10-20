import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSession from '../../hooks/useSession';
import MyTournamentTable from '../../components/MyTournamentTable';
import { mergeMyTournaments } from '../../lib/tournament-format.mjs';

const STATUS = {
  planned: { cls: 'b-planned', label: '筹备中' },
  active: { cls: 'b-active', label: '进行中' },
  finished: { cls: 'b-done', label: '已结束' },
  done: { cls: 'b-done', label: '已结束' },
};

function fmt(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export default function TournamentsPage() {
  const { me, ready } = useSession();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 我的赛事（登录后才有）
  const [mine, setMine] = useState([]);
  const [mineBound, setMineBound] = useState(true);
  const [mineLoading, setMineLoading] = useState(false);

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
    // 名次/担任位置在 /api/profile，队长身份/队伍在 /api/my-tournaments，合并才是完整履历
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
          <p>共 {list.length} 届赛事 · 历届群内对决赛程与战报</p>
        </div>
      </section>

      {ready && me && (
        <section className="section" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <div className="wrap">
            <div className="sec-head">
              <div>
                <h2>我的赛事</h2>
                <div className="sub">
                  我报名的比赛、我的队长身份与所在队伍
                  {mine.length > 0 ? ` · 共 ${mine.length} 届` : ''}
                </div>
              </div>
              <Link className="more" href="/profile">
                查看个人信息 →
              </Link>
            </div>
            {mineLoading ? (
              <div className="empty" style={{ padding: '30px 0' }}>
                加载中…
              </div>
            ) : !mineBound ? (
              <div className="empty" style={{ padding: '24px 0' }}>
                你的账号还未绑定选手资料，请先
                <Link href="/profile" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                  补填选手资料
                </Link>
                。
              </div>
            ) : (
              <MyTournamentTable items={mine} />
            )}
          </div>
        </section>
      )}

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {ready && me && <div className="sec-head" style={{ marginTop: 8 }}>
            <div>
              <h2>全部赛事</h2>
              <div className="sub">历届群内对决，点进去看赛程与战报</div>
            </div>
          </div>}

          {loading && <div className="empty">加载中…</div>}
          {error && <div className="empty">加载失败：{error}</div>}
          {!loading && !error && list.length === 0 && <div className="empty">还没有赛事记录</div>}

          {!loading && !error && list.length > 0 && (
            <div className="lr-tbl">
              <div className="lr-thead">
                <span>赛事</span>
                <span>状态</span>
                <span>时间</span>
                <span>冠军</span>
              </div>
              {list.map((t) => {
                const s = STATUS[t.status] || STATUS.planned;
                const live = t.status === 'active';
                const champ = t.champions_text || t.champion_team_name || '';
                return (
                  <Link href={'/tournaments/' + t.id} className="lr-trow" key={t.id}>
                    <span className="lr-cell-main">
                      <span className="lr-name">{t.name || '未命名赛事'}</span>
                      {t.sponsor_info && <span className="lr-sub">{t.sponsor_info}</span>}
                    </span>
                    <span className={`lr-status ${live ? 'live' : t.status === 'planned' ? 'plan' : 'done'}`}>
                      {s.label}
                    </span>
                    <span className="lr-time">
                      {t.start_date || t.end_date
                        ? `${fmt(t.start_date)} — ${fmt(t.end_date)}`
                        : '时间待定'}
                    </span>
                    <span className={`lr-champ ${champ ? 'has' : ''}`}>{champ || '—'}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
