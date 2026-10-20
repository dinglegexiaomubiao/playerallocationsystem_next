# 群友身份模型改造方案：多昵称 + 多 Steam 账号

> 目标：一个群友可以挂多个昵称、多个 Steam 账号（大号/小号），指定一个为常用号；
> 头像、战绩、AI 分析、比赛补录都按「这个人的全部账号」聚合，而不是只认一个 ID。

---

## 一、现状盘点（2026-10-21 实测）

| 项 | 现状 |
|---|---|
| `players` 总数 | 161 人 |
| 有 `game_id`（SteamID32） | 91 人（57%） |
| 游戏名 ≠ 群昵称 | 27 人 |
| 完全没有名字 | 0 人 |
| 重复 `game_id` | 0 条（可以安全加唯一约束） |
| `player_aliases` 表 | **已存在，27 行，但零处代码引用**（死数据，可安全改造） |
| `game_id` 使用点 | 36 个文件（头像代理、头像同步、开黑、选手列表、管理后台、补录脚本…） |
| 战绩接口入参 | `/api/player-stats?playerId=<game_id>`，**传的是账号 ID 而不是 players.id**（3 处调用） |

结论：
1. 昵称的「多值」结构半成品已存在（`player_aliases`），但没有编辑入口、没有展示逻辑。
2. 账号的「多值」完全不存在，`players.game_id` 是单值标量。
3. `game_id` 被 36 处引用，**不能直接删**，否则改动面失控。

---

## 二、模型设计

把三个概念拆开，不要继续堆在 `players` 一行里：

```
Player（群友）  1 ──< N  Account（Steam 账号）
                1 ──< N  Alias（名字）
```

### 2.1 新表 `player_accounts`

```sql
CREATE TABLE public.player_accounts (
  id         bigserial PRIMARY KEY,
  player_id  bigint NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  account_id bigint NOT NULL,                       -- SteamID32 = Dota account_id
  label      varchar(40),                           -- 大号 / 小号 / 备用（自由文本）
  is_primary boolean NOT NULL DEFAULT false,        -- 常用号
  source     varchar(60) NOT NULL DEFAULT 'manual', -- manual / import / match
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_accounts_acc_uniq UNIQUE (account_id)
);

-- 每人最多一个常用号：用部分唯一索引，比应用层校验可靠
CREATE UNIQUE INDEX player_accounts_one_primary
  ON public.player_accounts (player_id) WHERE is_primary;

CREATE INDEX player_accounts_pid_idx ON public.player_accounts (player_id);
```

两个约束是关键：
- `UNIQUE (account_id)`：一个账号只能属于一个人，从根上防「两个人都绑了同一小号」。
- `(player_id) WHERE is_primary`：每人只能勾一个常用号，且**不能靠代码保证**——数据库说了算。

### 2.2 改造 `player_aliases`

现有列：`id, player_id, steam_id, alias, alias_type, source, created_at`

| 动作 | 说明 |
|---|---|
| `steam_id` → 重命名 `account_id` | 语义本来就是「这个昵称是哪个号用的」，现在改对 |
| 新增 `is_display boolean` | 该类型下的展示名（列表/赛事页显示哪个名字） |
| 新增部分唯一索引 | `(player_id, alias_type) WHERE is_display` —— 每类只有一个展示名 |
| 规范 `alias_type` | `nickname`（游戏名）/ `group_nickname`（群昵称）/ `captain`（组队表用名）/ `other` |

```sql
ALTER TABLE public.player_aliases RENAME COLUMN steam_id TO account_id;
ALTER TABLE public.player_aliases ADD COLUMN IF NOT EXISTS is_display boolean DEFAULT false;
ALTER TABLE public.player_aliases
  ADD CONSTRAINT player_aliases_account_fk
  FOREIGN KEY (account_id) REFERENCES public.player_accounts(account_id) ON DELETE SET NULL;
CREATE UNIQUE INDEX player_aliases_one_display
  ON public.player_aliases (player_id, alias_type) WHERE is_display;
```

