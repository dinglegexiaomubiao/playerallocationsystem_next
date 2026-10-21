/**
 * 验证「旧页面自愈」：模拟一个引用了已失效资源的页面，确认 _document 里的
 * 内联脚本会把页面重新拉一遍。
 *
 * 真实故障长这样：手机缓存着旧 HTML → 部署后 _next/static/<旧buildId>/*.js
 * 变成 404 → React 起不来 → 页面只剩骨架、一条数据都没有。
 * 这里故意插一个 404 的 script，等价于那个场景。
 *
 * 用法：node scripts/check-selfheal.cjs [BASE]
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || process.argv[2] || 'https://dota.playerallocationsystem.online';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(); // 每次全新 context，sessionStorage 干净
  const page = await ctx.newPage();

  let navigations = 0;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations += 1;
  });

  console.log(`打开 ${BASE}/members …`);
  await page.goto(`${BASE}/members`, { waitUntil: 'load', timeout: 60000 });
  const before = navigations;

  console.log('注入一个指向不存在资源的 <script>（等价于旧 HTML 引用旧 chunk）…');
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.src = '/_next/static/BUILDIDTHATNEVEREXISTED/chunk.js';
    document.head.appendChild(s);
  });

  // 自愈是同步触发 reload，给 4 秒足够看出结果
  await page.waitForTimeout(4000);

  const after = navigations;
  const reloaded = after > before;

  // 再注入一次，验证 60 秒节流生效（不应该再次刷新）
  await page
    .evaluate(() => {
      const s = document.createElement('script');
      s.src = '/_next/static/ANOTHERMISSING/chunk.js';
      document.head.appendChild(s);
    })
    .catch(() => {});
  await page.waitForTimeout(2500);
  const afterSecond = navigations;

  console.log('');
  console.log(`第一次注入后导航次数：${before} → ${after}  ${reloaded ? '✅ 触发了自愈' : '❌ 没有反应'}`);
  console.log(`第二次注入后导航次数：${after} → ${afterSecond}  ${afterSecond === after ? '✅ 节流生效（未重复刷新）' : '❌ 又刷了一次'}`);

  await browser.close();
  if (!reloaded) process.exit(1);
})();
