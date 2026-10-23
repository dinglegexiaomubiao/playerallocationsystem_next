# 帮派（小团体）功能 · 规划

> 目标：群友可以组建自己的小团体。帮主建帮、选配色、写口号，邀请群友加入；
> 被邀请人收到站内弹窗，同意或拒绝。成立后群友卡片显示帮派名，并带该帮配色的渐变背景。
> 另外有公开的帮派列表页和可分享的帮派主页（`/guilds`、`/guild/[id]`）。
>
> 已确认：一人一帮 / 12 套预设配色 / 上限 10 人 / 做列表页与主页。
>
> 本文只讲方案。P0（配色常量 + 对比度验算）已经落地，其余按 P1 → P5 逐阶段实施。

---

## 一、结论

**可行，而且大部分基础设施不用新建。**

| 需要的能力 | 现状 | 结论 |
|---|---|---|
| 文本审核（违禁词） | `lib/moderation.mjs` 的 `checkInput` / `checkText` | 直接用，加几个 LIMITS 常量 |
| AI 审核 | `lib/ai-moderate.mjs` 的 `aiModerate`，超时/未配置自动放行 | 直接用，帮派名/口号/邀请语一起送审 |
| 登录身份 → 选手 | `play_score.player_id`（个人信息页已这么查） | 直接用 |
| 群友搜索 + 筛选 | `/members` 的完整筛选面板（关键词/段位/分数/位置/地区/英雄/排序） | **抽成组件复用**，不重写一套 |
| 详情页「返回上一级」 | `pages/members/[id].js` 已支持 `?from=` | 邀请时带 `from=/profile` 即可，零改动 |
| 弹窗基础 | `HeroPicker` / `PlayerPicker` 那套（遮罩 + Esc + 焦点） | 沿用同样的结构写 `GuildModal` |
| 全局挂载点 | `components/Layout.js` | 挂一个邀请提示组件 |
| 主题兼容 | `styles/tokens.css` 的 `--bg-card` 等 | 配色用**低透明度渐变叠在卡片底色上**，不换底色 |

**唯一需要新建的是数据层和业务接口**，UI 部分主要是组装。

---

## 二、数据模型

三张表。**关系全部放在独立表里，不给 `players` 加列** —— 帮派是「关系」，不是群友的属性；
放进 `players` 会让那个已经 19 列的表更难维护，还会连带影响 `/api/players` 的所有查询。

### 2.1 `guilds`

```sql
CREATE TABLE IF NOT EXISTS public.guilds (
  id               bigserial PRIMARY KEY,
  name             varchar(20) NOT NULL,       -- 展示用，保留原始大小写
  name_key         varchar(20) NOT NULL,       -- 归一化后（NFKC + 小写 + 去空白），唯一索引
  slogan           varchar(60) NULL,
  color_key        varchar(24) NOT NULL,       -- 预设配色 id，唯一索引
  leader_player_id bigint NOT NULL,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS guilds_name_key_uniq ON public.guilds (name_key);
CREATE UNIQUE INDEX IF NOT EXISTS guilds_color_key_uniq ON public.guilds (color_key);
```

**为什么存 `name_key` 而不是直接 `UNIQUE (lower(name))`：**
中文名没大小写，但「LaRoja」「laroja」「ＬａＲｏｊａ」（全角）应当算同一个名字。
`lower()` 只处理大小写，处理不了全角。所以入表前在应用层做一次归一化
（`String.prototype.normalize('NFKC')` + 小写 + 去所有空白），把结果存进 `name_key` 再加唯一索引。
展示永远用 `name`，用户看到的拼写不会被改。

**颜色互斥怎么保证**：`color_key` 直接加唯一索引。选了个被占用的配色，插入时数据库报唯一冲突，
接口翻译成「这支配色已经被其他帮派用了，换一个」。这比「先查再插」可靠 —— 后者在并发下会漏。

### 2.2 `guild_members`

```sql
CREATE TABLE IF NOT EXISTS public.guild_members (
  guild_id   bigint NOT NULL REFERENCES public.guilds(id) ON DELETE CASCADE,
  player_id  bigint NOT NULL,
  role       varchar(10) NOT NULL DEFAULT 'member',   -- leader / member
  joined_at  timestamptz DEFAULT now(),
  PRIMARY KEY (guild_id, player_id)
);

-- 一人只能在一个帮派：这是硬约束，不靠应用层判断
CREATE UNIQUE INDEX IF NOT EXISTS guild_members_player_uniq ON public.guild_members (player_id);
```

