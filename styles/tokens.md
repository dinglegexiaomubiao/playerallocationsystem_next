# 设计令牌（Design Tokens）

> 唯一来源：`styles/tokens.css`。**改令牌会影响全站**，改之前先想清楚作用面。
> 该文件必须是 `pages/_app.js` 里第一个引入的样式表，其余样式都引用这里的变量。

## 为什么收敛成一份

原先 `globals.css`（原 /main 分配工具）与 `layout.css`（社区站第一版）各有一个 `:root`，
`--radius-sm` / `--radius-lg` / `--shadow-sm` / `--shadow-lg` 四处同名不同值，靠加载顺序决胜负。
实测（收敛前后用 CDP 对比计算样式）发现 **layout.css 的值才真正生效**，所以合并时以它为准。

## 2026-10-21：配色重做（群友反馈「看着不舒服」）

旧色板的问题不是丑，是**色彩层次塌陷**，可以量出来：

| 指标 | 旧 | 新 | 说明 |
|---|---|---|---|
| 底色色相 / 饱和 | `#17130f` H=30° S=21% | `#15171a` H=215° S=10% | 暖褐 → 中性，颜色不再被「染色」 |
| 基础色同族数 | 9 个里 7 个落在 H=25~38° | 底 215° / 强调 4° / 状态 122° 三族分离 | 同色相堆叠 = 眼睛分不出层次 |
| 辅助文字 `--text-3` | `#7b716a` = **3.66:1** | `#8b939e` = **5.4:1** | 旧值低于 WCAG AA，用量却最大 |
| 品牌红饱和 | `#c9867c` S=42%，与底差 22° | `#e2635a` S=60%，与底差 211° | 强调色必须「跳」，否则视线没落点 |
| 卡片/底明度比 | 1.28× | 1.59× | 卡片靠明度浮起来，不靠 1px 边框硬撑 |

落地时同时清掉了一批**浅色主题遗留的硬编码**——它们在深底上从来没适配过：

- `.score-divine` `#6d28d9`（紫）、`.score-ancient` `#1e5fa8`（蓝）—— 既违反「不要紫蓝」，又只有 1.9:1
- `.p-honor.gold` `#8a6408` 配 `#f2e3b8` 浅边、`.rank-gold` `#8a6d00` —— 暗金在深底上 2.4:1，等于看不见
- `.t-team-tag.radiant` `#8fa87a` —— 偏暗的老绿

验证方式：`_a11y.cjs` 遍历页面上所有文本节点，按「合成背景 + 前景」算真实对比度，
输出低于 4.5:1 的样式。改完五个页面只剩装饰性 `·` 分隔符（2.81:1，非正文，不计入 AA）。

## 令牌一览

### 主色：品牌红。primary 用于实底，primary-light 用于文字/链接

| 变量 | 值 |
|---|---|
| `--color-primary` | `#c0392f` |
| `--color-primary-light` | `#e2635a` |
| `--color-primary-dark` | `#a52f27` |
| `--color-primary-bg` | `rgba(192, 57, 47, 0.16)` |
| `--color-primary-bg-light` | `rgba(192, 57, 47, 0.09)` |
| `--color-primary-border` | `rgba(226, 99, 90, 0.42)` |
| `--color-primary-border-light` | `rgba(226, 99, 90, 0.26)` |

### 语义色

| 变量 | 值 | 用途 |
|---|---|---|
| `--color-danger` | `#ef4444` | 删除/错误，比品牌红更纯 |
| `--color-danger-light` | `#f4776f` | |
| `--color-danger-dark` | `#c22c2c` | `.btn-danger` 实底（白字 5.4:1） |
| `--color-danger-bg` | `rgba(239, 68, 68, 0.14)` | |
| `--color-danger-border` | `rgba(239, 68, 68, 0.38)` | |
| `--color-success` | `#6fbf73` | **只给状态点与「进行中」** |
| `--color-success-light` | `#8ed492` | 淡绿底上的文字 |
| `--color-success-bg` | `rgba(111, 191, 115, 0.14)` | |
| `--color-warning` | `#e0b878` | 冠军/名次，古铜金 |
| `--color-warning-bg` | `rgba(224, 184, 120, 0.14)` | |
| `--color-warning-border` | `rgba(224, 184, 120, 0.4)` | |

