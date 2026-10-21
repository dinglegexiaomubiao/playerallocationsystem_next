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
| 群友美食 | `/food` | 101 家店、菜系/区位/人均筛选、饭后评价 |
| 个人信息 | `/profile` | 改自己资料（含默契队友 / 仇人标注）、汇总我的赛事 |
| 阵容分配 | `/main` | 群内比赛的分队工具，管理员专用 |
| 管理后台 | `/admin` | 赛事 CRUD、报名名单、队伍与队长、赛程结果、整包 Excel 导入 |
| 售后工单 | `/admin/support` | 群友反馈 + 前端自动报错，统一处理 |

---

## 技术栈

- **Next.js 16**（Pages Router）+ React 18：页面与 API 同仓
- **PostgreSQL / Neon**：通过 `pg` 连接池访问，非 ORM
- **@anthropic-ai/sdk**：AI 分析，可指向任何兼容 Anthropic 协议的服务
- **xlsx**：Excel 批量导入导出
- **nodemailer**：新工单邮件提醒（可选）

---

## 目录结构

```
├── pages/                     页面路由
│   ├── api/                   30 个接口（鉴权见下方「权限模型」）
│   ├── admin/                 管理后台（index / support / tournaments/[id]）
│   ├── members/               群友列表、详情、阵容分配（重定向到 /main）
│   ├── tournaments/           赛事列表、详情
│   ├── party/                 开黑组队
│   └── food/                  群友美食
├── components/                20 个展示组件
├── hooks/                     6 个状态钩子
│   └── useSession.js          统一登录态（window 事件广播，跨组件同步）
├── lib/                       工具与数据层
│   ├── db.js                  建表 + 查询 + 幂等迁移（约 1000 行）
│   ├── auth.js                会话与四档鉴权守卫
│   ├── password.js            加盐 SHA256
│   ├── image-cache.js         图片三层缓存（内存/磁盘/回源）
│   ├── list-cache.js          列表接口的进程内 TTL 缓存
│   ├── rate-limit.js          登录失败限流
│   ├── excel.js               Excel 列定义与解析
│   └── notify.js              SMTP / Webhook 通知
├── scripts/                   维护脚本（env.js 统一读环境变量）
├── styles/                    globals / layout / main
├── docs/                      页面截图与对外导览（showcase.md）
├── add-performance-indexes.sql 性能索引（幂等，可重复执行）
├── vercel.json                函数区域配置
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

16 张表，分五组：

**账号与选手**
- `play_score` — 登录账号（密码加盐 SHA256），`player_id` 关联选手
- `players` — 选手全局资料（昵称、SteamID、天梯分、英雄池、默契队友、仇人）

**赛事**
- `tournaments` — 赛事主体，7 态状态机（planning / ongoing / elimination / semifinal / final / finished / postponed）
- `tournament_players` — **赛事内快照**：同一选手在不同赛事可有不同分数/位置/英雄，`is_captain` 也限定在赛事内
- `tournament_rounds` — 轮次/阶段
- `matches` — 对阵与比分
- `tournament_teams` — 赛事 ↔ 队伍关联

**队伍**
- `teams` — 队伍，`captain_id` 指向队长
- `team_players` — 队员关系，带队内担任位置
- `player_tournament_participations` — 参赛记录

**社区内容**
- `party_posts` / `party_signups` — 开黑卡片与报名
- `foods` / `food_reviews` — 美食与饭后评价
- `messages` — 留言板

**运维**
- `support_reports` — 反馈与自动报错工单

核心链路：

```
play_score ──1:1── players ──报名──▶ tournament_players ──▶ tournaments
                                                              │
                                          teams ──team_players─┤
                                                              │
                                        tournament_rounds ──▶ matches