`player_id` 上的唯一索引是整个功能的**地基**：它一次性排除了「同一人出现在两个帮派」
「邀请同意后重复入帮」「转让帮主时出现两个 leader」这类问题。帮主也是这张表里的一行（`role='leader'`），
这样成员列表天然统一，不用在两个地方拼。

### 2.3 `guild_invites`

```sql
CREATE TABLE IF NOT EXISTS public.guild_invites (
  id                bigserial PRIMARY KEY,
  guild_id          bigint NOT NULL REFERENCES public.guilds(id) ON DELETE CASCADE,
  player_id         bigint NOT NULL,           -- 被邀请人
  inviter_player_id bigint NOT NULL,           -- 发邀请的帮主
  message           varchar(80) NULL,          -- 邀请语，过审核
  status            varchar(12) NOT NULL DEFAULT 'pending',  -- pending/accepted/rejected/cancelled
  created_at        timestamptz DEFAULT now(),
  responded_at      timestamptz NULL
);

-- 同一个帮派不能对同一个人重复挂两条待处理邀请
CREATE UNIQUE INDEX IF NOT EXISTS guild_invites_pending_uniq
  ON public.guild_invites (guild_id, player_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS guild_invites_player_idx
  ON public.guild_invites (player_id, status);
```

**表要归应用账号所有**：建表放在 `lib/db.js` 的 `ensureGuildSchema()` 里，由应用进程执行
（跟 `activity_posts` 同一模式）。用 `sudo -u postgres psql` 建会让属主变成 `postgres`，
接口随后 500 报 `permission denied` —— 这个坑已经踩过一次。

---

## 三、帮派配色（关键设计）

你说「不能影响夜间模式和日间模式，不能影响文字看不清」。这一条决定了配色**不能自由取色**。

如果让帮主自己填 `#RRGGBB`，他完全可能选一个和正文同明度的色，卡片上的人名就读不清了；
而且没法预先测对比度。所以：

### 3.1 12 套预设，透明度是算出来的不是拍的

```js
// lib/guild-colors.mjs —— 前后端共用
export const GUILD_ALPHA = 0.12; // 见下方实测，这是全部 12 套都不踩线的上限

export const GUILD_COLORS = [
  { key: 'crimson', label: '赤红', solid: '#c0392f' },
  { key: 'amber',   label: '琥珀', solid: '#b8862f' },
  { key: 'moss',    label: '苔绿', solid: '#4d7c4f' },
  { key: 'teal',    label: '青碧', solid: '#2f7d78' },
  { key: 'indigo',  label: '靛蓝', solid: '#4a5cab' },
  { key: 'plum',    label: '梅紫', solid: '#8a4a7d' },
  { key: 'slate',   label: '石青', solid: '#4a6275' },
  { key: 'rust',    label: '铜褐', solid: '#96603c' },
  { key: 'olive',   label: '橄榄', solid: '#6b7a3a' },
  { key: 'rose',    label: '玫灰', solid: '#a8556a' },
  { key: 'steel',   label: '玄铁', solid: '#5b5f66' },
  { key: 'sea',     label: '海松', solid: '#37727a' },
];
```

- `solid`：**实色**，只用在左侧 3px 竖条和小徽标上 —— 实色不压文字
- 渐变两端由 `solid` 派生：一端 `alpha=0.12`，另一端 `alpha=0.04`，
  `linear-gradient(135deg, ...)` 叠在 `--bg-card` 之上
- **主题切换时卡片底色照常翻转，只有那层薄色不变**

### 3.2 为什么是 0.12（实测，不是估计）

把 12 套候选色按不同透明度叠在两种主题的卡片底色上，算**最弱一档文字**（`--text-3`，
日间 `#626973` / 夜间 `#8b939e`）的对比度，结果：

| 配色 | 0.06 | 0.10 | 0.12 | 0.14 | 0.16 |
|---|---|---|---|---|---|
| 赤红（日间） | 5.07 | 4.78 | **4.63** | 4.49 ✗ | 4.35 ✗ |
| 琥珀（夜间） | 4.94 | 4.66 | **4.53** | 4.40 ✗ | 4.27 ✗ |
| 苔绿 | 5.14 | 4.89 | 4.76 | 4.65 | 4.53 |
| 靛蓝（日间） | 5.09 | 4.83 | 4.66 | 4.54 | 4.42 ✗ |