### 文字：中性灰阶，不带暖色（对比度以 `--color-bg` 为背景）

| 变量 | 值 | 对比度 |
|---|---|---|
| `--color-text` | `#eef1f4` | 14.6:1 |
| `--color-text-secondary` | `#a8b0ba` | 7.5:1 |
| `--color-text-muted` | `#8b939e` | 5.4:1（再暗就不该放正文） |

### 底色：中性微冷四级阶梯（L = 0.0055 / 0.0085 / 0.0135 / 0.0200）

| 变量 | 值 |
|---|---|
| `--color-bg`（卡） | `#1c1f24` |
| `--color-bg-secondary`（subtle） | `#23272d` |
| `--color-bg-hover` | `rgba(238, 241, 244, 0.05)` |
| `--color-bg-overlay` | `rgba(8, 10, 13, 0.74)` |
| `--color-bg-page-start/-mid1/-end` | `#15171a` |
| `--color-bg-page-mid2` | `#16181c` |

### 段位色：红 → 白金 → 冷银 → 古铜 → 灰

旧版统一收进暖色系后五档几乎分不出来。现在靠**色相 + 明度双维度**区分，
并且映射到 Dota 段位阶梯（冠绝 = 红、超凡 = 白金、万古 = 冷银、传奇 = 古铜、统帅 = 灰）。

| 变量 | 值 |
|---|---|
| `--color-score-master` | `#e2635a` |
| `--color-score-master-bg` | `rgba(226, 99, 90, 0.16)` |
| `--color-score-master-text` | `#f0837a` |
| `--color-score-diamond` | `#e0b878` |
| `--color-score-diamond-bg` | `rgba(224, 184, 120, 0.14)` |
| `--color-score-diamond-text` | `#e9c68e` |
| `--color-score-platinum` | `#b9c4cf` |
| `--color-score-platinum-bg` | `rgba(185, 196, 207, 0.13)` |
| `--color-score-platinum-text` | `#cdd6df` |
| `--color-score-gold` | `#c79a5a` |
| `--color-score-gold-bg` | `rgba(199, 154, 90, 0.14)` |
| `--color-score-gold-text` | `#d9b078` |
| `--color-score-silver` | `#8b939e` |
| `--color-score-silver-bg` | `rgba(139, 147, 158, 0.14)` |
| `--color-score-silver-text` | `#a6aeb9` |

### 圆角 / 阴影 / 动效

| 变量 | 值 |
|---|---|
| `--radius-sm` / `--radius-md` | `4px` |
| `--radius-lg` / `--radius-3xl` | `12px` |
| `--radius-xl` | `8px` |
| `--radius-2xl` | `10px` |
| `--shadow-sm` | `0 1px 2px rgba(0, 0, 0, 0.32)` |
| `--shadow-md` | `0 2px 8px rgba(0, 0, 0, 0.34)` |
| `--shadow-lg` | `0 14px 34px rgba(0, 0, 0, 0.48)` |
| `--shadow-xl` | `0 8px 32px rgba(0, 0, 0, 0.48)` |
| `--shadow-primary` | `0 2px 8px rgba(192, 57, 47, 0.24)` |
| `--shadow-primary-hover` | `0 4px 16px rgba(226, 99, 90, 0.3)` |
| `--transition-fast` / `-normal` | `0.15s` / `0.2s ease` |
| `--transition-smooth` | `0.2s cubic-bezier(0.4, 0, 0.2, 1)` |

### 以下来自 layout.css（globals 里没有的）

