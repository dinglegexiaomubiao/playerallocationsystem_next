/**
 * 帮派配色（前后端共用）。
 *
 * 为什么是固定 12 套、不让帮主自由取色：
 * 群友卡片要用这个色做渐变背景，而卡片上有正文、次要文字和 steamID 三档灰。
 * 自由取色没法保证「日间浅底 + 夜间深底」两种情况下文字都还看得清 ——
 * 有人选一个和 --text-3 同明度的色，那一行就读不出来了。
 *
 * 所以色板固定、透明度固定，并且用 scripts/check-guild-contrast.cjs 验算过：
 * 12 套 × 日夜两种主题，最弱一档文字（--text-3）都 ≥ 4.5:1。
 *
 * 实测边界（不要凭感觉调大）：
 *   alpha=0.12 是全部 12 套都达标的上限
 *   alpha=0.14 时赤红（日间 4.49）、琥珀（夜间 4.40）先掉到 4.5 以下
 *   alpha=0.16 时一半配色不达标
 * 改任何一项都要重跑 npm run guild:contrast。
 */

// 卡片渐变的两端透明度：一端稍重、一端近乎中性，形成 135° 的薄薄一层色。
export const GUILD_ALPHA_START = 0.12;
export const GUILD_ALPHA_END = 0.04;

/**
 * 12 套配色。solid 是实色（左侧竖条 / 徽标 / 色块选择器用），
 * 渐变两端由 solid 按上面的透明度派生 —— 只维护一个色值，不维护两套，
 * 避免「实色改了但渐变没改」这种漂移。
 */
export const GUILD_COLORS = [
  { key: 'crimson', label: '赤红', solid: '#c0392f' },
  { key: 'amber', label: '琥珀', solid: '#b8862f' },
  { key: 'moss', label: '苔绿', solid: '#4d7c4f' },
  { key: 'teal', label: '青碧', solid: '#2f7d78' },
  { key: 'indigo', label: '靛蓝', solid: '#4a5cab' },
  { key: 'plum', label: '梅紫', solid: '#8a4a7d' },
  { key: 'slate', label: '石青', solid: '#4a6275' },
  { key: 'rust', label: '铜褐', solid: '#96603c' },
  { key: 'olive', label: '橄榄', solid: '#6b7a3a' },
  { key: 'rose', label: '玫灰', solid: '#a8556a' },
  { key: 'steel', label: '玄铁', solid: '#5b5f66' },
  { key: 'sea', label: '海松', solid: '#37727a' },
];

export const GUILD_COLOR_KEYS = GUILD_COLORS.map((c) => c.key);

const byKey = new Map(GUILD_COLORS.map((c) => [c.key, c]));

export const isGuildColor = (key) => byKey.has(String(key || ''));

export const guildColor = (key) => byKey.get(String(key || '')) || null;

export const guildColorLabel = (key) => (byKey.get(String(key || '')) || {}).label || '';

// '#c0392f' + 0.12 → 'rgba(192,57,47,0.12)'
export function hexToRgba(hex, alpha) {
  const s = String(hex || '').replace('#', '');
  if (s.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 给卡片用的 CSS 变量。返回 null 表示没有帮派，调用方按原样渲染。
 * 用 CSS 变量而不是直接拼 background，是为了让 hover / 选中态也能复用同一个色。
 */
export function guildCardStyle(colorKey) {
  const c = guildColor(colorKey);
  if (!c) return null;
  return {
    '--guild-a': hexToRgba(c.solid, GUILD_ALPHA_START),
    '--guild-b': hexToRgba(c.solid, GUILD_ALPHA_END),
    '--guild-solid': c.solid,
  };
}