> `account_id` 用**自然键**指向 `player_accounts.account_id`（而不是 surrogate id），
> 这样删掉小号时昵称不会被连带删除，只是解除关联。

### 2.3 兼容层：`players.game_id` 保留为主号镜像

这是本方案最重要的取舍：**不删 `players.game_id`**，改用触发器让它始终等于「常用号」。

```sql
CREATE OR REPLACE FUNCTION public.sync_primary_account() RETURNS trigger AS $$
DECLARE pid bigint := COALESCE(NEW.player_id, OLD.player_id);
BEGIN
  UPDATE public.players SET game_id = (
    SELECT account_id FROM public.player_accounts
     WHERE player_id = pid AND is_primary LIMIT 1
  ) WHERE id = pid;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER player_accounts_sync_primary
AFTER INSERT OR UPDATE OR DELETE ON public.player_accounts
FOR EACH ROW EXECUTE FUNCTION public.sync_primary_account();
```

收益：**36 处既有 `game_id` 调用一行都不用改**，头像代理、头像同步、开黑、选手列表
继续按主号工作；新逻辑（战绩、AI、补录）改用 `player_accounts` 全量。

代价：主号是写入方，`game_id` 是镜像。任何绕过表直接改 `players.game_id` 的地方都要
停止（目前只有管理后台的编辑表单，P1 一并改）。

---

## 三、数据迁移（可回滚、幂等）

```sql
-- 1) 把现有单值 game_id 提升为「常用号」
INSERT INTO public.player_accounts (player_id, account_id, label, is_primary, source)
SELECT id, game_id, '大号', true, 'import'
  FROM public.players WHERE game_id IS NOT NULL
ON CONFLICT (account_id) DO NOTHING;

-- 2) 把 players 上的两个名字补进 aliases（幂等）
INSERT INTO public.player_aliases (player_id, alias, alias_type, is_display, source)
SELECT id, nickname, 'nickname', true, 'import'
  FROM public.players WHERE COALESCE(TRIM(nickname),'') <> ''
ON CONFLICT (player_id, alias) DO NOTHING;

INSERT INTO public.player_aliases (player_id, alias, alias_type, is_display, source)
SELECT id, group_nickname, 'group_nickname', true, 'import'
  FROM public.players WHERE COALESCE(TRIM(group_nickname),'') <> ''
ON CONFLICT (player_id, alias) DO NOTHING;
```

迁移后校验（必须全为 0 才算成功）：

```sql
-- 镜像是否一致
SELECT count(*) FROM players p JOIN player_accounts a ON a.player_id = p.id AND a.is_primary
 WHERE p.game_id IS DISTINCT FROM a.account_id;
-- 是否有人没有常用号却有账号
SELECT count(*) FROM (SELECT player_id FROM player_accounts GROUP BY 1
                      HAVING count(*) FILTER (WHERE is_primary) <> 1) x;
```

回滚：`DROP TRIGGER` → `DELETE FROM player_accounts WHERE source='import'` → 恢复列名。

---

## 四、接口改造

### 4.1 `GET /api/profile` / `PUT /api/profile`

返回与接收都增加两个数组：

```jsonc
{
  "accounts": [
    { "account_id": 140976240, "label": "大号", "is_primary": true },
    { "account_id": 1221403033, "label": "小号", "is_primary": false }
  ],
  "aliases": [
    { "alias": "世涛",   "alias_type": "nickname",       "is_display": true,  "account_id": 140976240 },
    { "alias": "stout", "alias_type": "group_nickname", "is_display": true,  "account_id": null },
    { "alias": "世涛哥","alias_type": "other",           "is_display": false, "account_id": null }
  ]
}
```

`PUT` 在一个事务里做 **diff**（不做全量删再插，否则 id 会漂、外键会断）：

| 变化 | 处理 |
|---|---|
| 新出现的 `account_id` | INSERT |
| 已存在但改了 label / is_primary | UPDATE |
| 不在提交列表里的 | DELETE |

