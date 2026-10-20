import Link from 'next/link';

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
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
};

/* 从赛事名里取届次，取不到就不显示——不编一个出来 */
const editionOf = (name) => {
  const m = String(name || '').match(/第\s*([一二三四五六七八九十百零\d]+)\s*届/);
  return m ? `第${m[1]}届` : '';
};

/**
 * 赛事报头
 *
 * 设计约束：不做四张等宽统计卡开局，不做占满首屏的装饰 Banner。
 * 赛事名用衬线展示字体，关键事实一行平铺、竖线分隔，
 * 荣誉（冠军）单独用古铜金标出——古铜金全站只用于荣誉。
 *
 * @param {object} tournament  赛事对象（name/status/start_date/end_date…）
 * @param {string} coverImage  hero 背景图路径
 * @param {object} stats       { teamCount, playerCount, signupCount, matchCount, championName }
 */
export default function TournamentHero({ tournament, coverImage, stats = {} }) {
  const t = tournament || {};
  const st = STATUS_MAP[t.status] || { cls: 'done', label: '赛程' };
  const edition = editionOf(t.name);
  const start = fmtDate(t.start_date);
  const end = fmtDate(t.end_date);
  const dateText = start || end ? `${start || '待定'} — ${end || '待定'}` : null;
  const champion = stats.championName || '';

  /* 只放真实存在的数字，没有数据的那一项直接不出现 */
  const facts = [
    dateText && { k: '日期', v: dateText, wide: true },
    stats.teamCount > 0 && { k: '队伍', v: `${stats.teamCount} 支` },
    stats.playerCount > 0 && { k: '参赛', v: `${stats.playerCount} 人` },
    stats.signupCount > 0 && { k: '报名', v: `${stats.signupCount} 人` },
    stats.matchCount > 0 && { k: '比赛', v: `${stats.matchCount} 场` },
  ].filter(Boolean);

  // 外层页面已经是 .t-dark，这里只做内容容器；
  // 若再包一层 .t-dark，其 min-height:100vh 会把 Tabs 和正文推到一屏之外
  return (
    <section className="t-hero">
      {coverImage && (
        <div className="t-hero-bg" style={{ backgroundImage: `url(${coverImage})` }} />
      )}
      <div className="t-wrap t-hero-inner">
        <div className="t-hero-top">
          <Link href="/tournaments" className="t-back">
            ← 赛事列表
          </Link>
          <span className="t-eyebrow">
            {edition ? `${edition} · ` : ''}
            {st.label}
          </span>
        </div>

        <h1 className="t-hero-name">{t.name || '未命名赛事'}</h1>

        <div className="t-hero-foot">
          <div className="t-facts">
            {facts.map((f) => (
              <span className="t-fact" key={f.k}>
                <span className="t-fact-k">{f.k}</span>
                <span className={`t-fact-v ${f.wide ? 'wide' : ''}`}>{f.v}</span>
              </span>
            ))}
          </div>

          {champion && (
            <span className="t-honor">
              <span className="t-honor-k">冠军</span>
              <span className="t-honor-v">{champion}</span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
