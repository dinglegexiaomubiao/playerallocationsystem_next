import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';

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
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          {loading && <div className="empty">加载中…</div>}
          {error && <div className="empty">加载失败：{error}</div>}
          {!loading && !error && list.length === 0 && <div className="empty">还没有赛事记录</div>}

          <div className="tour-grid">
            {list.map((t) => {
              const s = STATUS[t.status] || STATUS.planned;
              return (
                <Link href={'/tournaments/' + t.id} className="t-card" key={t.id}>
                  <div className="t-top">
                    <div className="t-name">{t.name || '未命名赛事'}</div>
                    <span className={`t-badge ${s.cls}`}>{s.label}</span>
                  </div>
                  <div className="t-meta">
                    <div>
                      <span className="k">时间：</span>
                      {fmt(t.start_date)} ~ {fmt(t.end_date)}
                    </div>
                    {t.sponsor_info && (
                      <div>
                        <span className="k">赞助：</span>
                        {t.sponsor_info}
                      </div>
                    )}
                    {(t.champion_prize || t.runner_up_prize) && (
                      <div>
                        <span className="k">奖金：</span>
                        冠军 {t.champion_prize || '—'} / 亚军 {t.runner_up_prize || '—'}
                      </div>
                    )}
                    <div>
                      <span className="k">查看详情 →</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