校验规则（后端强制，前端只做提示）：
- `account_id` 必须 5–12 位纯数字；
- 被他人占用 → `409` 并返回占用者昵称，提示「该账号已绑定给 XX」；
- 至少保留一个 `is_primary`，未指定时自动取第一个；
- 昵称去重（同一人同一名字不重复插入），空字符串丢弃。

### 4.2 `GET /api/player-stats` —— 语义纠正 + 多账号聚合

**现在的问题**：调用方传的是 `game_id`（`/api/player-stats?playerId=${player.game_id}`），
把「账号 ID」当成了「选手 ID」。改造后入参语义改为 `players.id`：

```
GET /api/player-stats?playerId=<players.id>
```

服务端流程：
1. 查 `player_accounts` 拿全部 `account_id`（无账号时返回 `{empty:true}`）
2. 并发拉每个账号的 `recentMatches` / `heroes` / `matches?limit=200` / `totals`
3. 合并：
   - `recentMatches`：按 `start_time` 倒序合并后取前 20
   - `heroes`：按 `hero_id` 累加 `matches` / `wins`
   - `totals`：逐字段累加
4. 返回增加 `accounts: [{ account_id, label, matches }]`，让前端能标「含小号数据」

并发用 `Promise.allSettled`：某个小号没公开数据不能拖垮整份统计。

### 4.3 AI 分析

`buildPlayerPrompt` 增加两处：

```
【账号】
- 大号 140976240：近 20 场 12 胜，主玩 中单/优势路
- 小号 1221403033：近 20 场 8 胜，主玩 辅助
以上为两个账号合并后的统计。
```

分账号给摘要而不是只给总数，原因是：**大号和小号的英雄池/位置往往不同**，
混在一起会把「小号练英雄」误判成「这个人的绝活是 XX」。合并统计仍然给，
但要求模型分别观察。

### 4.4 比赛补录脚本（立竿见影的收益）

`scripts/backfill-league.js` 里 `roster` 目前从 `team_players JOIN players` 取单值
`game_id`，只有 91 个账号参与识别。改成读 `player_accounts` 全量：

```sql
SELECT tp.team_id, tp.player_id, COALESCE(p.group_nickname,p.nickname) AS name,
       pa.account_id
  FROM public.team_players tp
  JOIN public.players p ON p.id = tp.player_id
  LEFT JOIN public.player_accounts pa ON pa.player_id = p.id
 WHERE tp.tournament_id = $1
```

一个 `player_id` 会展开成多行，`discoverMatches` 里按 `account_id` 去重即可。
**补一个小号，可能就多识别出几场老比赛** —— 这是多账号最直接的回报。

### 4.5 头像与天梯分

- 头像：主号优先；主号无头像时回退到其它账号（`/api/avatar/[id]` 增加回退链）。
- 天梯分：保持手填。OpenDota 拿不到 MMR，只能拿排名，自动同步不可靠。

---

## 五、个人信息页 UI

原来的三个单值输入框（游戏名 / 群昵称 / SteamID）改成两个可增删列表：

**昵称**
```
[ 世涛          ] [游戏名 ▾]  (•) 展示名   [删除]
[ stout         ] [群昵称 ▾]  (•) 展示名   [删除]
[ 世涛哥        ] [其它   ▾]  ( )          [删除]
+ 添加昵称
```

**Steam 账号**
```
[ 140976240   ] [大号]  (•) 常用号   [删除]
[ 1221403033  ] [小号]  ( )          [删除]
+ 添加账号                    失焦即校验格式与占用
```

保存前前端只做「非空 + 数字格式」提示，唯一性由后端返回错误再标红。

---

## 六、分阶段实施

