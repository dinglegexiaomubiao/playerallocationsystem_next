# 设计令牌（Design Tokens）

> 唯一来源：`styles/tokens.css`。**改令牌会影响全站**，改之前先想清楚作用面。
> 该文件必须是 `pages/_app.js` 里第一个引入的样式表，其余样式都引用这里的变量。

## 为什么收敛成一份

原先 `globals.css`（原 /main 分配工具）与 `layout.css`（社区站第一版）各有一个 `:root`，
`--radius-sm` / `--radius-lg` / `--shadow-sm` / `--shadow-lg` 四处同名不同值，靠加载顺序决胜负。
实测（收敛前后用 CDP 对比计算样式）发现 **layout.css 的值才真正生效**，所以合并时以它为准。

## 令牌一览

### 主色：低饱和深红。primary 用于实底，primary-light 用于文字/链接

| 变量 | 值 |
|---|---|
| `--color-primary` | `#8e3a35` |
| `--color-primary-light` | `#c9867c` |
| `--color-primary-dark` | `#6d2b27` |
| `--color-primary-bg` | `rgba(142, 58, 53, 0.14)` |
| `--color-primary-bg-light` | `rgba(142, 58, 53, 0.08)` |
| `--color-primary-border` | `rgba(142, 58, 53, 0.42)` |
| `--color-primary-border-light` | `rgba(142, 58, 53, 0.26)` |

### 危险色：比品牌红更亮一档，避免和品牌色混淆

| 变量 | 值 |
|---|---|
| `--color-danger` | `#d05044` |
| `--color-danger-light` | `#e07a6f` |
| `--color-danger-dark` | `#a83a31` |
| `--color-danger-bg` | `rgba(208, 80, 68, 0.14)` |
| `--color-danger-border` | `rgba(208, 80, 68, 0.38)` |
| `--color-success` | `#93a87e` |
| `--color-success-light` | `#a9bd95` |
| `--color-success-bg` | `rgba(147, 168, 126, 0.14)` |
| `--color-warning` | `#d6b47b` |
| `--color-warning-bg` | `rgba(176, 141, 87, 0.14)` |
| `--color-warning-border` | `rgba(176, 141, 87, 0.4)` |
| `--color-text` | `#f0eae2` |
| `--color-text-secondary` | `#ada298` |
| `--color-text-muted` | `#7b716a` |
| `--color-text-dark` | `#f0eae2` |
| `--color-text-body` | `#ada298` |
| `--color-bg` | `#1e1915` |
| `--color-bg-secondary` | `#221c17` |
| `--color-bg-hover` | `rgba(240, 232, 220, 0.04)` |
| `--color-bg-overlay` | `rgba(10, 8, 6, 0.72)` |
| `--color-bg-page-start` | `#17130f` |
| `--color-bg-page-mid1` | `#17130f` |
| `--color-bg-page-mid2` | `#18140f` |
| `--color-bg-page-end` | `#17130f` |

### 段位色：原先是一套蓝/紫/绿，与「不要紫蓝」冲突，统一收进暖色系

| 变量 | 值 |
|---|---|
| `--color-score-master` | `#c9867c` |
| `--color-score-master-bg` | `rgba(142, 58, 53, 0.16)` |
| `--color-score-master-text` | `#d99a90` |
| `--color-score-diamond` | `#b08d57` |
| `--color-score-diamond-bg` | `rgba(176, 141, 87, 0.14)` |
| `--color-score-diamond-text` | `#d6b47b` |
| `--color-score-platinum` | `#9d9287` |
| `--color-score-platinum-bg` | `rgba(157, 146, 135, 0.13)` |
| `--color-score-platinum-text` | `#c0b5a8` |
| `--color-score-gold` | `#93a87e` |
| `--color-score-gold-bg` | `rgba(147, 168, 126, 0.14)` |
| `--color-score-gold-text` | `#a9bd95` |
| `--color-score-silver` | `#7b716a` |
| `--color-score-silver-bg` | `rgba(123, 113, 106, 0.14)` |
| `--color-score-silver-text` | `#a49a92` |
| `--radius-sm` | `4px` |
| `--radius-md` | `4px` |
| `--radius-lg` | `12px` |
| `--radius-xl` | `8px` |
| `--radius-2xl` | `10px` |
| `--radius-3xl` | `12px` |
| `--shadow-sm` | `0 1px 2px rgba(0, 0, 0, 0.3)` |
| `--shadow-md` | `0 2px 8px rgba(0, 0, 0, 0.32)` |
| `--shadow-lg` | `0 14px 34px rgba(0, 0, 0, 0.45)` |
| `--shadow-xl` | `0 8px 32px rgba(0, 0, 0, 0.45)` |
| `--shadow-primary` | `0 2px 8px rgba(142, 58, 53, 0.24)` |
| `--shadow-primary-hover` | `0 4px 16px rgba(142, 58, 53, 0.34)` |
| `--transition-fast` | `0.15s ease` |
| `--transition-normal` | `0.2s ease` |
| `--transition-smooth` | `0.2s cubic-bezier(0.4, 0, 0.2, 1)` |

### 以下来自 layout.css（globals 里没有的）

| 变量 | 值 |
|---|---|
| `--bg-page` | `#17130f` |
| `--bg-card` | `#1e1915` |
| `--bg-subtle` | `#221c17` |
| `--bg-sunk` | `#12100c` |
| `--brand` | `#c9867c` |
| `--brand-dark` | `#b8776e` |
| `--brand-soft` | `rgba(142, 58, 53, 0.16)` |
| `--accent` | `#c9867c` |
| `--accent-soft` | `rgba(142, 58, 53, 0.14)` |
| `--brand-solid` | `#8e3a35` |
| `--brand-solid-hover` | `#6d2b27` |
| `--gold` | `#d6b47b` |
| `--gold-soft` | `rgba(176, 141, 87, 0.12)` |
| `--green-soft` | `rgba(147, 168, 126, 0.14)` |
| `--ok` | `#93a87e` |
| `--text` | `#f0eae2` |
| `--text-2` | `#ada298` |
| `--text-3` | `#7b716a` |
| `--border` | `#352d26` |
| `--border-strong` | `#4a3f36` |
| `--radius` | `8px` |
| `--shadow` | `0 4px 14px rgba(0, 0, 0, 0.35)` |
| `--maxw` | `1320px` |
| `--nav-h` | `64px` |
| `--card-pad` | `20px` |
| `--gutter` | `18px` |
| `--font-serif` | `'Songti SC', 'STSong', 'Noto Serif SC', 'SimSun', Georgia, serif` |
| `--font-sans` | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif` |
| `--font-mono` | `'SF Mono', 'JetBrains Mono', 'Cascadia Mono', Consolas, Monaco, monospace` |

## 使用约定

- 颜色/圆角/阴影/字体一律用 `var(--x)`，不要写死色值。
- 深色底不要写白底（后台弹窗 input 曾因缺背景色退化成浏览器白底）。
- 古铜金 `--gold` 只给名次、冠军、待处理等「荣誉/提醒」，泛用就贬值。
- `--ok` 是唯一保留的绿色，只用于「进行中/活跃」状态点。
- 圆角克制：4 / 8 / 12 三档，圆角不当装饰。
- 阴影只做层次，不做发光；导航等深色实底不加玻璃拟态。