（完整 12 套 × 6 档 × 2 主题都算过，脚本已落地：`scripts/check-guild-contrast.mjs`，
`npm run guild:contrast` 一键复算）

**结论：0.12 是让 12 套全部达标的上限**。0.14 起赤红和琥珀先塌，0.16 时一半配色不达标。
所以统一取 0.12，不按色相单独调 —— 视觉一致比多 0.04 的饱和度重要。

实测最紧的一组是琥珀在夜间 **4.53:1**，只比 4.5 高 0.03。所以这条**不能凭感觉放宽**：
改成 0.16 时立刻有 10 组跌破 4.5（脚本会 exit 1 拦住）。

> ⚠️ 4.49 和 4.63 肉眼完全分不出，但一个过 AA 一个不过。所以 P4 的对比度自检是**必做项**，
> 不是锦上添花。

### 3.3 卡片实际写法

```css
/* styles/layout.css（群友卡片）。变量由内联 style 注入，值来自 GUILD_COLORS */
.p-card.is-guild {
  background-color: var(--bg-card);           /* 主题底色，随日夜翻转 */
  background-image: linear-gradient(135deg, var(--guild-a), var(--guild-b));
  border-color: var(--guild-line);
}
.p-card.is-guild::before {                    /* 左侧实色竖条，强识别且不压文字 */
  content: '';
  position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--guild-solid);
  border-radius: 8px 0 0 8px;
}
```

```jsx
<div className="p-card is-guild" style={{ '--guild-a': c.a, '--guild-b': c.b, '--guild-solid': c.solid }}>
```

**验证方式**：`scripts/a11y-contrast.cjs` 现在只测页面，需要扩一个模式 —— 造 12 个假帮派
（或挑几个真实的）把卡片渲出来，测 12 套配色 × 日夜两个主题下 `p-name` / `p-region` 的对比度，
要求全部 ≥ 4.5:1。**这是这个功能唯一必须做的视觉验收，不做就等于没保证。**

### 3.4 帮派名在卡片上的位置

不新开一行（卡片已经有 steamID / 位置 / 英雄 / 默契队友四组信息，再加一行会散）。
放在 `p-name` 右侧做一枚小徽标：实色描边 + 帮派名，字号降半档。群友详情页（`/members/[id]`）
的基本信息区加一行 `所属帮派`。

---

## 四、交互流程

### 4.1 创建（个人信息页 · 基本信息）

「基本信息」卡片底部加一行 `帮派`。未入帮且未创建时显示 `创建帮派` 按钮，点开弹窗：

| 字段 | 限制 | 校验 |
|---|---|---|
| 帮派名称 | 2~12 字，带实时字数 | 词表 + AI + 唯一（后端唯一冲突转人话） |
| 帮派配色 | 12 选 1，已占用置灰并标「已占用」 | 后端唯一约束兜底 |
| 帮派口号 | ≤ 40 字，带实时字数 | 词表 + AI |

创建成功 → 该群友自动成为帮主（写 `guild_members` 一行 `role='leader'`）。
已在某个帮派里时不显示创建入口，显示「我的帮派：xxx」+ 帮主才有的「帮派管理」。

**前置条件**：账号必须已绑定群友（`play_score.player_id` 有值）。未绑定时按钮置灰并提示
「先绑定你的群友信息」—— 帮派挂在选手上，不挂账号，这是现有数据模型决定的。

### 4.2 帮派管理（弹窗）

```
┌────────────────────────────────────────────────┐
│ 帮派管理                                    ×  │
│ ────────────────────────────────────────────── │
│ 帮派名称 [赤红帮        ] 12/12                │
│ 帮派配色 [色块×12，已占用置灰]                  │
│ 帮派口号 [今晚谁来守高地   ] 8/40              │
│                              [保存修改]         │
│ ────────────────────────────────────────────── │
│ 成员 5/10                    [+ 邀请成员]      │
│  ● 阿芙乐尔  帮主                              │
│  ● yashior                        [移除]       │
│  ● lucca                          [移除]       │
│ ────────────────────────────────────────────── │
│                              [解散帮派]         │
└────────────────────────────────────────────────┘
```