| 阶段 | 内容 | 风险 | 用户可见变化 |
|---|---|---|---|
| **P0** | 建表 + 迁移 + 触发器 + 校验查询 | 低（不改任何页面） | 无，全站照常 |
| **P1** | `/api/profile` 读写 + 个人信息页两个列表 | 中（表单重写） | 可加多个昵称/账号、勾常用号 |
| **P2** | `/api/player-stats` 多账号聚合 + 3 处调用改入参 + AI prompt | 中（改语义） | 战绩/AI 涵盖小号 |
| **P3** | 补录脚本改用全量账号 + 老赛季重扫 | 低 | 老赛季可能多出比赛 |
| **P4** | 账号被占用的处理（显示占用者 / 申请合并）、管理后台代改 | 中 | 冲突有出路 |

P0 必须先做且独立验证，P1–P3 可以并行。**P0 完成前不要在页面上暴露多账号入口**，
否则会写出没有约束保护的数据。

---

## 七、已确认的决策（2026-10-21）

四个问题已有结论，以下是定稿口径，实施时不再摇摆：

**1. 常用号镜像：保留 `players.game_id`。**
它始终等于 `player_accounts` 里 `is_primary = true` 那一行，由触发器同步。
36 处既有调用（头像代理、头像同步、开黑、选手列表、后台）一行都不改。

**2. 显示名：不做「按类型设展示名」，一律只显示主昵称。**
`player_aliases.is_display` 那一套砍掉——多一个选择只会让同一个人在不同页面
显示不同名字，反而伤辨识度。规则固定：

- 主昵称 = `players.nickname`（历史数据里就是大家认的那个名字）
- `group_nickname` 只在详情页作补充信息，不参与列表/赛事页标题与排序
- `player_aliases` 只用于**搜索命中**和**导入时认人**，不参与展示

**3. 账号被占用：只提示，不做合并申请。**
后端在绑定/保存时校验 `player_accounts.account_id` 唯一性，冲突时返回：

> 该 Steam 账号已被「XXX」绑定。如需修改，请尽快联系 dom 处理。

前端原样展示这句，不提供「申请合并」入口。

**4. 天梯分：继续手填，拆成两个字段。**

- `players.score` —— **当前**天梯分，本人可改（掉分就跟着改）
- `players.peak_score` —— **历史最高**分，本人填写，不随掉分变化

两个字段都允许本人编辑。**不自动取多账号最高分**——OpenDota 拿不到 MMR，
按账号取最高只会造出一个没人维护的数字。

展示口径：详情页主数字是当前分，最高分作次级信息；报名表/队伍表当前分为主，
最高分只在与当前分不同时以「最高 xxxx」小字或 title 出现。

> 注：`peak_score` 字段在第十一届名单导入时已建好（47/161 有值），但页面一直没接。
> 本次补的是读写链路：`/api/profile`、`updatePlayer`、个人信息页、群友详情页、报名表。

---

## 八、名次模型修正：一届可以有多个冠军

**这条影响所有涉及名次的代码，不要再用单值思维。**

现实里一届赛事可能出现：分组决赛各出一个冠军、并列名次、两队同分同胜场。
原来的 `tournaments.champion_team_id / runner_up_team_id / third_place_team_id`
是单值，表达不了。

**定稿：** 新增 `tournament_placements`，一行一个名次。

```sql
CREATE TABLE public.tournament_placements (
  id            serial PRIMARY KEY,
  tournament_id bigint   NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id       bigint   NOT NULL REFERENCES public.teams(id)       ON DELETE CASCADE,
  place         smallint NOT NULL,          -- 1 冠军 / 2 亚军 / 3 季军
  note          varchar(60),                -- 「B 组决赛冠军」这类说明
  created_at    timestamptz DEFAULT now(),
  UNIQUE (tournament_id, team_id, place)
);
```

- 同一个 `(tournament_id, place)` 允许出现多行 —— 这就是并列。
- 单值字段**保留不删**，作为只读兼容层；`placements` 为空时前端回退到它。
- 后台只改单值时（旧 UI），接口会把单值同步进 `placements`，避免两套数据打架。
- `placements` 传了就整份替换该赛事的名次（空数组 = 清空）。
- 展示：Hero 荣誉区按档位竖排，同档多队用 ` / ` 连接；
  队伍表同一队取最好名次出徽标；赛事列表用聚合后的 `champions_text`。

---

