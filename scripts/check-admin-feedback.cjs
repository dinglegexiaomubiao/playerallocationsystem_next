/**
 * 检查后台「群友反馈」面板是否真的渲染出来。
 *
 * 为什么需要它：/admin 是 getServerSideProps + 客户端 useSession 的页面，
 * SSR 出去的 HTML 只有一句「加载中…」，所以 curl 抓页面文本永远看不到
 * adm-bar / adm-fb 这些结构 —— 实测容易误判成「没部署成功」。
 * 必须用浏览器跑完客户端渲染才准。
 *
 * 用法：
 *   COOKIE='dd_session=xxx.yyy' node scripts/check-admin-feedback.cjs
 *   COOKIE=... BASE=http://127.0.0.1:3000 node scripts/check-admin-feedback.cjs
 *
 * cookie 怎么来：用服务器 .env.local 里的 AUTH_SECRET 按 lib/auth.js 的规则签一个，
 * 见 README「后台自检」。
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'https://dota.playerallocationsystem.online';
const COOKIE = process.env.COOKIE || '';
const OUT = path.join(process.cwd(), 'shots');

if (!COOKIE) {
  console.error('缺少 COOKIE 环境变量，例：COOKIE="dd_session=xxx.yyy" node scripts/check-admin-feedback.cjs');
  process.exit(1);
}

const host = new URL(BASE).hostname;

function toCookies(raw) {
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf('=');
      return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: host, path: '/' };
    });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies(toCookies(COOKIE));
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  console.log('打开 ' + BASE + '/admin …');
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle', timeout: 45000 });

  // 先等导航出现，说明客户端已经 hydrate 完（不然下面查什么都查不到）
  await page.waitForSelector('.adm-bar', { timeout: 20000 }).catch(() => {});
  const hasBar = await page.locator('.adm-bar').count();
  console.log((hasBar ? '✅' : '❌') + ' 后台导航渲染');

  const panel = page.locator('.adm-fb');
  const n = await panel.count();
  console.log((n ? '✅' : '❌') + ' 群友反馈面板存在');

  if (n) {
    const sum = (await panel.locator('.adm-fb-sum').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    console.log('   概览：' + (sum || '（空）'));

    const rows = panel.locator('.adm-fb-row');
    const count = await rows.count();
    console.log('   条目：' + count + ' 条');
    for (let i = 0; i < count; i += 1) {
      const t = (await rows.nth(i).innerText()).replace(/\s+/g, ' ').trim();
      console.log('   · ' + t.slice(0, 140));
    }
    if (count === 0) {
      const empty = (await panel.locator('.adm-fb-empty').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      console.log('   空态：' + empty);
    }
  }

  // 导航里「群友反馈」这一项要能点进去
  const tab = page.locator('.adm-tabs a', { hasText: '群友反馈' });
  console.log((await tab.count() ? '✅' : '❌') + ' 导航含「群友反馈」入口');

  // 整页图信息太密，单独把面板切一张，方便直接看版式
  if (n) await panel.first().screenshot({ path: path.join(OUT, 'admin-feedback-panel.png') });

  await page.screenshot({ path: path.join(OUT, 'admin-feedback.png'), fullPage: true });

  // 反馈页：标题与默认筛选（默认只看用户反馈）
  await page.goto(BASE + '/admin/support', { waitUntil: 'networkidle', timeout: 45000 });
  const h1 = (await page.locator('h1').first().innerText().catch(() => '')).replace(/\s+/g, '');
  console.log((h1.includes('群友反馈') ? '✅' : '❌') + ' 反馈页标题：' + (h1 || '（无）'));
  const activeChip = (await page.locator('.chips .chip.active').first().innerText().catch(() => '')).trim();
  console.log('   默认筛选：' + (activeChip || '（无）'));

  // 手机上再看一眼：行会折成两段，不能挤成一条线
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mob.addCookies(toCookies(COOKIE));
  const mp = await mob.newPage();
  await mp.goto(BASE + '/admin', { waitUntil: 'networkidle', timeout: 45000 });
  await mp.waitForSelector('.adm-fb', { timeout: 20000 }).catch(() => {});
  const mbox = await mp.locator('.adm-fb').boundingBox().catch(() => null);
  console.log((mbox && mbox.width <= 390 ? '✅' : '❌') + ' 手机端面板宽度 ' + (mbox ? Math.round(mbox.width) : '?') + 'px');
  await mp.locator('.adm-fb').first().screenshot({ path: path.join(OUT, 'admin-feedback-mobile-panel.png') }).catch(() => {});
  await mp.screenshot({ path: path.join(OUT, 'admin-feedback-mobile.png'), fullPage: true });

  if (errors.length) {
    console.log('⚠ 页面 JS 报错：');
    errors.slice(0, 5).forEach((e) => console.log('   ' + e));
  } else {
    console.log('✅ 无 JS 报错');
  }

  await browser.close();
})().catch((e) => {
  console.error('检查失败：' + e.message);
  process.exit(1);
});
