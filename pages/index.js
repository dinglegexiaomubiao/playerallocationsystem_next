import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';

/* 入口图标：细线、单色，只做导航提示，不当标题装饰 */
const Ic = ({ d }) => (
  <svg
    width="21"
    height="21"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const ICONS = {
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3',
  users:
    'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87',
  utensils: 'M6 3v8a3 3 0 0 0 6 0V3M9 11v10M18 3c-1.5 2-2 4-2 6a2 2 0 0 0 4 0c0-2-.5-4-2-6zM18 15v6',
  card: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 15c0-1.5-1.8-2.5-4-2.5S4 13.5 4 15',
};

const STATUS_LABEL = {
  planned: '筹备中',
  planning: '筹备中',
  active: '进行中',
  ongoing: '进行中',
  finished: '已结束',
  done: '已结束',
};

const fmtRange = (a, b) => {
  const one = (v) => {
    if (!v) return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}.${d.getDate()}`;
  };
  const s = one(a);
  const e = one(b);
  return s && e ? `${s} — ${e}` : s || e || '时间待定';
};

export default function Home() {
  const [tours, setTours] = useState([]);
  const [players, setPlayers] = useState([]);
  const [foods, setFoods] = useState([]);
  const [rooms, setRooms] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/tournaments').then((r) => r.json()).catch(() => ({ tournaments: [] })),
      fetch('/api/players').then((r) => r.json()).catch(() => ({ players: [] })),
      fetch('/api/foods').then((r) => r.json()).catch(() => ({ foods: [] })),
      fetch('/api/party').then((r) => r.json()).catch(() => ({ posts: [] })),
    ]).then(([td, pd, fd, rd]) => {
      if (!alive) return;
      const ts = td.tournaments || [];
      // 最近的排前面：有起止时间按开始时间，没有的沉底
      ts.sort((a, b) => {
        const ta = a.start_date ? new Date(a.start_date).getTime() : 0;
        const tb = b.start_date ? new Date(b.start_date).getTime() : 0;
        return tb - ta;
      });
      setTours(ts);
      setPlayers(pd.players || []);
      setFoods(fd.foods || []);
      setRooms((rd.posts || []).filter((p) => !p.expired).length);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const recent = tours.slice(0, 3);
  const hot = tours.find((t) => t.status === 'active' || t.status === 'ongoing');

  /* 入口卡：只放真实存在的板块，指标也取真实条数 */
  const ENTRIES = [
    {
      icon: ICONS.trophy,
      title: '社区内战',
      meta: loaded ? `${tours.length} 届赛事 · 赛程 / 报名 / 战绩` : '赛程 / 报名 / 战绩',
      go: '查看赛事',
      href: '/tournaments',
    },
    {
      icon: ICONS.users,
      title: '组队开黑',
      meta: loaded ? `${rooms} 个房间开放中 · 找队友 / 组队大厅` : '找队友 / 组队大厅',
      go: '立即组队',
      href: '/party',
    },
    {
      icon: ICONS.utensils,
      title: '群友食堂',
      meta: loaded ? `${foods.length} 条推荐 · 探店 / 评分 / 吐槽` : '探店 / 评分 / 吐槽',
      go: '发现美食',
      href: '/food',
    },
    {
      icon: ICONS.card,
      title: '群友信息',
      meta: loaded ? `${players.length} 位群友 · 天梯分 / 位置 / 英雄池` : '天梯分 / 位置 / 英雄池',
      go: '认识群友',
      href: '/members',
    },
  ];

  return (
    <>
      <Head>
        <title>深圳LaRoja Dota2社区 · 社区首页</title>
        <meta
          name="description"
          content="深圳 LaRoja 社区：Dota2 内战、开黑组队、群友档案与美食推荐。本页信息均由群友提供。"
        />
      </Head>

      <div className="home">
        <div className="wrap">
          {/* ==================== Hero ==================== */}
          <section className="home-hero">
            <div className="home-hero-eyebrow">
              <span className="home-chip">{hot ? '正在进行' : '今晚开黑'}</span>
              <span className="home-live">
                {loaded
                  ? rooms > 0
                    ? '社区活跃中'
                    : '暂无开黑房间'
                  : '加载中'}
              </span>
            </div>

            <h1 className="home-title">今晚谁来守高地？</h1>
            <p className="home-lede">比赛、开黑、闲聊和美食，群友的快乐据点。</p>

            <div className="home-shot">
              {/* 群友自备的 Dota 地图截图，纯氛围图，不带外链标签 */}
              <img src="/images/tournament/hero-radiant.jpg" alt="Dota 2 地图" />
            </div>

            <div className="home-hero-foot">
              <span className="home-rooms">
                {loaded ? (
                  rooms > 0 ? (
                    <>
                      <b>{rooms}</b> 个房间正在招募队友
                    </>
                  ) : (
                    '现在还没有开黑房间，来开第一个'
                  )
                ) : (
                  '正在读取开黑房间…'
                )}
              </span>
              <Link href="/party" className="home-cta">
                寻找队友 →
              </Link>
            </div>
          </section>

          {/* ==================== 2×2 入口 ==================== */}
          <div className="home-grid">
            {ENTRIES.map((e) => (
              <Link key={e.title} href={e.href} className="home-entry">
                <span className="home-entry-ic">
                  <Ic d={e.icon} />
                </span>
                <h3>{e.title}</h3>
                <p className="home-entry-meta">{e.meta}</p>
                <span className="home-entry-go">{e.go} →</span>
              </Link>
            ))}
          </div>

          {/* ==================== 近期赛事 ==================== */}
          {recent.length > 0 && (
            <section className="home-recent">
              <div className="home-sec-head">
                <h2>近期赛事</h2>
                <Link href="/tournaments">全部 {tours.length} 届 →</Link>
              </div>
              {recent.map((t) => {
                const label = STATUS_LABEL[t.status] || '赛程';
                const live = t.status === 'active' || t.status === 'ongoing';
                return (
                  <Link key={t.id} href={`/tournaments/${t.id}`} className="home-trow">
                    <span className="home-trow-name">{t.name || '未命名赛事'}</span>
                    <span className={`home-trow-status ${live ? 'live' : 'done'}`}>{label}</span>
                    <span className="home-trow-date">{fmtRange(t.start_date, t.end_date)}</span>
                  </Link>
                );
              })}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
