# 深圳LaRoja Dota2社区

一个给群内自用的社区站点。把散在微信群里的信息收成能查、能看、能报名的东西：谁在打、谁强、什么时候开黑、打完去哪吃。

> 网页信息均由群友提供，仅供群内交流使用。

线上跑在**阿里云自托管**（Nginx + PM2 + 本机 PostgreSQL），域名 `dota.playerallocationsystem.online`。
部署方式见 `deploy/`：`./deploy/deploy.sh`（带自动快照与 `./deploy/rollback.sh` 秒级回滚）。

> 历史说明：2026-10 之前跑在 Vercel + Neon，那两个都已经不用了；下文凡是提到 Vercel / Neon 的段落都是当年的迁移记录，别再照着做。

---

## 功能板块

| 板块 | 路由 | 做什么 |
|---|---|---|
| 首页 | `/` | 四个统计数字、本周焦点赛事、板块入口、天梯榜、最近动态（含新建帮派） |
| 开黑组队 | `/party` | 发招募卡片（模式/段位要求/时间/语音），别人报名；过期自动折叠、可按日期筛选 |
| 活动招募 | `/activities` | 与开黑并列的活动招募：地区筛选、过期折叠、「只看招募中」、日历日期筛选 |
| 赛事信息 | `/tournaments` | 历届赛事、赛程对阵、比分、名次、报名选手与队伍 |
| 群友信息 | `/members` | 档案卡片、六维筛选、比赛履历、AI 战力分析、深圳分布图 `/map` |
| 群友美食 | `/food` | 美食店、菜系/区位/人均筛选、饭后评价 |
| 群友语录 | `/quotes` | 群友名言摘抄，登录后可提交；可打分（0–5 半星）与评价 |
| 公会/帮派 | `/guilds` | 群友自发组织的帮派，含成员、邀请、口号、帮派主页 `/guild/[id]` |
| 个人信息 | `/profile` | 改自己资料（含默契队友 / 仇人标注）、汇总我的赛事、最近比赛（可折叠）+ AI 分析 |
| 阵容分配 | `/main` | 群内比赛的分队工具，管理员专用 |
| 管理后台 | `/admin` | 赛事 / 开黑 / 活动招募 / 选手 / 美食 / 公会 / 语录 / 评价 / 比赛 / 消息 / 工单 / 数据分析 的全套增删改查 |
| 售后工单 | `/admin/support` | 群友反馈 + 前端自动报错，统一处理 |

---

## 技术栈

- **Next.js 16.3**（Pages Router / Turbopack）+ React 18：页面与 API 同仓
- **PostgreSQL**（服务器本机，非 Neon）：通过 `pg` 连接池访问，非 ORM
- **@anthropic-ai/sdk**：AI 分析，当前指向 DeepSeek 兼容端点（须 `thinking:{type:'disabled'}`）
- **xlsx**：Excel 批量导入导出
- **nodemailer**：新工单邮件提醒（可选）
- **内容安全**：`lib/moderation.mjs`（本地违禁词 / 外链白名单初筛）+ `lib/ai-moderate.mjs`（DeepSeek 语义复审，超时 / 无 key 自动放行，fail-open）
- 没有 TypeScript、没有 Tailwind、没有组件库

> 端到端的架构 / 请求 / 鉴权 / 数据 / 部署 / 自愈 / 兼容七条链路见 **`docs/项目链路.md`**。

---

## 目录结构