- 上半部：名称 / 配色 / 口号，改完点保存才提交（和现有编辑模式一致，不做自动保存）
- 下半部：成员列表，帮主自己那行没有「移除」；右上角 `邀请成员`
- 底部：`解散帮派`，二次确认（输入帮派名才允许，防误触）

### 4.3 邀请成员

点「邀请成员」→ 打开一个**全屏选择器**，复用 `/members` 的搜索与筛选面板：

- 关键词、段位、分数、位置、地区、英雄、排序，全部沿用
- 列表用紧凑行（头像 + 昵称 + 地区 + 分数），右上角两个动作：`邀请` / `查看资料`
- `查看资料` → 跳 `/members/{id}?from=/profile`，**返回键自动变成「返回上一级」回到个人信息页**
  （`backLabelOf()` 已支持，只是加一个 `from` 取值，不用改详情页）
- 已在帮派里的人、自己、已发过邀请的人：`邀请` 置灰并说明原因
- 点 `邀请` → 弹出填邀请语的小框（≤ 60 字 + 字数显示 + 审核），提交后该行变成「已邀请」

### 4.4 被邀请（弹窗 + 个人信息）

**进站弹窗**：`Layout` 里挂 `<GuildInvitePrompt />`，登录且已绑定时拉一次
`GET /api/guild/invites`，有 pending 就弹：

```
┌──────────────────────────────────┐
│ 帮派邀请                          │
│ 「赤红帮」邀请你加入               │
│ 帮主：阿芙乐尔                     │
│ 「一起打天梯啊，缺个四号位」        │
│              [拒绝]  [同意加入]    │
└──────────────────────────────────┘
```

三条避免打扰的规则：

1. **同一条邀请只自动弹一次**（`localStorage['dd:guild-invite-seen:<id>']`），
   否则每刷一次页面弹一次，人会烦
2. 只在 `pathname` 不是 `/login` 时弹（登录页保持干净，现有逻辑已如此）
3. 多个邀请排队：一次弹一条，处理完提示「还有 N 条」

**个人信息页**：基本信息区在「帮派」那一行显示待处理邀请（`3 个邀请待处理`），
点开是同一个弹窗的列表形态，可逐条同意/拒绝。这样关掉弹窗也不会「找不到入口」。

**同意后**：写 `guild_members`，邀请置 `accepted`，同时把这个人**其他帮派的 pending 邀请
批量置 `cancelled`**（他已经在帮里了，别的邀请没有意义）；如果这个帮派刚刚满员，拒绝并提示。

### 4.5 退出与转让

| 动作 | 谁 | 规则 |
|---|---|---|
| 移除成员 | 帮主 | 直接移除，不通知（或下一阶段加通知） |
| 成员退出 | 任何成员 | 帮主不能直接退出，必须先转让或解散 —— 否则帮派变成无主 |
| 转让帮主 | 帮主 | 从成员里选一个，两行 `role` 互换（同一事务） |
| 解散帮派 | 帮主 | 二次确认，`guilds` 删除后 `guild_members` / `guild_invites` 靠 `ON DELETE CASCADE` 清掉，配色随之释放 |

「帮主不能直接退出」这条必须做，否则会出现「没有 leader 的帮派」——
后面所有需要帮主权限的操作都会锁死。

### 4.6 帮派列表页（`/guilds`）与帮派主页（`/guild/[id]`）

**两个页面都公开可访问**，未登录也能看 —— 因为要能分享给没进站的人。
这也决定了它们不能放任何「只有成员才该看到」的信息（目前也没有：帮派名、口号、成员昵称
本来就在 `/members` 公开）。

#### `/guilds` 列表

```
帮派                                              共 8 个
社区里的小团体，一起打天梯、开黑、约饭。

┌────────────────────────────────────────────────────┐
│▌ 赤红帮         我的                   5/10 人      │
│  今晚谁来守高地                        帮主 阿芙乐尔│
│  ●●●●●                                           │
└────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────┐
│▌ 苔绿小队                             3/10 人      │
│  周末爬山，顺便打两把                  帮主 yashior │
│  ●●●                                             │
└────────────────────────────────────────────────────┘
```

