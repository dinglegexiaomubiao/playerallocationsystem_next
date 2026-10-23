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
| 首页 | `/` | 四个统计数字、本周焦点赛事、板块入口、天梯榜 |
| 开黑组队 | `/party` | 发招募卡片（模式/段位要求/时间/语音），别人报名；替代群里刷屏 |
| 赛事信息 | `/tournaments` | 历届赛事、赛程对阵、比分、名次、报名选手与队伍 |
| 群友信息 | `/members` | 档案卡片、六维筛选、比赛履历、AI 战力分析 |
| 群友美食 | `/food` | 106 家店、菜系/区位/人均筛选、饭后评价 |
| 个人信息 | `/profile` | 改自己资料（含默契队友 / 仇人标注）、汇总我的赛事 |
| 阵容分配 | `/main` | 群内比赛的分队工具，管理员专用 |
| 管理后台 | `/admin` | 赛事 CRUD、报名名单、队伍与队长、赛程结果、整包 Excel 导入 |
| 售后工单 | `/admin/support` | 群友反馈 + 前端自动报错，统一处理 |

---

## 技术栈

- **Next.js 16.3**（Pages Router / Turbopack）+ React 18：页面与 API 同仓
- **PostgreSQL**（服务器本机，非 Neon）：通过 `pg` 连接池访问，非 ORM
- **@anthropic-ai/sdk**：AI 分析，当前指向 DeepSeek 兼容端点（须 `thinking:{type:'disabled'}`）
- **xlsx**：Excel 批量导入导出
- **nodemailer**：新工单邮件提醒（可选）
- 没有 TypeScript、没有 Tailwind、没有组件库

> 端到端的架构 / 请求 / 鉴权 / 数据 / 部署 / 自愈 / 兼容七条链路见 **`docs/项目链路.md`**。

---

## 目录结构

```
├── pages/                     页面路由
│   ├── api/                   45 个接口（鉴权见下方「权限模型」）
│   ├── admin/                 管理后台（index / support / tournaments/[id]）
│   ├── members/               群友列表、详情、阵容分配（重定向到 /main）
│   ├── tournaments/           赛事列表、详情
│   ├── party/                 开黑组队
│   └── food/                  群友美食
├── components/                29 个展示组件
├── hooks/                     6 个状态钩子
│   └── useSession.js          统一登录态（window 事件广播，跨组件同步）
├── lib/                       33 个工具与数据层模块（关键几个）
│   ├── db.js                  建表 + 查询 + 幂等迁移（约 1000 行）
│   ├── auth.js                会话与四档鉴权守卫
│   ├── password.js            加盐 SHA256
│   ├── player-identity.js     账号 / 群昵称 / Steam 账号身份解析
│   ├── regions.js             地区路径解析（唯一解析层）
│   ├── image-cache.js         图片三层缓存（内存/磁盘/回源）
│   ├── list-cache.js          列表接口的进程内 TTL 缓存
│   ├── rate-limit.js          登录失败限流
│   ├── excel.js               Excel 列定义与解析
│   └── notify.js              SMTP / Webhook 通知
├── scripts/                   维护脚本（env.js 统一读环境变量）
├── styles/                    tokens / globals / layout / shell / main
├── docs/                      对外导览（showcase.md）+ 项目链路.md
├── add-performance-indexes.sql 性能索引（幂等，可重复执行）
├── vercel.json                ⚠ 已弃用残留文件，Vercel 不再使用，可删
└── .env.local.example         环境变量模板
```

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

登录态是 HMAC 签名的 httpOnly cookie，30 天有效。登录失败按 IP + 账号双维度计数，10 分钟内 5 次即锁定。

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
- `party_posts`（2）/ `party_signups`（0）— 开黑卡片与报名
- `foods`（106）/ `food_reviews`（36）— 美食与饭后评价
- `messages`（5）— 留言板
- `page_views`（7406）— 浏览记录（按 `account_name` 存，改用户名要迁移）

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

服务器：`root@47.115.130.170` → `/www/wwwroot/laroja`，PM2 应用名 `laroja-site`（**单实例 fork**，限流/缓存都是进程内内存），
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