```
├── pages/                     页面路由（前端页面与 api 同仓）
│   ├── api/                   60+ 个接口（鉴权见下方「权限模型」）
│   ├── admin/                 管理后台全套：index / activities / analytics / food / guilds / members / matches / messages / party / quotes / reviews / support / tournaments/[id]
│   ├── guild/ guilds/         帮派主页 / 帮派列表 Tab
│   ├── quotes/                群友语录独立页
│   ├── activities/            活动招募
│   ├── members/ tournaments/ party/ food/   群友 / 赛事 / 开黑 / 美食
│   ├── map.js                 深圳群友分布图
│   ├── profile.js             个人信息
│   ├── my-tournaments.js      我的赛事
│   ├── changelog.js           更新日志页
│   └── main.js                阵容分配（管理员专用）
├── components/                展示组件（含 member/ 比赛履历、QuoteForm、ActivityCard 等）
├── hooks/                     状态钩子（useSession 统一登录态）
├── lib/                       数据层与工具模块（关键几个）
│   ├── db.js                  建表 + 查询 + 幂等迁移（约 1000 行）
│   ├── auth.js                会话与四档鉴权守卫
│   ├── password.js            加盐 SHA256
│   ├── player-identity.js     账号 / 群昵称 / Steam 账号身份解析
│   ├── regions.js             地区路径解析（唯一解析层）
│   ├── quotes.mjs / guild.mjs 语录 / 公会数据与建表
│   ├── moderation.mjs         内容合规初筛（违禁词 + 外链白名单）
│   ├── ai-moderate.mjs        DeepSeek 语义复审（超时 / 无 key 自动放行，fail-open）
│   ├── image-cache.js         图片三层缓存（内存/磁盘/回源）
│   ├── list-cache.js          列表接口的进程内 TTL 缓存
│   ├── rate-limit.js          登录失败限流
│   ├── excel.js               Excel 列定义与解析
│   └── notify.js              SMTP / Webhook 通知
├── miniprogram/               微信小程序（原生，独立构建，不参与 Web 部署）
├── scripts/                   维护脚本（env.js 统一读环境变量）
├── styles/                    tokens / globals / layout / shell / main
├── docs/                      对外导览（showcase.md）+ 项目链路.md
├── add-performance-indexes.sql 性能索引（幂等，可重复执行）
├── vercel.json                ⚠ 已弃用残留文件，Vercel 不再使用，可删
└── .env.local.example         环境变量模板
```

---

## 微信小程序

`miniprogram/` 是同一套后端之上的微信小程序（原生 WXML/WXSS/JS，**不用** Taro / uni-app），
让群友在微信里直接用，不用跳浏览器。逐页进度、已用接口与待办见 **`小程序项目档案.md`**。

**怎么连后端**：小程序没有 cookie jar，所以会话走 `Authorization: Bearer <签名串>`。
登录 / 注册接口在响应体里多返回一个 `token`（与 `Set-Cookie` 里是**同一个** HMAC 签名串，
30 天），客户端存进 storage 后每次请求带回来。`getSession()` 先读 Bearer、再退回 cookie；
**带了 Bearer 但签名无效时直接判未登录、不退回 cookie**（避免"token 错了却一直登录态"带偏排查）。
网页端行为完全不变。

```bash
# 用微信开发者工具「导入项目」指向本仓库根目录即可（app.json 里 miniprogramRoot=./miniprogram）
# 域名白名单需放行 https://dota.playerallocationsystem.online
```

**页面（24 个）**：首页 / 助手 / 群友（列表·名片·分布图）/ 赛事（列表·详情：名次·赛程对阵·队伍·报名名单·报名退赛）/
开黑（列表·发布·报名·关闭）/ 活动（列表·发布·报名）/ 美食（列表·评价）/ 语录（列表·收录·删除）/
帮派（列表·我的帮派·邀请）/ 个人信息（分数·位置·地区·自我评价·默契队友·仇人）/ 我的赛事 / 修改密码 /
我的 / 登录 / 意见反馈。

**与网页端的差异（有意为之，不是缺口）**：

| | 网页端 | 小程序 |
|---|---|---|
| 管理后台 | `/admin/*` 全套 | 只有最小动作：管理员展开评价列表删除违规评价。表格密集的后台不适合手机 |
| 活动地区 | 省 / 市 / 区三级 | 同样三级（`components/region-picker`），地区数据走 `wx.request` 拉 `public/data/china-division.json` 并缓存 7 天 |
| 工单 | `/admin/support` | 只提交 + 查自己的（`client_token` 保证匿名提交也能查回） |
| 赛事编排 | 建轮次、录比分、选队长 | 只读 + 报名 / 退赛。编排是管理员动作 |
| 注册 | `/register` | 只登录，账号由网页端注册。小程序拿不到手机号授权就不该造第二套账号体系 |
| 多值身份 | `/profile` 里可加多个 SteamID / 群昵称 | 只读展示。服务端要求保留主号，改错的代价是头像、战绩、赛程集体失联，这种交互不适合手机 |

**踩过的坑（改动前先看）**：WXML 里不能用 `?.` / `??` / 箭头函数 / `indexOf()`；
WXSS 自定义属性不能带 `rpx`；每个页面**和每个组件**都必须四件套齐全；
WXML 里用了但没在 `usingComponents` 注册的标签只会报一句语焉不详的模板错误。
`node scripts/check-miniprogram.cjs` 会把上面这些都查一遍。

