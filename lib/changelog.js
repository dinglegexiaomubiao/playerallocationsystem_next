/**
 * 站点更新日志 —— 首页「更新」Tab 与 /changelog 页的唯一数据源。
 *
 * ⚠ 规则（每次上线都要遵守）：
 *   1. **加到版本数组最前面那个版本的 items 里**；如果这次是一批新功能，
 *      就在最前面新开一个版本（次版本号 +1）。
 *   2. `date` 用上线那天，**一条只写一件事**（一次提交干了三件事就拆三条）。
 *   3. 说人话，别照抄 commit message（「fix(map): 右栏截断」→「右栏能滚动了」）。
 *   4. `href` 指向能亲眼看到的地方；找不到对应页面就省略。
 *   5. **管理员功能也要记，但必须标 `adminOnly: true`** —— 普通群友看不到，
 *      管理员在日志里能看到自己那份清单。不标就会泄漏到所有人面前。
 *
 * 版本号规则：`主.次.修订`
 *   - 次版本号 +1：一批用户能感知的新功能
 *   - 修订号 +1：只修 bug / 改文案，没有新功能
 *   - 版本号不追历史：1.1.0 是开始记录的第一个版本（2026-10-21），
 *     更早的改动没有存档，不补造。
 */

export const CHANGELOG = [
  {
    version: '1.5.0',
    date: '2026-10-23',
    title: '帮派：群友可以组自己的小团体了',
    items: [
      {
        title: '个人信息里可以创建帮派：起个名字、选一支配色、写句口号，名称和配色全站唯一',
        href: '/profile',
      },
      {
        title: '帮主可以邀请群友加入，被邀请的人下次进站会收到邀请弹窗，也可以事后在个人信息里处理',
        href: '/profile',
      },
      {
        title: '帮主能改名改色、移除成员、转让帮主、解散帮派；成员可以随时退出',
        href: '/profile',
      },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-23',
    title: '首页动态可以按类筛选，更新日志独立成页',
    items: [
      {
        title: '首页「最近动态」加了分类标签：全部 / 开黑 / 活动 / 群友 / 更新，想看哪类点哪类',
        href: '/',
      },
      {
        title: '新增更新日志页，按版本记录每次改了什么、哪天改的',
        href: '/changelog',
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-23',
    title: '首页第一屏重排，群友分布更好用',
    items: [
      {
        title: '首页第一屏把「最近动态」并进了今晚开黑那张卡：比赛、开黑、活动、新群友、美食一屏看完',
        href: '/',
      },
      {
        title: '群友分布的右栏能滚动了，群友和美食都能看全，不用跳页',
        href: '/map',
      },
      {
        title: '群友分布的人数列表加了「返回上一级 / 进入下一级」按钮',
        href: '/map',
      },
      {
        title: '发开黑、发活动可以按日期筛选，过期的招募默认折叠起来',
        href: '/party',
      },
      {
        title: '发的备注会先过一遍 AI 合规检查，不合规会提示改',
        href: '/party',
      },
      {
        title: '个人主页的「最近比赛」卡片可以折叠，还能一键看 AI 分析',
        href: '/members',
      },
      {
        title: '后台可以改群友的登录账号名了，建错号不用重新注册一个',
        href: '/admin/members',
        adminOnly: true,
      },
      {
        title: '群友信息支持 Excel 批量导入导出，重复的会先标出来再让你确认',
        href: '/members',
        adminOnly: true,
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-22',
    title: '全国地图与英雄译名修正',
    items: [
      {
        title: '群友分布从「深圳 9 区」扩成全国三级：全国 → 省 → 市',
        href: '/map',
      },
      {
        title: '英雄译名改用官方数据，暗夜魔王不再显示成暗影恶魔',
        href: '/tournaments',
      },
      {
        title: '对局编号可以直接跳去 OpenDota 看原始数据了',
        href: '/tournaments',
      },
      {
        title: '提交的反馈能在站内看到处理进度和回复',
        href: '/profile',
      },
      {
        title: '一键同步群友的 Steam 头像，不用一个一个手动传',
        href: '/admin',
        adminOnly: true,
      },
      {
        title: '反馈工单可以在后台标记处理状态，群友那边能同步看到',
        href: '/admin/support',
        adminOnly: true,
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-21',
    title: '配色重做，支持深浅两套主题',
    items: [
      {
        title: '全站配色重做，底色转中性、强调色收敛，看久了不容易累',
        href: '/',
      },
      {
        title: '支持日间 / 夜间两套主题，右上角随时切',
        href: '/',
      },
    ],
  },
];

/** 最新版本号，页面标题上用 */
export const LATEST_VERSION = CHANGELOG[0] ? CHANGELOG[0].version : '';

/**
 * 摊平成一条条记录，供首页动态栏与 /changelog 使用。
 *
 * @param isAdmin  false 时把 adminOnly 的条目过滤掉（**在服务端过滤**，
 *                 不要指望前端隐藏 —— 那样数据还是发出去了，看一眼网络面板就有）
 * @returns [{ version, versionDate, groupTitle, title, href, at }]，按时间倒序
 */
export function flattenChangelog({ isAdmin = false } = {}) {
  const out = [];
  for (const group of CHANGELOG) {
    for (const it of group.items) {
      if (it.adminOnly && !isAdmin) continue;
      out.push({
        version: group.version,
        versionDate: group.date,
        groupTitle: group.title,
        title: it.title,
        href: it.href || '',
        adminOnly: !!it.adminOnly,
        // 同一天的多条排在一起：统一取当天 12:00（+08:00），避免同一天互相乱序
        at: new Date(group.date + 'T12:00:00+08:00').toISOString(),
      });
    }
  }
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** 按版本分组，供 /changelog 页渲染（已过滤管理员条目） */
export function changelogByVersion({ isAdmin = false } = {}) {
  return CHANGELOG.map((g) => ({
    version: g.version,
    date: g.date,
    title: g.title,
    items: g.items.filter((it) => isAdmin || !it.adminOnly),
  })).filter((g) => g.items.length > 0);
}
