/**
 * 站点更新日志 —— 首页「更新」Tab 与 /changelog 页的唯一数据源。
 *
 * ⚠ 规则（每次上线都要遵守）：
 *   1. **加到版本数组最前面那个版本的 items 里**；如果这次是一批新功能，
 *      就在最前面新开一个版本（次版本号 +1）。
 *   2. `date` 用上线那天，`at` 用**那条改动真正落地的时刻**，格式必须是
 *      `YYYY-MM-DDTHH:MM+08:00`（北京时间的本地时刻，写死偏移）。
 *      ⚠ 别写 `Z`、也别省略分钟：`clockOf()` 是在字符串上切的，不换算时区，
 *      写成 UTC 或只有日期，管理员看到的「几点」就是错的。
 *   3. **一条只写一件事**（一次提交干了三件事就拆三条）。
 *   4. 说人话，别照抄 commit message（「fix(map): 右栏截断」→「右栏能滚动了」）。
 *   5. `href` 指向能亲眼看到的地方；找不到对应页面就省略。
 *   6. **管理员功能也要记，但必须标 `adminOnly: true`** —— 普通群友看不到，
 *      管理员在日志里能看到自己那份清单。不标就会泄漏到所有人面前。
 *
 * 谁看得到什么：
 *   - 普通群友：版本号 + 日期 + 一句话（时间到「天」为止）
 *   - 管理员：外加每条改动的**时分**（`clockOf()` 算出来的 `HH:MM`），
 *     以及所有 `adminOnly` 的条目。过滤在服务端做，前端隐藏不算隐藏。
 *
 * 版本号规则：`主.次.修订`
 *   - 次版本号 +1：一批用户能感知的新功能
 *   - 修订号 +1：只修 bug / 改文案，没有新功能
 *   - 1.0.0 = 2026-10-20 站点上线那天，按 git 提交时间补录；
 *     再往前的「阵容分配工具」时期没有存档，不补造。
 */