- **已入帮时，自己的帮派置顶**并标「我的」，其余按人数倒序 → 人数相同按创建时间
- 左侧 3px 实色竖条就是这个帮派的配色（不铺整块渐变，列表里一片色块会糊）
- 成员头像叠层预览最多 5 个，多了显示 `+N`
- 未登录访问不显示「我的」，也不显示创建引导（引导只在个人信息页出现，避免两个入口打架）
- 空态：`还没有帮派。`（未登录）/ `还没有帮派，去个人信息创建第一个 →`（已登录）

#### `/guild/[id]` 主页

```
┌──────────────────────────────────────────────┐
│▌ 赤红帮                                       │  ← 顶部一条该配色的薄渐变横幅
│  「今晚谁来守高地」                            │
│  帮主 阿芙乐尔 · 5/10 人 · 2026-10-23 成立      │
│                              [复制链接] [管理] │
├──────────────────────────────────────────────┤
│  成员                                          │
│  ● 阿芙乐尔   帮主   深圳   4200               │
│  ● yashior          重庆   3800               │
└──────────────────────────────────────────────┘
```

- 顶部横幅用同一套低透明度渐变（0.12/0.04），文字仍在底色上，对比度已在验算范围内
- `复制链接` 用 `navigator.clipboard`，失败时回落到「长按地址栏复制」的提示
- `管理` 只对帮主显示，直接打开个人信息页那个同一个 `GuildModal`（不另写一套）
- 未登录访问也完整可见，只是没有「管理」
- 找不到 / 已解散：`没有找到这个帮派` + 回列表链接

**分享所需的 meta**：`/guild/[id]` 要 `getServerSideProps` 取帮派名和口号，
写进 `<title>` 和 `og:title` / `og:description`（微信里分享出去才不是一串裸链接）。

#### 群友卡片上的帮派徽标怎么点进去

现有群友卡片是「整卡可点」——有一层绝对定位的 `.p-card-hit` 盖住卡片，指向
`/members/[id]`；steamID 复制按钮靠「再浮到它上面」实现可点。

帮派徽标要做成链接，必须同样处理，否则点击会被那层遮罩吃掉：

```css
.p-card-guild { position: relative; z-index: 2; }  /* 浮到 .p-card-hit 之上 */
```

这个细节容易漏，漏了的表现是「帮派名看着像链接，点了却进了群友详情」。

#### 导航入口

`PRIMARY_NAV` 现在 7 项（首页 / 开黑 / 活动 / 赛事 / 群友 / 分布 / 美食），
加第 8 项「帮派」会再偷一份宽度预算。**先加，然后必须在 1280 和 1024 两个宽度实测不折行**
（导航项是永不折行的原子单元，折一行整条导航就散了）。
如果挤，降级方案是把帮派放进 `/members` 页顶部作为第二个 tab，导航不加。

---

## 五、审核链路

和活动（`pages/api/activities.js`）完全一致，三层：

```
前端输入 → 字数限制（实时显示）
        → checkText 预检（违禁词，即时提示，不发请求）
后端      → checkInput({ name, slogan, message }, LIMITS)
        → aiModerate({ 帮派名称, 帮派口号, 邀请信息 })
        → 唯一冲突 / 人数上限 / 权限校验
```

新增三个常量（`lib/moderation.mjs` 的 `LIMITS`）：

```js
guildName: 12,
guildSlogan: 40,
guildInvite: 60,
```

**AI 未配置或超时自动放行** —— 这是 `aiModerate` 的既有行为，不要改。帮派名/口号属于公开信息，
词表这一层已经能拦住明显违规。

---

## 六、接口清单

| 方法 | 路径 | 谁 | 作用 |
|---|---|---|---|
| `GET` | `/api/guild` | 登录 | 我的帮派（含成员、我的角色）+ 12 套配色的占用情况 |
| `POST` | `/api/guild` | 登录且已绑定 | 创建（名称/配色/口号） |
| `PATCH` | `/api/guild` | 帮主 | 改名 / 改色 / 改口号 |
| `DELETE` | `/api/guild` | 帮主 | 解散 |
| `POST` | `/api/guild/leave` | 成员 | 退出（帮主调用返回 403 并提示转让或解散） |
| `POST` | `/api/guild/transfer` | 帮主 | 转让帮主 |
| `DELETE` | `/api/guild/members/[playerId]` | 帮主 | 移除成员 |
| `GET` | `/api/guild/invites` | 登录 | 我收到的 pending 邀请（含帮派名、帮主昵称、邀请语） |
| `POST` | `/api/guild/invites` | 帮主 | 发出邀请（player_id + message） |
| `POST` | `/api/guild/invites/[id]` | 被邀请人 | `{ action: 'accept' | 'reject' }` |
| `DELETE` | `/api/guild/invites/[id]` | 帮主 | 撤回邀请 |
| `GET` | `/api/guilds` | **公开** | 帮派列表（供 `/guilds`；登录时带 `isMine` 标记用于置顶） |
| `GET` | `/api/guilds/[id]` | **公开** | 单个帮派 + 成员（供主页与分享页；未登录可用） |

