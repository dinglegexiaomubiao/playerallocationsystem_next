#!/usr/bin/env node
/**
 * 文字对比度审计（WCAG AA 4.5:1）
 *
 * 为什么需要：站点是纯深色 UI，浅色主题遗留的硬编码（暗金字、暗蓝灰字、
 * 紫/蓝段位色）在深底上只有 2~3:1，肉眼表现就是「糊成一团、看着费劲」。
 * 靠人眼在截图里找不出来，只能算。
 *
 * 用法：
 *   node scripts/a11y-contrast.cjs                      # 默认测五个主要页面
 *   node scripts/a11y-contrast.cjs /admin /profile      # 指定路径
 *   BASE=http://127.0.0.1:3000 node scripts/...         # 指定站点
 *
 * 判定口径：
 *   - 背景按 DOM 向上逐层合成（容器半透明时算真实合成色），不是简单取父级
 *   - 只统计「自身含文本节点」的元素，避免容器重复计数
 *   - 装饰性字符（如 `·` 分隔符）会出现在结果里但不计入正文口径，自行判断
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const DEFAULT_PAGES = ['/', '/tournaments', '/members'];

const auditFn = () => {
  const parse = (s) => {
    const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:\s*,\s*([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = (c) => 0.2126 * lin(c.r / 255) + 0.7152 * lin(c.g / 255) + 0.0722 * lin(c.b / 255);
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const bgOf = (el) => {
    let cur = el;
    const stack = [];
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 0.99) break;
      }
      cur = cur.parentElement;
    }
    let base = { r: 21, g: 23, b: 26, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };

  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const v = ratio(over(fg, bg), bg);
    if (v < 4.5) {
      out.push({
        cls: (el.className || el.tagName).toString().slice(0, 40),
        text: (el.textContent || '').trim().slice(0, 18),
        ratio: +v.toFixed(2),
        size: cs.fontSize,
        color: cs.color,
      });
    }
  }
  const seen = new Set();
  return out
    .filter((x) => {
      const k = x.cls + x.color + x.size;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.ratio - b.ratio);
};

(async () => {
  const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PAGES;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' });
  let total = 0;
  for (const url of pages) {
    await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(700);
    const rows = await page.evaluate(auditFn);
    total += rows.length;
    console.log(`\n=== ${url}  低于 4.5:1 的文本样式 ${rows.length} 处 ===`);
    for (const r of rows.slice(0, 12)) {
      console.log(`  ${String(r.ratio).padStart(5)}:1  ${r.size.padEnd(7)}  ${r.cls.padEnd(30)} ${r.color.padEnd(26)} ${r.text}`);
    }
  }
  await browser.close();
  console.log(`\n合计 ${total} 处。装饰性字符（· / — ）不计入正文口径。`);
  process.exit(total > 0 ? 0 : 0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
