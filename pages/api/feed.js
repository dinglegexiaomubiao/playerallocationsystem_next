import { pool } from '../../lib/db';
import { getSession, isAdminName } from '../../lib/auth';
import { flattenChangelog } from '../../lib/changelog';

/**
 * 首页「最近动态」：一次取回所有会出现在动态栏里的东西。
 *
 * 为什么合成一个接口：首页本来就在客户端 Promise.all 拉四份数据，动态栏再开五个
 * 请求会让首屏多等一轮。这里一次查完、服务端合并排序，前端只负责渲染。
 *
 * 七类来源（各取最近几条，够填满动态栏就行）：
 *   match     还没结束的赛程对阵
 *   activity  招募中的活动
 *   party     招募中的开黑
 *   member    新加入 / 刚更新资料的群友
 *   guild     新成立的帮派
 *   food      最新推荐的美食
 *   feature   功能更新（来自 lib/changelog.js，不查库）
 *
 * ⚠ 时间列都是 timestamp without time zone，写入走 CURRENT_TIMESTAMP（库时区是 GMT），
 *   必须 `AT TIME ZONE current_setting('TimeZone')` 转成绝对时刻，否则前端按本地时间
 *   渲染会差 8 小时 —— 和 /api/party 踩过的是同一个坑。
 *
 * ⚠ 任何一类查失败都不影响其它类（各自 try/catch）。最坏情况是动态栏只剩功能更新，
 *   也不该让首页白屏。
 */

// 首页右栏每个 Tab 展示 6 条，所以每类就取 6 条。
// 没有再设总上限：七类 × 6 = 42 条封顶，一次响应完全扛得住，切 Tab 也不必再请求。
const PER_KIND = 6;

const KIND_LABEL = {
  match: '赛程',
  activity: '活动',
  party: '开黑',
  member: '群友',
  guild: '帮派',
  food: '美食',
  feature: '更新',
};

