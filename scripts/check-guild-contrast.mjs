/**
 * 帮派配色的对比度验算（纯数学，不需要浏览器、不需要数据库）。
 *
 * 查什么：每套配色按 GUILD_ALPHA_START 叠在卡片底色上之后，卡片上最弱一档文字
 * （--text-3，日间 #626973 / 夜间 #8b939e）还剩多少对比度。
 *
 * 为什么单独一个脚本：
 * 这个数肉眼看不出区别 —— 4.49 和 4.63 长得一模一样，但一个不过 AA 一个过。
 * 群友卡片的渐变背景是帮主选的色，不能靠眼睛验收。
 *
 * 用法：npm run guild:contrast
 * 退出码 1 表示有配色不达标，此时不要上线，去调 lib/guild-colors.mjs 的透明度。
 */

import { GUILD_COLORS, GUILD_ALPHA_START, GUILD_ALPHA_END } from '../lib/guild-colors.mjs';

const AA = 4.5;

// 取自 styles/tokens.css：卡片底色与三档文字。这里刻意写成常量而不是读 CSS ——
// 脚本要能在没有浏览器的环境里跑，读 CSS 的成本比维护这三行高。
const THEMES = {
  light: { label: '日间', bg: '#ffffff', text: '#15181c', text2: '#4b535b', text3: '#626973' },
  dark: { label: '夜间', bg: '#1c1f24', text: '#eef1f4', text2: '#a8b0ba', text3: '#8b939e' },
};

const hex2rgb = (h) => {
  const s = String(h).replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const lin = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const blend = (base, color, alpha) => base.map((v, i) => Math.round(v * (1 - alpha) + color[i] * alpha));

let fail = 0;

console.log('帮派配色对比度验算');
console.log(`渐变 alpha：起 ${GUILD_ALPHA_START} / 止 ${GUILD_ALPHA_END}，要求 ≥ ${AA}:1\n`);

for (const themeKey of ['light', 'dark']) {
  const t = THEMES[themeKey];
  const bg = hex2rgb(t.bg);
  console.log(`[${t.label}] 卡片底色 ${t.bg}`);

  for (const c of GUILD_COLORS) {
    const rgb = hex2rgb(c.solid);
    // 渐变两端都要算：起点 alpha 更大通常是更坏的情况，但端点也一起验，
    // 防止将来有人改 GUILD_ALPHA_END 之后没意识到会变坏。
    const worst = Math.min(
      ...[GUILD_ALPHA_START, GUILD_ALPHA_END].map((a) => {
        const surface = blend(bg, rgb, a);
        return Math.min(
          ratio(surface, hex2rgb(t.text)),
          ratio(surface, hex2rgb(t.text2)),
          ratio(surface, hex2rgb(t.text3))
        );
      })
    );
    const ok = worst >= AA;
    if (!ok) fail++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.label.padEnd(4)} ${c.key.padEnd(9)} 最弱 ${worst.toFixed(2)}:1`);
  }
  console.log('');
}

if (fail) {
  console.error(`✗ ${fail} 组不达标：把 lib/guild-colors.mjs 的 GUILD_ALPHA_START 调小后重跑`);
  process.exit(1);
}
console.log(`✓ 全部达标（${GUILD_COLORS.length} 套 × 2 主题）`);
