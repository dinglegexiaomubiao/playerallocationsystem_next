/**
 * 后台逐页截图自检。
 *
 * 为什么要有：后台 11 个页面全是「SSR 出壳 + 客户端 useSession 取数」，
 * curl 抓 HTML 只能看到 307/加载中，看不到版式，也看不到 JS 报错。
 * 这个脚本用 playwright 带上管理员 cookie 跑完客户端渲染，逐页截图，
 * 并把每页的 h1、数据条、表格行数、控制台报错都打出来。
 *
 * 用法：
 *   node scripts/shoot-admin.cjs                    # 本地 3006
 *   BASE=https://dota.playerallocationsystem.online node scripts/shoot-admin.cjs
 *
 * 不传 COOKIE 时自己用 .env.local 的 AUTH_SECRET + ADMIN_NAMES 签一个，
 * 所以本机直接跑就行，不用去浏览器里捞 cookie。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { loadEnvConfig } = require('@next/env');
const { chromium } = require('playwright');

loadEnvConfig(process.cwd(), false);

const BASE = process.env.BASE || 'http://localhost:3006';
const OUT = path.join(process.cwd(), 'shots', 'admin');

function adminCookie() {
  if (process.env.COOKIE) return process.env.COOKIE;
  const secret = crypto
    .createHash('sha256')
    .update(String(process.env.AUTH_SECRET || process.env.DATABASE_URL || 'dota2-community-local-dev'))
    .digest();
  const name = String(process.env.ADMIN_NAMES || 'dom').split(',')[0].trim();
  const payload = Buffer.from(JSON.stringify({ n: name, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `dd_session=${payload}.${sig}`;
}

const COOKIE = adminCookie();
const host = new URL(BASE).hostname;

const cookies = COOKIE.split(';')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pair) => {
    const i = pair.indexOf('=');
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: host, path: '/' };
  });

const PAGES = [
  ['/admin', '赛事'],
  ['/admin/matches', '战绩'],
  ['/admin/members', '群友'],
  ['/admin/guilds', '帮派'],
  ['/admin/food', '美食'],
  ['/admin/reviews', '评价'],
  ['/admin/party', '开黑'],
  ['/admin/activities', '活动'],
  ['/admin/messages', '留言'],
  ['/admin/support', '反馈'],
  ['/admin/analytics', '访问'],
  ['/main', '阵容'],
];

(async () => {
  // 赛事详情页要带真实 id：先问接口拿一届，拿不到就跳过（空库也不该让自检红）
  try {
    const r = await fetch(BASE + '/api/tournaments');
    const d = await r.json();
    const first = (d && d.tournaments && d.tournaments[0]) || null;
    if (first) PAGES.splice(1, 0, ['/admin/tournaments/' + first.id, '赛事详情']);
  } catch {
    /* 忽略：下面照常跑其余页 */
  }

  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      // 头像/图标 404、favicon 之类不算页面问题
      if (/favicon|_next\/static|avatar|hero-icon|item-icon|\.png|\.jpg|\.webp/.test(t)) return;
      errors.push('[console] ' + t.slice(0, 200));
    }
  });

  let bad = 0;

  for (const [href, name] of PAGES) {
    errors.length = 0;
    let code = 0;
    try {
      const res = await page.goto(BASE + href, { waitUntil: 'networkidle', timeout: 60000 });
      code = res ? res.status() : 0;
    } catch (e) {
      console.log(`❌ ${href} 打不开：${e.message}`);
      bad += 1;
      continue;
    }

    // 客户端渲染完成：导航 + 页头 h1 都在
    await page.waitForSelector('.adm-nav', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(600);

    const h1 = ((await page.locator('.adm-pagehead h1').first().innerText().catch(() => '')) || '')
      .replace(/\s+/g, '')
      .trim();
    const metrics = await page.locator('.adm-metric').count();
    const rows = await page.locator('.adm-data tbody tr').count();
    const shell = await page.locator('.adm-shell').count();
    const denied = await page.locator('.empty', { hasText: '只给管理员' }).count();
    const onNav = await page.locator('.adm-nav-link.is-on').count();
    const navLabel = onNav
      ? ((await page.locator('.adm-nav-link.is-on').first().innerText()) || '').replace(/\s+/g, '')
      : '';

    const ok = code === 200 && shell === 1 && h1.length > 0 && onNav === 1 && !denied;
    if (!ok) bad += 1;

    console.log(
      `${ok ? '✅' : '❌'} ${href.padEnd(20)} ${String(code)}  标题「${h1 || '—'}」 数据 ${metrics} 项  表格 ${rows} 行  导航高亮「${navLabel || '无'}」`
    );

    const file = path.join(OUT, name + '.png');
    await page.screenshot({ path: file, fullPage: true });

    if (errors.length) {
      bad += 1;
      console.log('   ⚠ JS 报错 ' + errors.length + ' 条：');
      [...new Set(errors)].slice(0, 4).forEach((e) => console.log('     ' + e));
    }
  }

  // 夜间：主题只认 localStorage['laroja-theme']='dark'（默认日间由 <html data-theme="light"> 表达）。
  // 直接 removeAttribute 会被 _app 里的 applyTheme 重新贴回去，所以走 localStorage 这条路。
  const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await dark.addCookies(cookies);
  await dark.addInitScript(() => {
    try {
      localStorage.setItem('laroja-theme', 'dark');
    } catch {}
  });
  const dp = await dark.newPage();
  for (const p of ['/admin', '/admin/analytics', '/admin/guilds']) {
    await dp.goto(BASE + p, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await dp.waitForTimeout(600);
    const slug = p.replace(/\//g, '-').replace(/^-/, '') || 'admin';
    await dp.screenshot({ path: path.join(OUT, 'dark-' + slug + '.png'), fullPage: true });
  }
  console.log('🌙 夜间三页已截图');

  // 手机：导航要能横向滚，数据条两列，表格横向滚不顶破页面
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await mob.addCookies(cookies);
  const mp = await mob.newPage();
  for (const [href, name] of [
    ['/admin', '赛事'],
    ['/admin/guilds', '帮派'],
  ]) {
    await mp.goto(BASE + href, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await mp.waitForTimeout(600);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${overflow <= 1 ? '✅' : '❌'} 手机 ${href} 横向溢出 ${overflow}px`);
    if (overflow > 1) bad += 1;
    await mp.screenshot({ path: path.join(OUT, 'mobile-' + name + '.png'), fullPage: true });
  }

  await browser.close();
  console.log(bad === 0 ? '\n全部通过' : `\n有 ${bad} 处问题`);
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => {
  console.error('自检失败：' + e.message);
  process.exit(1);
});