```

> `players` 里存的是「默认资料」，报名时复制成 `tournament_players` 快照。之后改全局资料不影响已报名的赛事，这是刻意的设计。

---

## 部署

### 阿里云自托管（当前方式）

```bash
./deploy/deploy.sh      # 本地构建校验 → 打包上传 → 服务器自动快照 → 构建 → pm2 restart
./deploy/rollback.sh    # 出问题 7 秒切回上一版（含构建产物）
```

服务器：`root@47.115.130.170` → `/www/wwwroot/laroja`，PM2 应用名 `laroja-site`，
Nginx 反代 `127.0.0.1:3000`，数据库是**服务器本机 PostgreSQL**。
细节见 `deploy/MIGRATION.md`。

### Vercel（已弃用，仅存档）

以下是当年 Vercel + Neon 的配置记录，现在跑不了也不该再照着做。
保留它只是为了解释 `vercel.json` 和下面这些「区域对齐」结论的来历。

`vercel.json` 已把函数区域固定为 `sin1`（新加坡），当年与 Neon 库同区域：

```json
{ "regions": ["sin1"] }
```

**这一项对响应速度影响最大。** Vercel 函数默认在 `iad1`（华盛顿），跨太平洋到新加坡单次往返约 220ms；一个接口若有几次串行查询，光网络等待就上秒。改动区域前请先确认 Neon 实例的实际区域（连接串主机名里的 `ap-southeast-1` 即新加坡），两边必须对齐。

部署后到 Neon SQL Editor 执行一次：

```sql
-- 或整段粘贴 add-performance-indexes.sql 的内容执行
```

### 其他 Node 服务器

```bash
npm run build && npm start   # 默认 3000 端口，前面挂反向代理
```

---

## 维护脚本

三个一次性脚本，连接串统一从 `.env.local` 或 `DATABASE_URL` 读取：

```bash
node import-players.js           # 默认 DRY-RUN，只打印将要做什么
node import-players.js --commit  # 真正写库
node import-teams.js --commit
node migrate_teams_table.js
```

---

## 已知约束

1. **进程内缓存不适合多实例**。`list-cache`、`rate-limit`、AI 分析缓存、图片内存缓存都在单个 Node 进程里。Vercel 每个函数实例各持一份，命中率有限、限流也不跨实例。当前规模可接受，量大了要换 Redis。
2. **AI 分析模型名与端点需匹配**。`/api/ai-analysis` 里写的是 Anthropic 的模型名，若把 `ANTHROPIC_BASE_URL` 指向 DeepSeek 等中转，模型名要一并改。
3. **多值字段是逗号分隔字符串**（`positions` / `heroes` / `synergy_players` / `enemies`）。可读性好，但不可索引、不可 JOIN。当前几十人规模无压力。
4. **赛事状态由管理员手动切换**，系统不自动判定晋级。
5. **图片缓存盘**写在 `.cache/`（已 gitignore）。只读文件系统下会自动降级为纯内存缓存，不阻断请求。

---

## 更新日志

### v2.4.0 (2026-10-20)

- **性能**：`vercel.json` 固定函数区域为 `sin1`，与 Neon 同区域；`/api/players` 的三次串行查询改并行；补充 18 个性能索引
- **安全**：`/api/players` 的 POST / PUT / DELETE 补上管理员校验（此前只校验 Excel 导入头，写操作实际对外开放）；三个维护脚本的硬编码连接串改为读环境变量，新增 `scripts/env.js`
- **体验**：导航「管理后台」统一指向 `/admin`，原 `/main` 从后台页签进入
- **工程**：补齐 `.env.local.example`、`vercel.json`；README 重写

### v2.3.0 (2026-08-14)

- 新增选手 / 队伍 AI 分析（基于 OpenDota 战绩）
- 登录密码改为加盐 SHA256（旧密码登录后自动升级）
- `addTeam` 改用数据库序列自增，消除并发撞 ID

更早的版本记录见 `git log`。

---

## 浏览器兼容

Chrome 80+ / Firefox 75+ / Safari 13+ / Edge 80+