---

## 快速开始

```bash
npm install
cp .env.local.example .env.local   # 填入 DATABASE_URL 等真实值
npm run dev                        # http://localhost:3000
```

生产构建：

```bash
npm run build
npm start
```

---

## 环境变量

完整清单与逐项说明见 `.env.local.example`。

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | 线上是服务器本机 PostgreSQL（`127.0.0.1:5432/laroja`），本地走 SSH 隧道 `npm run db:tunnel` 后连 `127.0.0.1:15432/laroja`。**不再使用 Neon** |
| `AUTH_SECRET` | 建议 | 会话签名密钥。不填则用 `DATABASE_URL` 派生，**换库会导致所有人掉登录** |
| `ADMIN_NAMES` | 是 | 管理员账号，逗号分隔，大小写不敏感。缺省只有 `dom` |
| `ANTHROPIC_API_KEY` | 否 | 不配则 AI 分析返回 500，其余功能正常 |
| `ANTHROPIC_BASE_URL` | 否 | 走兼容协议的中转时填写 |
| `SUPPORT_SMTP_*` / `SUPPORT_MAIL_*` | 否 | 工单邮件提醒，不配只是不发信 |
| `SUPPORT_WEBHOOK_URL` | 否 | 用 webhook 代替 SMTP 通知 |

> 连接串含密码，只能放在 `.env.local` 或部署平台的环境变量里。**不要写回代码。**

---

## 权限模型

`lib/auth.js` 提供四档守卫，接口按破坏性选档：

| 守卫 | 拦住谁 | 用在 |
|---|---|---|
| 无 | — | 公开读：赛事、群友、美食、开黑列表、图片 |
| `denyIfNotLoggedIn` | 匿名 | 报名、发开黑卡、AI 分析、改自己资料 |
| `denyIfNotAdmin` | 非管理员 | 选手增删改、删除队伍、赛事 CRUD、赛程、选队长、整包导入 |
| `isAdmin`（页面级） | 非管理员 | `/admin/*`、`/main` 的 `getServerSideProps` |

登录态是 HMAC 签名的 httpOnly cookie，30 天有效。小程序等无 cookie 容器另走
`Authorization: Bearer`（同一签名串，见下方「微信小程序」）。登录失败按 IP + 账号双维度计数，10 分钟内 5 次即锁定。

---

## 数据模型

26 张表（线上真实行数见括号），分六组：

**账号与选手（身份层）**
- `play_score`（69）— 登录账号（密码加盐 SHA256），`previous_name` / `name_changed_at` / `name_changed_by` 审计列
- `players`（169）— 选手全局资料（昵称、SteamID、天梯分、英雄池、默契队友、仇人）
- `player_aliases`（27）— 别名 / 曾用名
- `player_group_nicknames`（94）— 群昵称历史快照
- `player_steam_accounts`（106）— Steam 账号绑定（一选手可绑多个）
- `user_configs`（0）— 用户级配置（暂未使用）

**赛事**
- `tournaments`（11）— 赛事主体，7 态状态机（planning / ongoing / elimination / semifinal / final / finished / postponed），**由管理员手动切换**
- `tournament_players`（364）— **赛事内快照**：同一选手在不同赛事可有不同分数/位置/英雄，`is_captain` 也限定在赛事内
- `tournament_rounds`（9）— 轮次/阶段
- `matches`（43）— 对阵与比分
- `tournament_teams`（1）— 赛事 ↔ 队伍关联
- `tournament_placements`（31）— 名次
- `player_tournament_participations`（379）— 参赛记录
- `dota_matches`（43）/ `dota_match_players`（430）— 从 OpenDota 抓取的对局与选手明细

**队伍**
- `teams`（80）— 队伍，`captain_id` 指向队长
- `team_players`（392）— 队员关系，带队内担任位置

**社区内容**
- `party_posts` / `party_signups`— 开黑卡片与报名
- `activity_posts` / `activity_signups`— 活动招募卡片与报名（含地区、过期状态）
- `foods` / `food_reviews`— 美食与饭后评价
- `quotes` / `quote_reviews`— 群友语录与打分评价（0–5 半星，触发器聚合 `rating_avg` / `rating_count`）
- `guilds` / `guild_members` / `guild_invites`— 帮派、成员、邀请
- `messages`— 留言板
- `page_views`— 浏览记录（按 `account_name` 存，改用户名要迁移）