const toIso = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** 「10/25 20:00」这种，够用且不占地方 */
const fmtWhen = (v) => {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: '只支持 GET' });
  }

  const items = [];
  const counts = { match: 0, activity: 0, party: 0, member: 0, guild: 0, food: 0, feature: 0 };
  const failed = [];

  const collect = async (kind, sql, shape) => {
    try {
      const r = await pool.query(sql);
      counts[kind] = r.rows.length;
      for (const row of r.rows) {
        const it = shape(row);
        if (!it || !it.at) continue;
        items.push({ kind, label: KIND_LABEL[kind], ...it });
      }
    } catch (e) {
      failed.push(kind + ': ' + e.message);
    }
  };

  // 1) 还没结束的赛程（status 不是 finished；没有 status 的也算未结束）
  await collect(
    'match',
    `SELECT m.id, m.status, m.tournament_id, m.order_no,
            t.name AS tname, ta.name AS a_name, tb.name AS b_name,
            (m.created_at AT TIME ZONE current_setting('TimeZone')) AS at
       FROM public.matches m
       LEFT JOIN public.tournaments t ON t.id = m.tournament_id
       LEFT JOIN public.teams ta ON ta.id = m.team_a_id
       LEFT JOIN public.teams tb ON tb.id = m.team_b_id
      WHERE m.status IS DISTINCT FROM 'finished'
      ORDER BY m.created_at DESC
      LIMIT ${PER_KIND}`,
    (r) => ({
      title: `${r.tname || '社区内战'} · ${r.a_name || '待定'} vs ${r.b_name || '待定'}`,
      meta: r.order_no ? `第 ${r.order_no} 场` : '',
      href: r.tournament_id ? `/tournaments/${r.tournament_id}` : '/tournaments',
      at: toIso(r.at),
    })
  );

  // 2) 招募中的活动
  await collect(
    'activity',
    `SELECT a.id, a.title, a.type, a.region, a.location, a.meet_at,
            (a.created_at AT TIME ZONE current_setting('TimeZone')) AS at
       FROM public.activity_posts a
      WHERE a.status = 'open'
      ORDER BY a.created_at DESC
      LIMIT ${PER_KIND}`,
    (r) => ({
      title: r.title || '有活动在招人',
      // 「约」是必须的：右边那一列是「这条动态多久前发布」，这里的 meta 是活动本身的时间，
      // 不加前缀两个时间并排会被读成同一件事。
      meta: [r.location || r.region, r.meet_at ? '约 ' + fmtWhen(r.meet_at) : '']
        .filter(Boolean)
        .join(' · '),
      href: '/activities',
      at: toIso(r.at),
    })
  );

  // 3) 招募中的开黑
  await collect(
    'party',
    `SELECT p.id, p.title, p.mode, p.play_time, p.start_at,
            pl.nickname AS creator,
            (p.created_at AT TIME ZONE current_setting('TimeZone')) AS at
       FROM public.party_posts p
       LEFT JOIN public.players pl ON pl.id = p.player_id
      WHERE p.status = 'open'
      ORDER BY p.created_at DESC
      LIMIT ${PER_KIND}`,
    (r) => ({
      title: r.title || `${r.creator || '群友'} 开了一个开黑房间`,
      // play_time 和 start_at 往往是同一个时刻（一个原样存、一个格式化过），只留一个；
      // 「约」用来区分「约在几点开」和右边「多久前发布」。
      meta: r.start_at ? '约 ' + fmtWhen(r.start_at) : r.play_time || '',
      href: '/party',
      at: toIso(r.at),
    })
  );

  // 4) 新加入 / 刚更新资料的群友
  // ⚠ players 的 created_at / updated_at 是 varchar（历史遗留），而且格式混用：
  //   「2026-10-23」和「2026-10-23T12:40:16.973Z」都有。所以：
  //   - 不能写 AT TIME ZONE（会报 pg_catalog.timezone(text, varchar) does not exist）
  //   - 排序只能按文本（同一天里带 T 的排在纯日期前面，够用）
  //   - 解析交给 JS 的 new Date()，两种格式它都认
  await collect(
    'member',
    `SELECT id, nickname, created_at, updated_at
       FROM public.players
      WHERE COALESCE(updated_at, created_at) IS NOT NULL
      ORDER BY COALESCE(updated_at, created_at) DESC
      LIMIT ${PER_KIND}`,
    (r) => {
      const c = r.created_at ? new Date(r.created_at).getTime() : 0;
      const u = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      const latest = Number.isNaN(c) || Number.isNaN(u) ? Math.max(c || 0, u || 0) : Math.max(c, u);
      if (!latest) return null;
      // 7 天内建号才算「新群友」，否则是改过资料
      const isNew = c > 0 && Date.now() - c < 7 * 86400000;
      return {
        title: isNew ? `${r.nickname} 加入了社区` : `${r.nickname} 更新了资料`,
        meta: isNew ? '新群友' : '',
        href: `/members/${r.id}`,
        at: toIso(new Date(latest)),
      };
    }
  );

  // 5) 新成立的帮派
  //
  // 只报「成立」，不报「换帮主 / 有人退帮」：那两类对群友是噪音，而建帮是社区里
  // 值得被看见的一件事（还要抢配色，晚一步就没了）。
  //
  // ⚠ guilds.created_at 是 **timestamptz**（不像活动/美食那些 timestamp），
  //   pg 直接给 Date，绝对时刻是对的，所以**不要**再套 AT TIME ZONE，套了反而错。
  //   帮派表不存在时这里会抛错，collect 会把它记进 failed，不影响其它类。
  await collect(
    'guild',
    `SELECT g.id, g.name, g.color_key, g.slogan, g.leader_player_id,
            g.created_at AS at,
            pl.nickname AS leader,
            (SELECT count(*)::int FROM public.guild_members gm WHERE gm.guild_id = g.id) AS members
       FROM public.guilds g
       LEFT JOIN public.players pl ON pl.id = g.leader_player_id
      ORDER BY g.created_at DESC
      LIMIT ${PER_KIND}`,
    (r) => ({
      // 和「新推荐：」同一句式：一眼看出这是件「刚发生的事」，不是某个固定栏目
      title: `新帮派：${r.name}`,
      // meta 在右栏一行里不渲染（宽度不够），留给接口消费方 / 排查用
      meta: [r.leader ? '帮主 ' + r.leader : '', r.members ? r.members + ' 人' : '']
        .filter(Boolean)
        .join(' · '),
      // ⚠ 帮派还没有独立主页（P4 的 /guild/[id]）。这里落到**帮主**的档案页：
      //   那里「基本信息」里就写着「所属帮派」，点一下能看清是谁立的山头。
      //   不要落到 /profile —— 那一页要登录，匿名群友点动态会被甩到登录页；
      //   也别临时造一个 /guilds 空路由，空页面比多点一次更糟。P4 上线后改这里。
      href: r.leader_player_id ? `/members/${r.leader_player_id}` : '/members',
      colorKey: r.color_key || '',
      at: toIso(r.at),
    })
  );

  // 6) 最新推荐的美食
  await collect(
    'food',
    `SELECT id, name, cuisine, recommender,
            (created_at AT TIME ZONE current_setting('TimeZone')) AS at
       FROM public.foods
      ORDER BY created_at DESC
      LIMIT ${PER_KIND}`,
    (r) => ({
      title: `新推荐：${r.name}${r.cuisine ? '（' + r.cuisine + '）' : ''}`,
      meta: r.recommender ? '来自 ' + r.recommender : '',
      href: '/food',
      at: toIso(r.at),
    })
  );

  // 7) 功能更新（来自 lib/changelog.js，不查库）
  //
  // 管理员条目在这里过滤，**不在前端隐藏**：前端隐藏只是不渲染，数据照样发出去了，
  // 打开网络面板就能看到「后台改了账号名」这类不该给普通群友看的东西。
  //
  // 不做截断：更新日志本身就是「一次给全」的设计（切 Tab 不再请求），
  // 而且 check-feed-admin 要靠完整列表证明管理员的条目一条没漏。
  // 纯文本条目，五十来条加起来也就几 KB，gzip 完可以忽略。
  const session = getSession(req);
  const isAdmin = !!session && isAdminName(session.name);
  const changelog = flattenChangelog({ isAdmin });
  counts.feature = changelog.length;
  for (const c of changelog) {
    items.push({
      kind: 'feature',
      label: KIND_LABEL.feature,
      title: c.title,
      // 版本号放 meta：Tab 里一行一条，标题太长会把版本号挤掉
      meta: c.version,
      version: c.version,
      href: c.href || '',
      at: c.at,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  /**
   * 首页右栏改成了「按类切换」的 Tab：每个 Tab 自己取前几条，
   * 所以这里不再做「每类保底一条 + 截断到 10 条」的混排 —— 那套是为单一混排列表设计的。
   * 现在把全部条目（每类最多 PER_KIND 条）交给前端，切 Tab 不用重新请求。
   */
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    success: true,
    items,
    counts,
    total: items.length,
    isAdmin,
    ...(failed.length ? { failed } : {}),
  });
}
