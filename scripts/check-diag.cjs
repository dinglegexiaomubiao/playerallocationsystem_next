/**
 * 打开线上 /diag，等它把检查跑完，把结论打到终端并截图存档。
 *
 * 用途：手机端报「页面能开、数据全无」时，先在自己电脑上跑一遍，
 * 确认诊断页本身是好的；再把链接发给用户，让他手机打开截图。
 *
 * 用法：
 *   node scripts/check-diag.cjs                     # 线上
 *   BASE=http://127.0.0.1:3000 node scripts/check-diag.cjs
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'https://dota.playerallocationsystem.online';
const OUT = path.join(process.cwd(), 'shots');

(async () => {
  const browser = await chromium.launch();
  // 用 iPhone 视口，尽量贴近出问题的环境
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  console.log(`打开 ${BASE}/diag …`);
  await page.goto(`${BASE}/diag`, { waitUntil: 'load', timeout: 60000 });

  // 结论区块出现（或超时）就算跑完
  await page
    .waitForFunction(
      () => {
        const el = document.getElementById('dg-state');
        return el && /结论/.test(el.textContent || '');
      },
      { timeout: 45000 }
    )
    .catch(() => console.log('⚠ 等结论超时，按当前状态输出'));

  const state = await page.evaluate(() => {
    const s = document.getElementById('dg-state');
    const l = document.getElementById('dg-list');
    return { verdict: s ? s.innerText : '(无)', items: l ? l.innerText : '(无)' };
  });

  console.log('\n===== 逐项 =====');
  console.log(state.items || '(空)');
  console.log('\n===== 结论 =====');
  console.log(state.verdict || '(空)');

  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const shot = path.join(OUT, 'diag.png');
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`\n截图：${shot}`);

  if (consoleErrors.length) {
    console.log('\n页面报错：');
    consoleErrors.slice(0, 10).forEach((e) => console.log('  ' + e));
  }

  await browser.close();
})();