> `/api/guild`（单数，我的帮派，需登录）与 `/api/guilds`（复数，公开列表）是两件事，
> 刻意分开。混成一个接口会让权限分支变复杂：公开接口里夹着「我的角色」这种东西，
> 很容易某天漏判就泄漏了。

已有接口的改动（各一处）：

- `/api/players`：`LEFT JOIN guild_members + guilds`，给每个群友带 `guild: { name, colorKey }`。
  171 条数据，代价可忽略
- `/api/profile`：同样 join，返回 `guild` 和 `pendingInvites` 数量
- `/api/feed`：可选加一类「帮派成立」，**暂不做**（动态栏已经 6 类，再加会稀释）

---

## 七、需要新建的文件

**已经落地的（P0，只碰了新增文件，没改任何现有代码）**：

```
lib/guild-colors.mjs              12 套配色 + 透明度 + guildCardStyle()
scripts/check-guild-contrast.mjs  对比度验算，npm run guild:contrast
```

这两个是纯数据与纯数学。先做它们，是因为「配色到底能不能既看出帮派又不压文字」
是整个方案里最容易翻车的一步 —— 现在这个数已经钉死（0.12），后面 P2/P4 不用再猜。

**接下来要建的**：

```
lib/guild.mjs                     服务端逻辑：取我的帮派 / 权限校验 / 邀请状态机
lib/db.js                         + ensureGuildSchema()（三张表 + 索引）
pages/api/guild/index.js          GET / POST / PATCH / DELETE
pages/api/guild/invites/index.js  GET / POST
pages/api/guild/invites/[id].js   POST / DELETE
pages/api/guild/leave.js
pages/api/guild/transfer.js
pages/api/guild/members/[playerId].js
pages/api/guilds/index.js         GET 公开列表
pages/api/guilds/[id].js          GET 公开主页（未登录可用）
pages/guilds/index.js             帮派列表页（自己帮派置顶）
pages/guild/[id].js               帮派主页（可分享，含 og meta）
components/guild/GuildListItem.js 列表里的一行（配色竖条 + 口号 + 成员头像叠层）
components/GuildPanel.js          个人信息里的「帮派」区块（创建入口 / 我的帮派 / 待处理邀请）
components/GuildModal.js          创建与帮派管理弹窗
components/GuildColorPicker.js    12 色网格（含已占用态）
components/GuildMemberPicker.js   邀请成员的全屏选择器（复用筛选面板）
components/GuildInvitePrompt.js   全局进站弹窗（挂在 Layout）
components/member/MemberFilterPanel.js   ← 从 /members 抽出的筛选面板（见下）
components/Layout.js              + 主导航加「帮派」（需实测 1280/1024 不折行）
styles/layout.css                 + 群友卡片渐变、帮派区块、列表与主页、弹窗样式
scripts/check-guild.cjs           功能自检（见第九节，与上面的对比度验算是两件事）
```

**关于 `MemberFilterPanel` 抽取**：`/members` 那 683 行里，筛选逻辑（facets 计算、多选、
URL 同步）和列表渲染缠在一起。邀请选择器要复用筛选，只有两条路：复制一份（以后改一处漏一处），
或者抽出来。**建议先抽**，抽的时候保证 `/members` 行为完全不变（改完跑一遍现有自检）。
这一步是重构，风险集中在这里，所以单独作为 P1 的第一步做，不和帮派逻辑混在一起改。

---

