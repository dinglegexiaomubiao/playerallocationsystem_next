#!/usr/bin/env node
/**
 * 赛事对局编号 → OpenDota 外链自检。
 *
 * 为什么值得单独跑：这是个低调的小链接（灰色 + 点线下划线），
 * 容易被后面的样式改动吃掉（比如 meta 的 `span + span` 分隔规则、
 * 或者窄屏下整行被压成竖排），肉眼看截图未必发现。
 *
 * 用法：
 *   node scripts/check-match-ext.cjs                       # 打线上
 *   BASE=http://127.0.0.1:3000 node scripts/check-match-ext.cjs
 *   TID=16 node scripts/check-match-ext.cjs                # 指定赛事
 */
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'https://dota.playerallocationsystem.online';
const TID = process.env.TID || '16';
const SHOTS = path.resolve(__dirname, '../shots');

(async () => {
  const browser = await chromium.launch();
  let fail = 0;
  const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + '/tournaments/' + TID, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.t-fixture', { timeout: 30000 });

  const links = await page.$$eval('.t-ext', (els) =>
    els.map((a) => ({
      text: a.textContent.trim(),
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
    }))
  );
  ok(links.length > 0, `找到 ${links.length} 个对局外链`);
  ok(links.every((l) => /^https:\/\/www\.opendota\.com\/matches\/\d{9,12}$/.test(l.href)), 'href 指向 opendota matches');
  ok(links.every((l) => l.target === '_blank' && /noreferrer/.test(l.rel || '')), '新窗口 + noreferrer');
  const arrow = await page.$eval('.t-ext', (a) => getComputedStyle(a, '::after').content);
  ok(/↗/.test(arrow), '↗ 伪元素图标: ' + arrow);

  const dots = await page.$$eval('.t-fixture-meta > span', (els) => els.map((el) => getComputedStyle(el, '::before').content));
  const fx = await page.$$eval('.t-fixture', (els) => els.length);
  const dotted = dots.filter((c) => c && c.indexOf('·') >= 0).length;
  ok(dotted === fx * 2, 'meta 的 · 分隔符: ' + dotted + ' 个 / 预期 ' + fx * 2 + '（' + fx + ' 局 × 2）');

  const before = await page.$eval('.t-ext', (a) => getComputedStyle(a).color);
  await page.hover('.t-ext');
  await page.waitForTimeout(250);
  const after = await page.$eval('.t-ext', (a) => getComputedStyle(a).color);
  ok(before !== after, `hover 变色 ${before} → ${after}`);

  const bb = await page.$eval('.t-ext', (a) => a.getBoundingClientRect().height);
  ok(bb > 8 && bb < 26, `点击区域高度 ${bb.toFixed(1)}px`);

  await page.screenshot({ path: SHOTS + '/match-ext-desktop.png', clip: { x: 0, y: 0, width: 1440, height: 760 } });

  const box = await page.$eval('.t-fixture-head', (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 8), width: Math.min(1100, r.width + 20), height: r.height + 16 };
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await page.screenshot({ path: SHOTS + '/match-ext-idle.png', clip: box });
  await page.hover('.t-ext');
  await page.waitForTimeout(250);
  await page.screenshot({ path: SHOTS + '/match-ext-hover.png', clip: box });

  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.goto(BASE + '/tournaments/' + TID, { waitUntil: 'networkidle', timeout: 60000 });
  await mp.waitForSelector('.t-fixture', { timeout: 30000 });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 0, `手机端无横向溢出（差 ${overflow}px）`);
  await mp.screenshot({ path: SHOTS + '/match-ext-mobile.png' });

  /* 日间主题：编号常态是「继承 meta 的灰」，浅底上能不能看清必须单独验，
     不然夜间调好的低调配色到了白底就变成一坨浅灰。 */
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  const contrast = await page.evaluate(() => {
    const a = document.querySelector('.t-ext');
    const host = a.closest('.t-dark') || document.body;
    const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || [0, 0, 0]).map(Number);
    const lum = (c) => {
      const [r, g, b] = c.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const fg = rgb(getComputedStyle(a).color);
    const bg = rgb(getComputedStyle(host).backgroundColor);
    const l1 = lum(fg);
    const l2 = lum(bg);
    return {
      fg: getComputedStyle(a).color,
      bg: getComputedStyle(host).backgroundColor,
      ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
    };
  });
  ok(contrast.ratio >= 4.5, `日间主题对比度 ${contrast.ratio.toFixed(2)}:1（${contrast.fg} on ${contrast.bg}）`);
  await page.screenshot({ path: SHOTS + '/match-ext-light.png', clip: box });

  const real = errs.filter((e) => !/hmr|WebSocket/i.test(e));
  ok(real.length === 0, 'console 无报错' + (real.length ? ': ' + real[0] : ''));

  await browser.close();
  console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项失败`);
  process.exit(fail === 0 ? 0 : 1);
})();