**运维**
- `support_reports`（412）— 反馈与自动报错工单（按 `account_name` 存，改用户名要迁移）

核心链路：

```
play_score ──1:1── players
                    │
                    ├── player_aliases / player_group_nicknames / player_steam_accounts   (1:N 身份维度)
                    ├── 报名 ──▶ tournament_players ──▶ tournaments
                    ├── 参赛 ──▶ player_tournament_participations ──▶ tournaments
                    └── team_players ──▶ teams

tournaments ── tournament_teams ──▶ teams
tournament_rounds ──▶ matches ──▶ dota_matches ──▶ dota_match_players
tournament_placements ──▶ tournaments   (名次)
```

> `players` 里存的是「默认资料」，报名时复制成 `tournament_players` 快照。之后改全局资料不影响已报名的赛事，这是刻意的设计。
> 改用户名要连带迁移 `page_views` / `party_posts` / `party_signups` / `support_reports` 的 `account_name`，详见 `docs/项目链路.md` 第 2 节。

---

## 部署

### 阿里云自托管（当前方式）

```bash
./deploy/deploy.sh      # 本地构建（产出上线产物）→ 打 2.8M 包 → 上传 → 服务器解压/修链接/合并旧 static/原子切换 → pm2 restart
./deploy/rollback.sh    # 出问题秒级切回上一版快照（含构建产物）
```

> 部署窗口已压缩到 **约 25 秒**、**0 个 5xx**（2026-10-23 重构前是服务器原地构建 8 分钟，产生 28×504 + 137×499）。完整链路见 `docs/项目链路.md` 第 5 节。

服务器：`root@YOUR_SERVER_IP` → `/www/wwwroot/laroja`，PM2 应用名 `laroja-site`（**单实例 fork**，限流/缓存都是进程内内存），
Nginx 反代 `127.0.0.1:3000`，数据库是**服务器本机 PostgreSQL**（`DATABASE_SSL=off`）。
细节见 `deploy/MIGRATION.md`。

### Vercel / Neon（已弃用，仅存档）

2026-10 之前跑在 Vercel + Neon，现已完全不用。`vercel.json` 是当时的残留文件，**可删**，别再照着配。
当年为对齐函数区域（Vercel `sin1` ↔ Neon `ap-southeast-1`）调过的 `regions` 配置已无参考价值。

### 其他 Node 服务器

```bash
npm run build && npm start   # 默认 3000 端口，前面挂反向代理
```

---

## 维护脚本

连接串统一从 `.env.local` 或 `DATABASE_URL` 读取（连库前 `set -a; . .env.local; set +a`）。常用：

```bash
node scripts/import-data.js --commit     # 整包数据导入（默认 DRY-RUN，只打印）
node scripts/import-s11-roster.js        # 导入 S11 阵容
node scripts/migrate-history.js          # 历史数据迁移
node scripts/backfill-league.js          # 回填联赛数据
node scripts/dump-data.js                # 导出数据快照
```

小程序（`scripts/lib/mp-runtime.cjs` 是个迷你运行时：把 `Page()` / `Component()` 的
`setData`、组件属性、事件翻译成 Node 里可调用的对象，所以能直接**driving 页面方法**做联调，
不必开模拟器）：

```bash
node scripts/check-miniprogram.cjs         # 静态自查：四件套 / tabBar / 组件注册 / 语法 / 浏览器 API，不用网络
node scripts/check-auth-bearer.cjs         # 会话双通道 19 条断言，不用网络
node scripts/smoke-miniprogram.cjs         # 只读冒烟，逐页拉接口
node scripts/check-miniprogram-writes.cjs  # 写操作（发卡片 / 报名 / 评价 / 语录），需要探针账号 + 管理员 token
node scripts/check-miniprogram-guild.cjs   # 帮派全链路 38 条断言，需要两个夹具账号
node scripts/check-miniprogram-extras.cjs  # 活动地区 / 意见反馈 / 管理员删评价
node scripts/check-miniprogram-tournament.cjs # 赛事详情 40 条（含报名退赛写链路）
node scripts/check-miniprogram-profile.cjs     # 个人信息 / 我的赛事 / 改密码 38 条（含「只提交改动字段」回归）

# 夹具由 deploy/probe-account.cjs 建与拆（在服务器上跑，跑完务必 down）：
node deploy/probe-account.cjs up-pair Probe2026ga Probe2026gb
# …跑完…
node deploy/probe-account.cjs down
```