## 八、阶段计划

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1 数据与底座** | 三张表 + `ensureGuildSchema` + `lib/guild.mjs`；`/members` 筛选面板抽出；`/api/players`、`/api/profile` 带上帮派字段（暂时恒为 null） | 建表成功、`/members` 与 `/profile` 行为零变化、现有自检全过 |
| **P2 创建与管理** | 个人信息「帮派」区块、创建弹窗、配色选择、帮派管理弹窗、改名改色改口号、解散、移除成员、退出、转让 | 名称/配色互斥真的生效（并发插入也只成功一条）、审核能拦住违禁词、无主的帮派不可能出现、第 11 人进不来 |
| **P3 邀请与被邀请** | 邀请选择器（复用筛选）、邀请语审核、进站弹窗、个人信息里的待处理邀请、同意/拒绝、撤回 | 一人一帮在数据库层成立、重复邀请被拒、弹窗不重复骚扰、`from=/profile` 返回正确 |
| **P4 列表与主页** | `/guilds` 列表（自己帮派置顶）、`/guild/[id]` 主页、og meta、复制链接、导航入口 | 未登录能看；分享出去标题和摘要正确；群友卡片上的帮派名可点且不抢整卡链接 |
| **P5 视觉与自检** | 卡片渐变 + 帮派徽标、详情页「所属帮派」、`check-guild.cjs` | `npm run guild:contrast` 全过；手机上弹窗/成员列表不溢出；导航在 1280 不折行 |

**为什么 P1 单独做**：它包含一次对 `/members` 的重构（抽筛选面板）。如果和帮派业务一起改，
出问题时分不清是重构错了还是新功能错了。

**为什么 P4 排在 P3 后面**：列表页和主页都是「读」的功能，靠 P2/P3 写进去的真实数据才有东西可验。
先做页面就只能对着空列表调样式，等真有帮派了还要回头改。

---

## 九、自检项（`scripts/check-guild.cjs`）

不新增检查脚本的话，这个功能只能靠手点 —— 而它有 5 种角色状态（未入帮 / 帮主 / 成员 /
被邀请人 / 路人）和 12 套配色，手点必然漏。至少要覆盖：

1. 未登录：`/api/guild` 401，个人信息页不显示帮派入口
2. 未绑定选手：创建按钮置灰并给出提示
3. 创建：名称/口号超长被截断、违禁词被拦、重名报「已被使用」、重色报「已被占用」
4. 帮主视角：能看到管理按钮、成员列表、邀请入口
5. 成员视角：**看不到**管理按钮，只能退出
6. 邀请：重复邀请被拒、邀请自己不被允许、满员（第 11 人）被拒
7. 被邀请：进站弹窗出现一次、刷新不再弹、同意后卡片出现帮派名与渐变
8. 帮主直接退出被拒（提示转让或解散）
9. 解散后成员卡片恢复无帮派状态、配色释放可被新帮派使用
10. `/guilds` 与 `/guild/[id]` **未登录可访问**（这是分享的前提）
11. 已入帮的人打开 `/guilds`，自己的帮派在第一行并标「我的」
12. `/guild/[id]` 的 `<title>` 与 `og:title` 含帮派名（分享出去不显示成裸链接）
13. 群友卡片上的帮派名**能点进主页**（即 z-index 高于 `.p-card-hit`）
14. 手机端：弹窗不溢出、成员列表可滚动、列表页卡片不被截断

配色对比度不在这个脚本里 —— 它由 `npm run guild:contrast` 单独验（纯数学，不需要起服务）。

---

## 十、已确认的决策

| # | 决策 | 落地方式 |
|---|---|---|
| 1 | **一人只能在一个帮派** | `guild_members (player_id)` 唯一索引，数据库层强制 |
| 2 | **12 套预设配色** | `lib/guild-colors.mjs`，透明度 0.12/0.04，已验算 24 组全达标 |
| 3 | **人数上限 10 人** | 常量 `MAX_GUILD_MEMBERS = 10`，服务端校验（不信前端） |
| 4 | **做帮派列表页 + 可分享主页** | `/guilds`（自己帮派置顶）+ `/guild/[id]`（公开、带 og meta），导航加「帮派」 |

边界值都收敛到一处，改的时候不用满仓库找：

```js
// lib/guild.mjs
export const MAX_GUILD_MEMBERS = 10;
export const MAX_GUILDS_PER_PLAYER = 1;   // 由唯一索引兜底，这里只用于给出人话提示
```
