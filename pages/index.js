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

/** 动态栏用相对时间：「3 小时前」比「10/23 17:00」好读，超过一个月才退回日期 */
const relTime = (iso) => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60e3) return '刚刚';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)} 分钟前`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} 小时前`;
  if (diff < 2 * 86400e3) return '昨天';
  if (diff < 30 * 86400e3) return `${Math.floor(diff / 86400e3)} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 只取「月/日」。功能更新用它 —— 那类是「哪个版本哪天改的」，不是「多久前发布」 */
const monthDay = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
};

/**
 * 「10/23 22:52」。只给管理员看功能更新的时间。
 *
 * ⚠ 直接从字符串上切，不走 new Date().getHours()：SSR 与浏览器的时区未必一样，
 *   走时区换算就会出现「服务端渲染 14:52、客户端变 22:52」的水合不一致。
 *   lib/changelog.js 里的 at 一律写成 +08:00 的本地时刻，切出来就是对的。
 */
const dayMinute = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
  return m ? `${+m[2]}/${+m[3]} ${m[4]}:${m[5]}` : '';
};

/** Hero 右栏最多摆几条动态 —— 再多会把首屏撑高，剩下的看列表本身的信息密度 */
const FEED_ON_HERO = 6;

/**
 * 首页右栏的分类 Tab。
 *
 * 为什么没有「赛程」和「美食」的 Tab：它们在「全部」里能看到，但右栏宽度只够放
 * 这么几个两字标签 —— 再往里塞就要横向滚动了，而滚动条是隐藏的，
 * 等于「第六个 Tab 存在但你不知道」。所以加 Tab 之前先量宽度（见 check-home-tabs 的溢出断言）。
 * 标签一律两个字：三字会换行，整条 Tab 就散了。
 */
const FEED_TABS = [
  { key: 'all', label: '全部' },
  { key: 'party', label: '开黑' },
  { key: 'activity', label: '活动' },
  { key: 'member', label: '群友' },
  { key: 'guild', label: '帮派' },
  { key: 'feature', label: '更新' },
];

export default function Home() {
  const [tours, setTours] = useState([]);
  const [players, setPlayers] = useState([]);
  const [foods, setFoods] = useState([]);
  const [rooms, setRooms] = useState(0);
  const [feed, setFeed] = useState([]);
  // 右栏 Tab。默认「全部」：一进来应该先看到今天最热闹的事，而不是某一类
  const [feedTab, setFeedTab] = useState('all');
  // 功能更新的时间精确到分只给管理员看，身份由 /api/feed 判定（那边已经按它过滤了条目）
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/tournaments').then((r) => r.json()).catch(() => ({ tournaments: [] })),
      fetch('/api/players').then((r) => r.json()).catch(() => ({ players: [] })),
      fetch('/api/foods').then((r) => r.json()).catch(() => ({ foods: [] })),
      fetch('/api/party').then((r) => r.json()).catch(() => ({ posts: [] })),
      fetch('/api/feed').then((r) => r.json()).catch(() => ({ items: [] })),
    ]).then(([td, pd, fd, rd, ff]) => {
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
      setFeed(Array.isArray(ff.items) ? ff.items : []);
      setIsAdmin(!!ff.isAdmin);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const recent = tours.slice(0, 3);
  const hot = tours.find((t) => t.status === 'active' || t.status === 'ongoing');

  /* 右栏当前 Tab 的显示内容。切 Tab 纯前端过滤，不再请求 —— /api/feed 一次给全了 */
  const feedList = (() => {
    if (feedTab !== 'all') {
      return feed.filter((it) => it.kind === feedTab).slice(0, FEED_ON_HERO);
    }
    /**
     * 「全部」不能纯按时间取前 6 条：某一类当天特别活跃（比如连着进了几个群友），
     * 就会把整屏占满 —— 实测 6 条全是「某某更新了资料」，看着像动态栏坏了。
     * 所以先给每一类保底最新一条，剩下的位子再按时间填，最后整体按时间倒序。
     * （这条规则原来在 /api/feed 里，改成 Tab 后由前端算 —— 分类 Tab 各自过滤，
     *   不需要保底；只有「全部」需要。）
     *
     * ⚠ 种类数（7）已经超过格子数（6）：保底列表本身就放不下，多出来的那条
     *   （按时间最旧的那个「每类最新一条」）会被挤掉。这是有意的取舍 ——
     *   与其为了雨露均沾把行数撑到 7 行（首屏变高、切 Tab 的预留高度也要跟着改），
     *   不如让最久没动静的那一类先让位。分类 Tab 里仍然能看到它自己的全部条目。
     */
    const newestByKind = new Map();
    for (const it of feed) if (!newestByKind.has(it.kind)) newestByKind.set(it.kind, it);
    const guaranteed = [...newestByKind.values()];
    const picked = new Set(guaranteed);
    const rest = feed.filter((it) => !picked.has(it));
    return [...guaranteed, ...rest]
      .slice(0, FEED_ON_HERO)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  })();
  /* Tab 上的条数：让「这个 Tab 有没有东西」一眼可见，不用点进去才发现是空的 */
  const feedCounts = feed.reduce((m, it) => {
    m[it.kind] = (m[it.kind] || 0) + 1;
    return m;
  }, {});

  /** 一行右侧那个时间：功能更新看日期（管理员看到分），其它类看「多久前」 */
  const feedTime = (it) => {
    if (it.kind !== 'feature') return relTime(it.at);
    return isAdmin ? dayMinute(it.at) : monthDay(it.at);
  };

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
            <div className="home-hero-copy">
              <div className="home-hero-eyebrow">
                <span className="home-chip">{hot ? '正在进行' : '今晚开黑'}</span>
                <span className="home-live">
                  {loaded
                    ? rooms > 0
                      ? '社区活跃中'
                      : '还没人开局'
                    : '加载中'}
                </span>
              </div>

              <h1 className="home-title">今晚谁来守高地？</h1>
              <p className="home-lede">比赛、开黑、闲聊和美食，群友的快乐据点。</p>

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
            </div>

            {/* 右栏：有动态就摆动态（信息优先），一条都没有才退回氛围图兜底。
                动态和「今晚谁来守高地」同一张卡，是为了让第一屏只说一件事：
                「现在社区里在发生什么」。 */}
            {feed.length > 0 ? (
              <div className="home-hero-feed" style={{ '--feed-rows': FEED_ON_HERO }}>
                <div className="home-hero-feed-head">
                  <h2>最近动态</h2>
                  {/* 右栏只摆 6 条，想看全部更新去日志页 —— 别写「共 N 条」，
                      写了会让人以为这里还能展开 */}
                  <Link href="/changelog" className="home-hero-feed-more">
                    更新日志 →
                  </Link>
                </div>

                {/* 分类 Tab：纯前端过滤，切一下不重新请求。
                    aria-selected 要真的跟着切，不然读屏用户听到的永远是第一个。

                    刻意不显示条数：右栏最多摆 6 条，而某一类可能有 14 条，
                    标个「14」会让人以为这里能看全。空分类直接把文字压灰，
                    点进去才知道是空的最烦。 */}
                <div className="home-feed-tabs" role="tablist" aria-label="动态分类">
                  {FEED_TABS.map((t) => {
                    const n = t.key === 'all' ? feed.length : feedCounts[t.key] || 0;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={feedTab === t.key}
                        className={
                          'home-feed-tab' +
                          (feedTab === t.key ? ' is-on' : '') +
                          (n === 0 ? ' is-empty' : '')
                        }
                        onClick={() => setFeedTab(t.key)}
                        title={n === 0 ? '这一类暂时没有新动态' : ''}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {feedList.length ? (
                  <ul className="home-hero-feed-list">
                    {feedList.map((it, i) => (
                      <li key={`${it.kind}-${i}`}>
                        <Link href={it.href || '/'} className="home-hero-feed-row">
                          {/* 已经在分类 Tab 里时不再重复同类标签，把宽度让给标题；
                              但「更新」Tab 要显示版本号，那是这一类的关键信息 */}
                          {feedTab === 'all' && (
                            <span className={`home-feed-tag is-${it.kind}`}>{it.label}</span>
                          )}
                          {feedTab === 'feature' && it.version && (
                            <span className="home-feed-ver">{it.version}</span>
                          )}
                          <span className="home-hero-feed-title">{it.title}</span>
                          {/* 功能更新显示日期而不是「10 小时前」：那一条的时间是「版本日期」，
                              相对时间会让所有条目都变成同一个「N 小时前」，看着像同时发的。
                              管理员多看一段时分 —— 想知道「这条到底是今晚几点上线的」。 */}
                          <time className="home-hero-feed-at" dateTime={it.at}>
                            {feedTime(it)}
                          </time>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="home-feed-empty">这一类还没有新动态</p>
                )}
              </div>
            ) : (
              <div className="home-shot">
                <img src="/images/tournament/hero-radiant.jpg" alt="Dota 2 地图" />
              </div>
            )}
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
