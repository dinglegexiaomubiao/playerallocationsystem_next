import Link from 'next/link';

/* 内联图标，避免引入图标库依赖 */
const Icon = ({ d, size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const ICONS = {
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  swords: 'M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  arrow: 'M19 12H5M12 19l-7-7 7-7',
};

const STATUS_MAP = {
  finished: { cls: 'done', label: '已完赛' },
  done: { cls: 'done', label: '已完赛' },
  ongoing: { cls: 'live', label: '进行中' },
  elimination: { cls: 'live', label: '淘汰赛' },
  semifinal: { cls: 'live', label: '半决赛' },
  final: { cls: 'live', label: '决赛' },
  planning: { cls: 'open', label: '筹办中' },
};

const fmtDate = (v) => {
  if (!v) return '待定';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * 赛事 Hero + 核心数据卡
 *
 * @param {object}  tournament  赛事对象（name/status/start_date/end_date/sponsor_info…）
 * @param {string}  coverImage  hero 背景图路径
 * @param {object}  stats       { teamCount, playerCount, matchCount, championName }
 * @param {number}  edition     届数（可选，取赛事名里的数字）
 */
export default function TournamentHero({ tournament, coverImage, stats = {} }) {
  const t = tournament || {};
  const st = STATUS_MAP[t.status] || { cls: 'done', label: '赛程' };
  const dateText =
    t.start_date || t.end_date ? `${fmtDate(t.start_date)} — ${fmtDate(t.end_date)}` : '时间待定';

  const cards = [
    { icon: ICONS.users, label: '参赛队伍', value: stats.teamCount ?? 0, suffix: '支' },
    { icon: ICONS.users, label: '参赛选手', value: stats.playerCount ?? 0, suffix: '人' },
    { icon: ICONS.swords, label: '比赛场次', value: stats.matchCount ?? 0, suffix: '场' },
    {
      icon: ICONS.trophy,
      label: '冠军队伍',
      value: stats.championName || '待定',
      gold: true,
      isText: true,
    },
  ];

  // 外层页面已经是 .t-dark，这里只做内容容器；
  // 若再包一层 .t-dark，其 min-height:100vh 会把 Tabs 和正文推到一屏之外
  return (
    <>
      <section className="t-hero">
        {coverImage && (
          <div className="t-hero-bg" style={{ backgroundImage: `url(${coverImage})` }} />
        )}
        <div className="t-wrap t-hero-inner">
          <Link href="/tournaments" className="t-back">
            <Icon d={ICONS.arrow} size={14} />
            返回赛事列表
          </Link>

          <div className="t-hero-title">
            <h1>{t.name || '未命名赛事'}</h1>
            <span className={`t-badge ${st.cls}`}>{st.label}</span>
          </div>

          <div className="t-hero-meta">
            <span>
              <Icon d={ICONS.calendar} size={14} />
              {dateText}
            </span>
            {stats.teamCount > 0 && (
              <span>
                <Icon d={ICONS.users} size={14} />
                {stats.teamCount} 支队伍 · {stats.playerCount} 名选手
              </span>
            )}
          </div>

          {t.sponsor_info && <div className="t-hero-desc">赞助：{t.sponsor_info}</div>}
        </div>
      </section>

      <div className="t-wrap">
        <div className="t-stats">
          {cards.map((c) => (
            <div className="t-stat" key={c.label}>
              <div className={`t-stat-icon ${c.gold ? 'gold' : ''}`}>
                <Icon d={c.icon} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  className="t-stat-num"
                  style={c.isText ? { fontSize: '1.05rem', lineHeight: 1.4 } : undefined}
                >
                  {c.isText ? c.value : `${c.value}${c.suffix || ''}`}
                </div>
                <div className="t-stat-label">{c.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