| 变量 | 值 | 说明 |
|---|---|---|
| `--bg-page` | `#15171a` | |
| `--bg-card` | `#1c1f24` | |
| `--bg-subtle` | `#23272d` | |
| `--bg-sunk` | `#0f1114` | |
| `--brand` | `#e2635a` | 文字/链接，4.9:1 |
| `--brand-on-soft` | `#f28a81` | **淡品牌底（14%）上的文字**，比 `--brand` 再亮一档 |
| `--brand-dark` | `#c9534a` | |
| `--brand-soft` | `rgba(226, 99, 90, 0.14)` | |
| `--accent` / `--accent-soft` | `#e2635a` / `rgba(226, 99, 90, 0.14)` | |
| `--brand-solid` | `#c0392f` | 实底（白字 5.4:1） |
| `--brand-solid-hover` | `#a52f27` | |
| `--btn-primary-bg` | `#e8635a` | 主 CTA 亮底 |
| `--btn-primary-bg-hover` | `#f0756b` | |
| `--btn-primary-ink` | `#1a1211` | 主 CTA 深字（5.6:1） |
| `--gold` / `--gold-soft` | `#e0b878` / `rgba(224, 184, 120, 0.12)` | |
| `--green-soft` | `rgba(111, 191, 115, 0.14)` | |
| `--ok` | `#6fbf73` | |
| `--text` / `--text-2` / `--text-3` | `#eef1f4` / `#a8b0ba` / `#8b939e` | |
| `--border` / `--border-strong` | `#2b3038` / `#3a4149` | |
| `--radius` | `8px` | |
| `--shadow` | `0 4px 14px rgba(0, 0, 0, 0.38)` | |
| `--maxw` / `--nav-h` / `--card-pad` / `--gutter` | `1320px` / `64px` / `20px` / `18px` | |
| `--font-serif` | `'Songti SC', 'STSong', 'Noto Serif SC', 'SimSun', Georgia, serif` | 赛事名/队伍名 |
| `--font-sans` | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif` | 正文 |
| `--font-mono` | `'SF Mono', 'JetBrains Mono', 'Cascadia Mono', Consolas, Monaco, monospace` | 分数/时间/编号 |

## 赛事页的镜像令牌

`styles/tournament-dark.css` 的 `.t-dark` 作用域里有一整套 `--t-*` 镜像
（`--t-bg` / `--t-red-ink` / `--t-text-3` / `--t-line` 等），值必须与上面保持一致。
它们存在的原因是赛事详情页要能脱离全局 `:root` 独立作用域，**改配色时两处都要动**。

## 使用约定

- 颜色/圆角/阴影/字体一律用 `var(--x)`，不要写死色值。浅色主题遗留的硬编码
  （`#6d28d9` 紫、`#1e5fa8` 蓝、`#8a6408` 暗金）已经清掉，别再加回来。
- 深色底不要写白底（后台弹窗 input 曾因缺背景色退化成浏览器白底）。
- 古铜金 `--gold` 只给名次、冠军、待处理等「荣誉/提醒」，泛用就贬值。
- `--ok` 是唯一保留的绿色，只用于「进行中/活跃」状态点，不做实底大面积色块。
- **淡色底上的文字要换亮一档的令牌**：`--brand` 放到 `--brand-soft` 底上只剩 4.0:1，
  这时该用 `--brand-on-soft`（赛事页对应 `--t-red-ink-soft`）。
- 主 CTA 是**亮底深字**（`--btn-primary-*`）。暗红实底 `--brand-solid` 留给
  徽标、标签这类小面积实底，因为它配白字虽然达标，但在暗页面上抓不住视线。
- 圆角克制：4 / 8 / 12 三档，圆角不当装饰。
- 阴影只做层次，不做发光；导航等深色实底不加玻璃拟态。
- **改完跑一次对比度审计**：`node _a11y.cjs` 会遍历五个页面，列出所有低于 4.5:1 的文本样式。