export const CHANGELOG = [
  {
    version: '1.6.0',
    date: '2026-10-23',
    title: '群友卡片带上了帮派的颜色',
    items: [
      {
        title: '有帮派的群友，卡片会薄薄染一层帮派色、左边多一条色线，名字下面写着帮派名 —— 扫一眼就知道谁跟谁一伙',
        href: '/members',
        at: '2026-10-23T23:22+08:00',
      },
      {
        title: '群友详情页的「基本信息」里加了「所属帮派」，能看到对方在哪个帮',
        href: '/members',
        at: '2026-10-23T23:22+08:00',
      },
    ],
  },
  {
    version: '1.5.1',
    date: '2026-10-23',
    title: '动态栏不再抖，更新时间能看到分',
    items: [
      {
        title: '首页「最近动态」切分类时卡片高度固定住了，不再忽高忽低把下面的东西顶来顶去',
        href: '/',
        at: '2026-10-23T23:05+08:00',
      },
      {
        title: '更新日志里每条改动都能看到具体时间（精确到分），首页「更新」Tab 也一样',
        href: '/changelog',
        at: '2026-10-23T23:05+08:00',
        adminOnly: true,
      },
    ],
  },
  {
    version: '1.5.0',
    date: '2026-10-23',
    title: '帮派：群友可以组自己的小团体了',
    items: [
      {
        title: '个人信息里可以创建帮派：起个名字、选一支配色、写句口号，名称和配色全站唯一',
        href: '/profile',
        at: '2026-10-23T22:08+08:00',
      },
      {
        title: '帮主可以邀请群友加入，被邀请的人下次进站会收到邀请弹窗，也可以事后在个人信息里处理',
        href: '/profile',
        at: '2026-10-23T22:52+08:00',
      },
      {
        title: '帮主能改名改色、移除成员、转让帮主、解散帮派；成员可以随时退出',
        href: '/profile',
        at: '2026-10-23T22:08+08:00',
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
        at: '2026-10-23T22:20+08:00',
      },
      {
        title: '新增更新日志页，按版本记录每次改了什么、哪天改的',
        href: '/changelog',
        at: '2026-10-23T22:20+08:00',
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-23',
    title: '活动招募上线，首页第一屏重排',
    items: [
      {
        title: '新增「活动招募」板块：约饭、爬山、打球、钓鱼，群友自己发起、自己报名',
        href: '/activities',
        at: '2026-10-23T14:39+08:00',
      },
      {
        title: '开黑和活动都能按日期看，过期的招募默认折叠起来，不占招募中的位置',
        href: '/party',
        at: '2026-10-23T16:10+08:00',
      },
      {
        title: '活动的筛选栏加了地区下拉，找同城的约饭不用一条条翻',
        href: '/activities',
        at: '2026-10-23T16:15+08:00',
      },
      {
        title: '发帖内容先过一遍合规检查，不合规的当场拦下并说清哪里不行；可疑的还会再送一遍 AI 复审',
        href: '/party',
        at: '2026-10-23T17:03+08:00',
      },
      {
        title: '首页第一屏把「最近动态」并进了今晚开黑那张卡：比赛、开黑、活动、新群友、美食一屏看完',
        href: '/',
        at: '2026-10-23T21:15+08:00',
      },
      {
        title: '群友分布的右栏能滚动了，群友和美食都能看全，不用跳页',
        href: '/map',
        at: '2026-10-23T20:57+08:00',
      },
      {
        title: '群友分布的人数列表加了「返回上一级 / 进入下一级」按钮',
        href: '/map',
        at: '2026-10-23T20:47+08:00',
      },
      {
        title: '个人主页的「最近比赛」卡片可以折叠，还能一键看 AI 分析',
        href: '/members',
        at: '2026-10-23T16:44+08:00',
      },
      {
        title: '赛事页和美食页都标了信息来源，写清楚这些内容是群友提供的',
        href: '/tournaments',
        at: '2026-10-23T16:24+08:00',
      },
      {
        title: '后台可以改群友的登录账号名了，建错号不用重新注册一个',
        href: '/admin/members',
        at: '2026-10-23T10:48+08:00',
        adminOnly: true,
      },
      {
        title: '活动招募有了自己的后台管理页，增删改查不用再连库改数据',
        href: '/admin/activities',
        at: '2026-10-23T16:51+08:00',
        adminOnly: true,
      },
      {
        title: '后台的赛事管理支持搜索选人、现场新建选手，加队员不用来回翻页',
        href: '/admin/members',
        at: '2026-10-23T14:58+08:00',
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
        title: '群友分布从「深圳 9 区」扩成全国三级：全国 → 省 → 市，点地图一路钻下去',
        href: '/map',
        at: '2026-10-22T20:16+08:00',
      },
      {
        title: '英雄译名改用官方数据，暗夜魔王不再显示成暗影恶魔',
        href: '/tournaments',
        at: '2026-10-22T20:26+08:00',
      },
      {
        title: '对局编号可以直接跳去 OpenDota 看原始数据了',
        href: '/tournaments',
        at: '2026-10-22T19:46+08:00',
      },
      {
        title: '群友分布上加了美食标注：点开能看到店名、星级和评价，详情页的返回键会回到地图并记住刚才看的区域',
        href: '/map',
        at: '2026-10-22T17:30+08:00',
      },
      {
        title: '地区改成国 / 省 / 市 / 区四级级联，不用自己手敲一串',
        href: '/profile',
        at: '2026-10-22T15:53+08:00',
      },
      {
        title: '美食的区位换成和群友地区同一套级联，两边终于对得上了',
        href: '/food',
        at: '2026-10-22T16:55+08:00',
      },
      {
        title: '修掉 iPhone 16 和微信内置浏览器的白屏：页面能打开，但里面什么都不显示',
        href: '/',
        at: '2026-10-22T16:16+08:00',
      },
      {
        title: '提交的反馈能在站内看到处理进度和回复',
        href: '/profile',
        at: '2026-10-22T01:01+08:00',
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-21',
    title: '配色重做，赛事页改成秩序册',
    items: [
      {
        title: '全站配色重做，底色转中性、强调色收敛，看久了不容易累',
        href: '/',
        at: '2026-10-21T19:14+08:00',
      },
      {
        title: '支持日间 / 夜间两套主题，右上角随时切',
        href: '/',
        at: '2026-10-21T19:37+08:00',
      },
      {
        title: '赛事页改成「赛事秩序册」：队伍用表格排，阵容换成赛后数据表，装备 / 伤害 / 神杖魔晶都有',
        href: '/tournaments',
        at: '2026-10-21T01:55+08:00',
      },
      {
        title: '加了淘汰赛对阵树，赛事页拆成 Tab，可以按状态和参赛关系筛选',
        href: '/tournaments',
        at: '2026-10-21T08:52+08:00',
      },
      {
        title: '报名前会先跟你确认这届打什么位置、多少分：之后改档案不会动到已经报名的届次',
        href: '/tournaments',
        at: '2026-10-21T02:29+08:00',
      },
      {
        title: '名次支持并列：一届可以有好几个冠军 / 亚军 / 季军，不再只能填一个',
        href: '/tournaments',
        at: '2026-10-21T02:17+08:00',
      },
      {
        title: '替补出战会在群友页和比赛阵容里单独标出来，不会被当成正式队员',
        href: '/members',
        at: '2026-10-21T02:07+08:00',
      },
      {
        title: '一个群友可以绑多个 SteamID 和多个群昵称，老号新号合成同一个人',
        href: '/profile',
        at: '2026-10-21T14:27+08:00',
      },
      {
        title: '忘记密码不用再找人：后台能重置，自己也能改，首次登录会强制改一次',
        href: '/login',
        at: '2026-10-21T15:48+08:00',
      },
      {
        title: '后台能挑出疑似重复的群友，看完比赛记录再决定合并',
        href: '/admin/members',
        at: '2026-10-21T13:42+08:00',
        adminOnly: true,
      },
      {
        title: '有人注册时后台会冒一条待处理提醒，不用等群友自己说',
        href: '/admin',
        at: '2026-10-21T11:13+08:00',
        adminOnly: true,
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-20',
    title: '社区站上线',
    items: [
      {
        title: '从「阵容分配工具」重做成 Dota2 社区站：群友、美食、赛事、开黑四个板块',
        href: '/',
        at: '2026-10-20T10:58+08:00',
      },
      {
        title: '美食：菜系 / 区位 / 推荐人 / 人均四个筛选，外加全字段搜索',
        href: '/food',
        at: '2026-10-20T11:36+08:00',
      },
      {
        title: '群友信息：搜索 + 多维筛选，卡片上能看到 SteamID、冠军数、常用地区',
        href: '/members',
        at: '2026-10-20T17:12+08:00',
      },
      {
        title: '群友可以自己注册了，注册完直接进社区，不用等管理员建号',
        href: '/register',
        at: '2026-10-20T13:39+08:00',
      },
      {
        title: '个人信息页上线：位置、擅长英雄、天梯分，位置和英雄都能多选并排序',
        href: '/profile',
        at: '2026-10-20T15:29+08:00',
      },
      {
        title: '开黑组队板块：发个房间，写清时间、模式和备注，队友点进来就能上车',
        href: '/party',
        at: '2026-10-20T15:13+08:00',
      },
      {
        title: '赛事后台能建比赛、收报名、按报名自动建队；赛程编排、比分录入、恩怨局标记一起上了',
        href: '/tournaments',
        at: '2026-10-20T13:59+08:00',
      },
      {
        title: '英雄和选手都用上了真实头像，不用再看一串灰色占位',
        href: '/tournaments',
        at: '2026-10-20T16:22+08:00',
      },
      {
        title: '全站反馈浮窗：页面报错会自动带上现场信息发出去，不用再让人描述一遍',
        href: '/',
        at: '2026-10-20T17:42+08:00',
      },
      {
        title: 'Excel 批量导入导出：美食清单、群友名单、单届赛事整包（赛事 / 报名 / 队伍 / 对阵）',
        href: '/admin',
        at: '2026-10-20T18:02+08:00',
        adminOnly: true,
      },
      {
        title: '后台能一键同步群友的 Steam 头像，不用一个一个手动传',
        href: '/admin',
        at: '2026-10-20T16:22+08:00',
        adminOnly: true,
      },
      {
        title: '反馈工单可以在后台标记处理状态，群友那边能同步看到',
        href: '/admin/support',
        at: '2026-10-20T17:42+08:00',
        adminOnly: true,
      },
    ],
  },
];

/** 最新版本号，页面标题上用 */
export const LATEST_VERSION = CHANGELOG[0] ? CHANGELOG[0].version : '';

/**
 * 从 `at` 里切出 `HH:MM`。
 *
 * 为什么不 `new Date(at).getHours()`：那是「按运行环境的时区换算」，
 * 服务端在 UTC、浏览器在 +08 的场合会渲染出两个不同的时间（水合直接报错）。
 * 数据里的 at 已经写成 +08:00 的本地时刻，直接切最稳。
 */
export function clockOf(at) {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})[+-]\d{2}:\d{2}$/.exec(String(at || ''));
  return m ? `${m[1]}:${m[2]}` : '';
}

/** 版本的兜底时刻：没写 at 的条目落在这天中午，保证排序稳定 */
const fallbackAt = (date) => `${date}T12:00+08:00`;

/**
 * 摊平成一条条记录，供首页动态栏与 /changelog 使用。
 *
 * @param isAdmin  false 时把 adminOnly 的条目过滤掉（**在服务端过滤**，
 *                 不要指望前端隐藏 —— 那样数据还是发出去了，看一眼网络面板就有）
 * @returns [{ version, versionDate, groupTitle, title, href, at, adminOnly }]，按时间倒序
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
        at: it.at || fallbackAt(group.date),
      });
    }
  }
  return out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/**
 * 按版本分组，供 /changelog 页渲染（已过滤管理员条目）。
 *
 * `clock` 只给管理员：普通群友看到「日期」就够，管理员要的是「几点上线的」。
 * 传递时一并带上 `at`，页面拿 `clock` 显示，别在前端再算一遍时区。
 */
export function changelogByVersion({ isAdmin = false } = {}) {
  return CHANGELOG.map((g) => ({
    version: g.version,
    date: g.date,
    title: g.title,
    items: g.items
      .filter((it) => isAdmin || !it.adminOnly)
      .map((it) => ({
        title: it.title,
        href: it.href || '',
        adminOnly: !!it.adminOnly,
        at: it.at || fallbackAt(g.date),
        ...(isAdmin ? { clock: clockOf(it.at || fallbackAt(g.date)) } : {}),
      })),
  })).filter((g) => g.items.length > 0);
}
