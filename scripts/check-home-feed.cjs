/**
 * 首页「最近动态」栏检查。
 *
 * 这一块是首页唯一「跨模块聚合」的区域（赛程/活动/开黑/群友/美食/功能更新），
 * 任何一类查询写错都可能让它整块消失或只剩一类，所以单独验：
 * 有内容、分类覆盖、每行结构完整、能点、手机端不溢出。
 *
 * 用法：BASE=https://dota.playerallocationsystem.online node scripts/check-home-feed.cjs
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
const SHOT_DIR = process.env.SHOT_DIR || 'shots';

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let fail = 0;

  const ok = (cond, msg, extra = '') => {
    console.log((cond ? '  ok   ' : '  FAIL ') + msg + (extra ? '  (' + extra + ')' : ''));
    if (!cond) fail++;
  };

  // 接口层先看一眼：有没有查询失败、分类计数是否合理
  const api = await fetch(`${BASE}/api/feed`).then((r) => r.json());
  ok(api.success === true, '接口返回 success');
  ok(!api.failed, '没有查询失败的分类', api.failed ? JSON.stringify(api.failed) : '');
  const counts = api.counts || {};
  const kindsWithData = Object.keys(counts).filter((k) => counts[k] > 0);
  ok(kindsWithData.length >= 2, '至少两类有数据', kindsWithData.join('/') + ' 共 ' + (api.total || 0) + ' 条');

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|_next\/static|WebSocket/i.test(t)) return;
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);

  ok((await page.locator('.home-hero-feed').count()) === 1, 'Hero 里有「最近动态」栏');

  const rows = await page.locator('.home-hero-feed-row').count();
  ok(rows > 0, '动态列表有内容', rows + ' 行');

  const tags = await page.$$eval('.home-feed-tag', (els) =>
    [...new Set(els.map((e) => e.textContent.trim()))]
  );
  ok(tags.length >= 2, '至少两种分类标签', tags.join('/'));

  const titles = await page.$$eval('.home-hero-feed-title', (els) =>
    els.map((e) => e.textContent.trim()).filter(Boolean)
  );
  ok(titles.length === rows, '每行都有标题', titles.length + '/' + rows);

  const times = await page.$$eval('.home-hero-feed-at', (els) => els.map((e) => e.textContent.trim()));
  ok(times.every((t) => t.length > 0), '每行都有时间', '样例 ' + (times[0] || ''));

  // 点第一行应该跳到对应页面（href 不是空壳）
  const firstHref = await page.$eval('.home-hero-feed-row', (a) => a.getAttribute('href'));
  ok(!!firstHref && firstHref !== '/' , '首行带跳转链接', firstHref || '无');

  await page.screenshot({ path: `${SHOT_DIR}/home-feed-desktop.png`, clip: { x: 0, y: 0, width: 1440, height: 1000 } });

  // 手机端
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mp = await mctx.newPage();
  await mp.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await mp.waitForTimeout(1200);
  const overflow = await mp.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  ok(overflow <= 0, '手机端无横向溢出', overflow + 'px');
  ok((await mp.locator('.home-hero-feed-row').count()) > 0, '手机端动态栏也在');
  await mp.screenshot({ path: `${SHOT_DIR}/home-feed-mobile.png` });

  ok(errors.length === 0, 'console 无报错', errors.slice(0, 2).join(' | '));

  console.log('\n' + (fail ? `失败 ${fail} 项` : '全部通过'));
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