更多脚本（地图生成、语法补丁、图标预热等）见 `scripts/`，完整清单见 `docs/项目链路.md` 第 8 节。

---

## 已知约束

1. **进程内缓存不适合多实例**。`list-cache`、`rate-limit`、AI 分析缓存、图片内存缓存都在单个 Node 进程里。PM2 现在固定 `instances: 1`，量大了要换 Redis。
2. **AI 分析模型名与端点需匹配**。`/api/ai-analysis` 里写的是 Anthropic 的模型名，若把 `ANTHROPIC_BASE_URL` 指向 DeepSeek 等中转，模型名要一并改，且必须显式 `thinking:{type:'disabled'}`。
3. **多值字段是逗号分隔字符串**（`positions` / `heroes` / `synergy_players` / `enemies`）。可读性好，但不可索引、不可 JOIN。当前规模无压力。
4. **赛事状态由管理员手动切换**，系统不自动判定晋级。
5. **图片缓存盘**写在 `.cache/`（已 gitignore）。只读文件系统下会自动降级为纯内存缓存，不阻断请求。
6. **浏览器兼容下限是老引擎**：真实用户有 iOS 16 / 微信内置 Chrome 86（XWEB 4433），上限 = Safari 16.3 / Chrome 86。部署前 `prebuild` 会自动降级 ES2022 语法、`postbuild` 会卡掉不兼容产物（详见 `docs/项目链路.md` 第 7 节）。

---

## 更新日志

> 2026-10 已从 Vercel + Neon 迁到阿里云自托管（本机 PostgreSQL）。v2.4.0 及更早里提到的 `vercel.json` / Neon 区域对齐，都是迁移前的操作，现已不适用。

### v2.7.2 (2026-10-27)

- **个人信息编辑**（`pages/profile`）：分数 / 最高分 / 胜率 / 擅长位置 / 擅长英雄 / 地区（复用 `region-picker`）/ 自我评价 / 默契队友 / 仇人
- **只提交改动过的字段**：保存前与加载快照逐字段比对。整表提交会把用户没动的分数一起写一遍，`PUT /api/profile` 对数字字段的约定是「传 `''` = 清空」，一次手滑就能把天梯分清空
- **留空 = 不修改**：分数清空的唯一方式是填 0，比「删掉就没了」更难误操作；小数在客户端就拦（服务端 integer 列会 500）
- **我的赛事**（`pages/my-tournaments`）：参加过哪几届、第几届冠军、我的队伍、是否队长，点击进赛事详情
- **修改密码**（`pages/password`）：验原密码（服务端把旧密码错误计入限流），成功后当前登录态不受影响
- **`/api/options`** 下发 `limits.nickname|selfIntro|region|heroItem`，小程序不再抄一份长度常量
- **联调脚本**：`scripts/check-miniprogram-profile.cjs` 38 条断言，可重复跑（开头把夹具资料复位成基线）

### v2.7.1 (2026-10-27)

- **赛事详情页**（`pages/tournament`）：名次（支持并列）、赛程对阵（按轮次分组、比分、胜者、恩怨局标记）、队伍成员（点击展开）、报名名单（默认 8 条可展开），附报名 / 退赛
- **报名走服务端快照**：小程序不传分数与位置，由 `/api/tournaments/{id}/signup` 用档案值生成本届快照；队长退赛被服务端拒绝，页面给出「先去网页端卸任」的提示
- **联调脚本**：`scripts/check-miniprogram-tournament.cjs` 40 条断言（含真写库的报名→退赛闭环，跑完不留残留）
- **测试运行时**：`mp-runtime` 的 `setData` 支持数组下标路径键（`teams[0].open`），此前只认点号，会把「点了没反应」误判成页面 bug
- **项目档案**：新增 `小程序项目档案.md`，记录页面进度、已用接口、待办与已知问题，供后续会话恢复上下文

### v2.7.0 (2026-10-26)

