import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';

const ENTRIES = [
  { ic: '🏆', cls: 'c-red', title: '赛事信息', desc: '历届内战赛程、对阵、排名与战报，一键复盘。', href: '/tournaments', go: '进入赛事 →' },
  { ic: '👥', cls: 'c-blue', title: '群友信息', desc: '群友档案、天梯分、擅长英雄与 AI 战力分析。', href: '/members', go: '认识群友 →' },
  { ic: '🍜', cls: 'c-gold', title: '群友美食', desc: '群友私藏美食地图，附推荐人、评分与吐槽。', href: '/food', go: '查看美食 →' },
  { ic: '🎯', cls: 'c-green', title: '阵容分配', desc: '按赛事快速组队，自动检测默契与位置覆盖。', href: '/members/assign', go: '开始分配 →' },
];

// 群内日常活动（纯展示，用户明确要求体现「不止 Dota2」）
const ACTIVITIES = [
  { ic: '🎮', label: 'Dota2 内战' },
  { ic: '🍲', label: '吃饭' },
  { ic: '🧗', label: '攀岩' },
  { ic: '🏊', label: '游泳' },
  { ic: '⛰️', label: '爬山' },
  { ic: '🏀', label: '篮球' },
  { ic: '🚴', label: '骑车' },
];

const FALLBACK_POSTS = [
  { av: '赛', tag: '赛事', tagCls: 'tag-tour', time: '赛事', title: '打开赛事信息，查看历届内战', desc: '赛程、对阵与战报都在这里。', href: '/tournaments' },
  { av: '友', tag: '群友', tagCls: 'tag-member', time: '群友', title: '认识群里的高手与乐子人', desc: '天梯分、擅长位置与英雄池一览。', href: '/members' },
  { av: '食', tag: '美食', tagCls: 'tag-food', time: '美食', title: '收藏群友私藏的美食地图', desc: '推荐、评分与一句话点评。', href: '/food' },
];

const STATUS_LABEL = { planned: '筹备中', active: '进行中', finished: '已结束', done: '已结束' };

function tier(score) {
  if (score >= 5420) return '冠绝一世';
  if (score >= 4620) return '超凡入圣';
  if (score >= 3850) return '万古流芳';
  if (score >= 3080) return '传奇';
  if (score >= 2310) return '统帅';
  return '中军以下';
}

