#!/usr/bin/env node
/**
 * 双主题截图：同一批页面分别用夜间 / 日间各截一张，用于改版前后对比。
 *
 * 用法：
 *   npm run shoot:theme                 # 公开页面，两套主题
 *   npm run shoot:theme -- --admin      # 加上登录态页面（/admin /profile /main）
 *   npm run shoot:theme -- --only=light # 只截一个主题
 *   BASE=http://127.0.0.1:3000 npm run shoot:theme
 *
 * 输出：docs/screenshots/_theme/{dark,light}/*.png
 *
 * 登录态页面的 cookie 用 lib/auth.js 的同一套 HMAC 现算，
 * 不能靠点登录表单 —— 会真的走一次鉴权并写访问日志。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const OUT = 'docs/screenshots/_theme';
const WANT_ADMIN = process.argv.includes('--admin');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1];

const PUBLIC_PAGES = [
  ['home', '/'],
  ['tournaments', '/tournaments'],
  ['tournament-detail', '/tournaments/16'],
  ['members', '/members'],
  ['party', '/party'],
  ['food', '/food'],
  ['login', '/login'],
];

const ADMIN_PAGES = [
  ['admin', '/admin'],
  ['profile', '/profile'],
  ['assign', '/main'],
];

/** 读 .env.local（项目没装 dotenv，手解析即可） */
function loadEnv() {
  const f = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

/** 与 lib/auth.js 完全一致的 token，用于跳过登录 */
function sessionToken(name) {
  const secret = crypto
    .createHash('sha256')
    .update(String(process.env.AUTH_SECRET || process.env.DATABASE_URL || 'dota2-community-local-dev'))
    .digest();
  const payload = Buffer.from(JSON.stringify({ n: name, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

(async () => {
  loadEnv();
  const browser = await chromium.launch();
  const themes = ONLY ? [ONLY] : ['dark', 'light'];
  const pages = WANT_ADMIN ? [...PUBLIC_PAGES, ...ADMIN_PAGES] : PUBLIC_PAGES;
  const token = WANT_ADMIN ? sessionToken(process.env.ADMIN_NAME || 'dom') : null;

  for (const theme of themes) {
    const dir = path.join(OUT, theme);
    fs.mkdirSync(dir, { recursive: true });

    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      deviceScaleFactor: 1,
      locale: 'zh-CN',
    });

    // 主题靠 localStorage 决定；先写入再导航，首屏就是对的
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem('laroja-theme', t);
      } catch (e) {}
    }, theme);

    if (token) {
      const host = new URL(BASE).hostname;
      await ctx.addCookies([{ name: 'dd_session', value: token, domain: host, path: '/', httpOnly: true }]);
    }

    const page = await ctx.newPage();
    for (const [name, url] of pages) {
      const resp = await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(700);
      const info = await page.evaluate(() => ({
        attr: document.documentElement.getAttribute('data-theme'),
        bg: getComputedStyle(document.body).backgroundColor,
      }));
      await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: false });
      const flag = theme === 'light' ? info.attr === 'light' : info.attr === null;
      console.log(
        `${theme.padEnd(5)} ${name.padEnd(18)} ${String(resp.status()).padEnd(4)} ${flag ? 'ok ' : '!! '} attr=${String(info.attr).padEnd(5)} ${info.bg}`
      );
    }
    await ctx.close();
  }
  await browser.close();
  console.log(`\n输出目录：${OUT}/{dark,light}`);
})();
