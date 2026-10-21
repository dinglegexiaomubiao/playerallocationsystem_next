#!/usr/bin/env node
/**
 * 双主题端到端自检。
 *
 * 覆盖的是「肉眼看不出来但一定会坏」的几处：
 *   1. 默认是不是夜间（不挂 data-theme）
 *   2. 点一下能不能变日间、localStorage 有没有记
 *   3. 刷新后是否保持，且首屏就是对的（防闪烁）
 *   4. 再点能否回夜间
 *   5. 窄屏时导航里的按钮藏起来、抽屉里的在
 *   6. 不套导航的登录页有没有浮动按钮、能不能切
 *   7. color-scheme / theme-color 有没有跟着变
 *
 * 用法：BASE=http://127.0.0.1:3000 npm run theme:check
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
let failed = 0;
const ok = (cond, msg, detail = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${detail ? '   ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' });
  const page = await ctx.newPage();

  const state = () =>
    page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      ls: localStorage.getItem('laroja-theme'),
      bg: getComputedStyle(document.body).backgroundColor,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      meta: document.querySelector('meta[name="theme-color"]')?.content,
      label: document.querySelector('.theme-toggle')?.getAttribute('aria-label'),
    }));

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const s0 = await state();
  ok(s0.attr === null && s0.ls === null, '默认是夜间（不挂 data-theme）', `bg=${s0.bg} scheme=${s0.scheme}`);

  await page.click('.theme-toggle');
  await page.waitForTimeout(400);
  const s1 = await state();
  ok(s1.attr === 'light' && s1.ls === 'light', '点击切换到日间并写入 localStorage', `bg=${s1.bg}`);
  ok(s1.scheme === 'light', 'color-scheme 跟随', `scheme=${s1.scheme}`);
  ok(s1.meta === '#f5f6f8', 'meta theme-color 跟随', `content=${s1.meta}`);
  ok(/夜间/.test(s1.label || ''), '按钮文案变成「切换到夜间」', `label=${s1.label}`);

  await page.reload({ waitUntil: 'networkidle' });
  const s2 = await state();
  ok(s2.attr === 'light', '刷新后保持日间（首屏即浅色，无闪白）', `attr=${s2.attr}`);

  await page.click('.theme-toggle');
  await page.waitForTimeout(400);
  const s3 = await state();
  ok(s3.attr === null && s3.ls === 'dark', '再点回夜间', `bg=${s3.bg}`);

  // 窄屏：导航里的藏起来，抽屉里的在
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  const mp = await m.newPage();
  await mp.goto(BASE + '/', { waitUntil: 'networkidle' });
  const hidden = await mp.evaluate(() => {
    const el = document.querySelector('.nav-right .theme-toggle');
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    // 父级 display:none 时子元素自身 display 仍是 inline-flex，只能看盒子
    return r.width === 0 && r.height === 0 ? 'hidden' : 'visible';
  });
  ok(hidden === 'hidden', '窄屏导航里的按钮收起', `state=${hidden}`);

  await mp.click('.nav-toggle');
  await mp.waitForTimeout(300);
  const drawer = await mp.evaluate(() => {
    const el = document.querySelector('.nav-drawer-actions .theme-toggle');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), label: el.querySelector('.theme-toggle-label')?.textContent };
  });
  ok(!!drawer && drawer.w > 0, '抽屉里有可点的切换按钮', drawer ? `宽=${drawer.w} 文案=${drawer.label}` : '');
  await m.close();

  // 登录页（不套导航）
  const lp = await ctx.newPage();
  await lp.goto(BASE + '/login', { waitUntil: 'networkidle' });
  const floating = await lp.evaluate(() => {
    const el = document.querySelector('.theme-toggle-floating .theme-toggle');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), right: Math.round(window.innerWidth - r.right), w: Math.round(r.width) };
  });
  ok(!!floating && floating.w > 0 && floating.top < 60, '登录页右上角有浮动切换', floating ? `top=${floating.top} 距右=${floating.right}` : '');
  if (floating) {
    await lp.click('.theme-toggle-floating .theme-toggle');
    await lp.waitForTimeout(400);
    const ls = await lp.evaluate(() => document.documentElement.getAttribute('data-theme'));
    ok(ls === 'light', '登录页点一下即可切换到日间', `attr=${ls}`);
  }

  await browser.close();
  console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}`);
  process.exit(failed === 0 ? 0 : 1);
})();