- **微信小程序**：`miniprogram/` 20 个页面（首页 / 群友 / 赛事 / 开黑 / 活动 / 美食 / 语录 / 帮派 / 个人信息 / 我的 / 登录注册 / 更新日志），覆盖网页端除管理后台外的全部功能
- **会话双通道**：`getSession()` 支持 `Authorization: Bearer`（同一签名串，登录 / 注册接口回传 `token`），网页端 cookie 行为不变；小程序无 cookie 也能登录
- **小程序补齐**：活动发布补三级地区选择（首个自定义组件 `region-picker`）、意见反馈（带 `client_token`，匿名也能查回自己的）、管理员在美食页展开并删除违规评价
- **接口配合**：`/api/options` 下发帮派配色与长度限制（小程序不再复制一份常量）；`/api/quotes` 每条带 `canDelete`，判据与 DELETE 分支完全一致
- **联调脚本**：`scripts/lib/mp-runtime.cjs` 迷你运行时 + 6 个检查脚本（静态自查 / 双通道 / 冒烟 / 写操作 / 帮派全链路 / 补丁三联），夹具统一由 `deploy/probe-account.cjs` 建拆
- **数据修复**：后台合并选手时把被并入方的显示名 / 群昵称迁成可搜索别名，合并后旧名仍能搜到人

### v2.6.0 (2026-10-24)

- **公会系统**：帮派独立 Tab + 帮派主页（成员 / 邀请 / 口号）、个人信息里的帮派区块、后台管理（`/admin/guilds`）
- **群友语录**：独立页 + 底部悬浮栏，登录后可提交；语录可打分（0–5 半星）与评价，后台可管理（`/admin/quotes`、`/admin/reviews`）
- **活动招募**：独立于开黑的「活动」板块，支持地区筛选、过期折叠、「只看招募中」、日历日期筛选，配套后台增删改查（`/admin/activities`）
- **内容安全**：所有 UGC（开黑 / 活动 / 美食评价 / 美食 / 个人信息 / 注册 / 工单 / 语录）先过 `moderation.mjs` 违禁词 + 外链白名单初筛，再送 DeepSeek 语义复审（`ai-moderate.mjs`，超时 / 无 key 自动放行）
- **前台体验**：开黑 / 活动过期自动折叠；赛事 / 美食页来源声明；个人信息页接入最近比赛（可折叠）+ AI 分析；英雄格缩小一倍、胜负角标改绿 / 红底黑字
- **后台补齐**：赛事后台搜索选人 / 新建选手、统一后台外壳 + 补 4 个管理页（比赛 / 消息 / 数据分析 / 公会）
- **数据修复**：八届赛事选手归属全部修复（含第八届整届重建、队伍 2 夺冠），补 `haruna` / `光神` 等身份

### v2.5.0 (2026-10-23)

- **部署根治 #425「按键失灵 + 报错 500」**：旧流程服务器原地 `next build` 把访问中的用户挂在半路上（实测 11×500 / 28×504 / 137×499）。改为**本地构建产物后上传**，部署窗口 8 分钟 → 25 秒、5xx 0、499 0、chunk 404 0
- **自愈脚本修两个真 bug**：配额时间戳从内存变量改存 `sessionStorage`（否则跳转后归零、实测 81ms 连跳两次）；拼接新 URL 前先剥掉已有 `_r`
- **后台「改用户名」**：放在「重置密码」旁边，主键更新 + 四表历史迁移 + 两个禁区（不改管理员名 / 不许把任何人改成管理员名）
- 新增 `docs/项目链路.md`（架构 / 请求 / 鉴权 / 数据 / 部署 / 自愈 / 兼容七条链路）

### v2.4.0 (2026-10-20)

- **安全**：`/api/players` 的 POST / PUT / DELETE 补上管理员校验（此前只校验 Excel 导入头，写操作实际对外开放）；维护脚本硬编码连接串改为读环境变量，新增 `scripts/env.js`
- **体验**：导航「管理后台」统一指向 `/admin`，原 `/main` 从后台页签进入
- **工程**：补齐 `.env.local.example`；README 重写（当时仍跑在 Vercel + Neon）

### v2.3.0 (2026-08-14)

- 新增选手 / 队伍 AI 分析（基于 OpenDota 战绩）
- 登录密码改为加盐 SHA256（旧密码登录后自动升级）
- `addTeam` 改用数据库序列自增，消除并发撞 ID

更早的版本记录见 `git log`。

---

## 浏览器兼容

**下限（必须保证能跑）**：iOS 16.0 / 16.2 Safari，微信内置 Chrome 86（XWEB 4433）。等价于**上限 = Safari 16.3 / Chrome 86**。

桌面 Chrome / 新版 iPhone 看不出问题，但老引擎会在 Next 16.3 的 `class 静态块` 语法上整包 `Unexpected token` → React 不起动。部署前 `prebuild` 自动降级语法、`postbuild` 卡掉不兼容产物，是硬性保障。