function fmt(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export default function Home() {
  const [stats, setStats] = useState([
    { n: '—', l: '注册群友' },
    { n: '—', l: '历史赛事' },
    { n: '—', l: '美食推荐' },
    { n: '—', l: '累计冠军' },
  ]);
  const [focus, setFocus] = useState(null);
  const [posts, setPosts] = useState(FALLBACK_POSTS);
  const [ranks, setRanks] = useState([]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/players').then((r) => r.json()).catch(() => ({ players: [] })),
      fetch('/api/tournaments').then((r) => r.json()).catch(() => ({ tournaments: [] })),
      fetch('/api/foods').then((r) => r.json()).catch(() => ({ foods: [] })),
    ]).then(([pd, td, fd]) => {
      if (!alive) return;
      const players = pd.players || [];
      const tours = td.tournaments || [];
      const foods = fd.foods || [];

      const champs = players.reduce((s, x) => s + (Number(x.championships) || 0), 0);
      setStats([
        { n: players.length, l: '注册群友' },
        { n: tours.length, l: '历史赛事' },
        { n: foods.length, l: '美食推荐' },
        { n: champs, l: '累计冠军' },
      ]);

      const focusT = tours.find((x) => x.status === 'active') || tours[0] || null;
      setFocus(focusT);

      const top = players
        .slice()
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
        .slice(0, 5);
      setRanks(top);

      const np = [];
      if (focusT) {
        np.push({
          av: '赛',
          tag: '赛事',
          tagCls: 'tag-tour',
          time: '最新赛事',
          title: focusT.name || '赛事',
          desc: `${STATUS_LABEL[focusT.status] || '赛程'} · ${fmt(focusT.start_date)} ~ ${fmt(focusT.end_date)}`,
          href: '/tournaments',
        });
      }
      if (top[0]) {
        np.push({
          av: '友',
          tag: '群友',
          tagCls: 'tag-member',
          time: '天梯榜首',
          title: `${top[0].nickname || '群友'} 领跑天梯`,
          desc: `当前 ${top[0].score || 0} 分 · ${tier(Number(top[0].score) || 0)}`,
          href: '/members',
        });
      }
      if (foods[0]) {
        np.push({
          av: '食',
          tag: '美食',
          tagCls: 'tag-food',
          time: '最新推荐',
          title: `${foods[0].name || '美食'} 获得 ${foods[0].rating || 5} 星`,
          desc: `${foods[0].comment || '群友推荐'}${foods[0].recommender ? ' — ' + foods[0].recommender : ''}`,
          href: '/food',
        });
      }
      setPosts(np.length ? np : FALLBACK_POSTS);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <Head>
        <title>深圳LaRoja Dota2社区 · 社区首页</title>
        <meta name="description" content="深圳 LaRoja 社区：不止 Dota2，吃饭、攀岩、游泳、爬山、篮球、骑车日常都在组织。本页信息均由群友提供。" />
      </Head>

      {/* ===== Hero ===== */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-main">
            <h1>
              一群人的<span className="hl">刀塔</span>江湖
              <br />
              不止游戏，还有饭局与山野湖海
            </h1>
            <p>
              深圳 LaRoja 社区：Dota2 内战、吃饭、攀岩、游泳、爬山、篮球、骑车，日常都在组织。
              本页信息均由群友提供。
            </p>
            <div className="hero-cta">
              <Link href="/tournaments" className="btn btn-primary">
                浏览最新赛事 →
              </Link>
              <Link href="/members" className="btn btn-ghost">
                认识群友
              </Link>
            </div>
            <div className="hero-stats">
              {stats.map((s) => (
                <div className="s" key={s.l}>
                  <div className="n">{s.n}</div>
                  <div className="l">{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-card">
            <div style={{ fontSize: '.78rem', color: 'var(--text-3)', fontWeight: 600 }}>本周焦点赛事</div>
            {focus ? (
              <>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', margin: '8px 0 4px' }}>{focus.name}</div>
                <div style={{ fontSize: '.85rem', color: 'var(--text-2)' }}>
                  {STATUS_LABEL[focus.status] || '赛程'} · {fmt(focus.start_date)} ~ {fmt(focus.end_date)}
                </div>
                <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ background: 'var(--accent-soft)', color: 'var(--accent)', padding: '4px 10px', borderRadius: 8, fontSize: '.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {STATUS_LABEL[focus.status] || '赛事'}
                  </span>
                  <Link href="/tournaments" style={{ background: 'var(--brand-soft)', color: 'var(--brand)', padding: '4px 10px', borderRadius: 8, fontSize: '.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    查看详情
                  </Link>
                </div>
              </>
            ) : (
              <div style={{ fontSize: '.85rem', color: 'var(--text-2)', marginTop: 8 }}>暂无赛事数据</div>
            )}
          </div>
        </div>
      </section>

      {/* ===== 群内日常 ===== */}
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="wrap">
          <div className="life-strip">
            <div className="life-head">
              <h2>群内日常</h2>
              <div className="sub">不止 Dota2，这些活动我们日常都在组织</div>
            </div>
            <div className="life-tags">
              {ACTIVITIES.map((a) => (
                <span className="life-tag" key={a.label}>
                  <span className="life-ic">{a.ic}</span>
                  {a.label}
                </span>
              ))}
            </div>
          </div>
          <div className="life-note">网页信息均由群友提供，仅供群内交流使用。</div>
        </div>
      </section>

      {/* ===== 板块入口 ===== */}
      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <h2>探索社区</h2>
              <div className="sub">四大板块，覆盖从赛场到饭桌的全部乐趣</div>
            </div>
          </div>
          <div className="grid-4">
            {ENTRIES.map((e) => (
              <Link key={e.title} href={e.href} className="entry">
                <div className={`ic ${e.cls}`}>{e.ic}</div>
                <h3>{e.title}</h3>
                <p>{e.desc}</p>
                <div className="go">{e.go}</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 社区动态 ===== */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <div>
              <h2>社区动态</h2>
              <div className="sub">来自赛事、群友与美食的最新消息</div>
            </div>
          </div>
          <div className="feed">
            <div className="feed-main">
              {posts.map((p) => (
                <Link className="post" href={p.href || '#'} key={p.title} style={{ cursor: 'pointer' }}>
                  <div className="av">{p.av}</div>
                  <div>
                    <div className="meta">
                      <span className={`tag ${p.tagCls}`}>{p.tag}</span> {p.time}
                    </div>
                    <h4>{p.title}</h4>
                    <p>{p.desc}</p>
                  </div>
                </Link>
              ))}
            </div>
            <div className="side-card">
              <h4>🏅 群友天梯榜</h4>
              {ranks.length === 0 && <div style={{ fontSize: '.85rem', color: 'var(--text-3)' }}>暂无数据</div>}
              {ranks.map((r, i) => (
                <div className="rank" key={r.id || i}>
                  <span className={`no ${i < 3 ? 'top' : ''}`}>{i + 1}</span>
                  <span className="nm">{r.nickname || '群友'}</span>
                  <span className="sc">{r.score || 0}</span>
                </div>
              ))}
              <div style={{ marginTop: 14 }}>
                <Link href="/members" style={{ color: 'var(--brand)', fontWeight: 600, fontSize: '.85rem' }}>
                  完整榜单 →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
