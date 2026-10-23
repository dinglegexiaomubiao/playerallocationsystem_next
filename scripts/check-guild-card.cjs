/**
 * P5 卡片视觉自检：群友卡片的帮派渐变 / 色线 / 徽标，以及详情页的「所属帮派」。
 *
 * 覆盖的是接口和对比度脚本都测不到的部分：
 *   - 渐变到底有没有真的挂在卡片上（用的是 CSS 变量，变量没传进去就是一张白卡，
 *     接口照样返回 guild，肉眼在浅色主题下也未必看得出「差一点点」）
 *   - 徽标名字对不对、有没有被截断成空白
 *   - 详情页那一行是不是只在真有帮派时出现
 *   - 手机端卡片有没有被色线/徽标撑溢出
 *
 * 对比度不在这里测 —— 那是纯数学，跑 npm run guild:contrast。
 *
 * ⚠ 会写数据库（建一个测试帮派，最后解散）。只允许打本地，除非 ALLOW_REMOTE=1。
 *
 * 用法：
 *   BASE=http://127.0.0.1:3006 node scripts/check-guild-card.cjs
 *   THEME=dark BASE=... node scripts/check-guild-card.cjs
 */
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE) && process.env.ALLOW_REMOTE !== '1') {
  console.error('✗ 这个脚本会创建并解散一个帮派，只允许打本地。远端请显式加 ALLOW_REMOTE=1。');
  process.exit(1);
}
const THEME = process.env.THEME || 'light';

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
for (const l of envFile.split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const SECRET = crypto
  .createHash('sha256')
  .update(String(env.AUTH_SECRET || env.DATABASE_URL || 'dota2-community-local-dev'))
  .digest();
const ACCOUNT = process.env.AS_NAME || 'dom';
const payload = Buffer.from(JSON.stringify({ n: ACCOUNT, t: Date.now() })).toString('base64url');
const token = payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
const COOKIE = 'dd_session=' + token;

const GUILD_NAME = '卡片配色小队';
const COLOR_KEY = 'teal';
const COLOR_SOLID = '#2f7d78'; // lib/guild-colors.mjs 里的青碧

let pass = 0;
let fail = 0;
const ok = (c, label, detail = '') => {
  if (c) {
    pass++;
    console.log('  ok   ' + label + (detail ? '  (' + detail + ')' : ''));
  } else {
    fail++;
    console.log('  FAIL ' + label + (detail ? '  (' + detail + ')' : ''));
  }
};

(async () => {
  let browser = null;
  try {
    await run();
  } catch (e) {
    console.error('ERR', e.message);
    fail++;
  } finally {
    // 无论中间怎么失败，都要把测试帮派收掉 —— 留在库里会让下次「只有一个卡片带配色」直接红
    await fetch(BASE + '/api/guild', { method: 'DELETE', headers: { cookie: COOKIE } }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})();

/**
 * 等群友页出现「带帮派配色」的卡片。
 *
 * 为什么要等：`/members` 是 SSR + 45s 列表缓存，缓存里没有帮派时页面就不会染色。
 * 建帮之后 `createGuild` 会清缓存，但 dev 下页面与 API 路由各自持有一份模块实例，
 * 未必清得到对方那份 —— 所以这里按时间轮询，最多等 60 秒。
 * （线上是单进程单实例，清一次就够，不存在这个问题。）
 */
async function waitForTinted(p, maxSec = 60) {
  const deadline = Date.now() + maxSec * 1000;
  for (;;) {
    const n = await p.locator('.p-card.has-guild').count();
    if (n > 0) return n;
    if (Date.now() > deadline) return n;
    await p.waitForTimeout(6000);
    await p.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForSelector('.p-card', { timeout: 30000 });
  }
}

async function run() {
  // ---- 0. 先清干净，再建一个测试帮派 ----
  await fetch(BASE + '/api/guild', { method: 'DELETE', headers: { cookie: COOKIE } });
  const created = await fetch(BASE + '/api/guild', {
    method: 'POST',
    headers: { cookie: COOKIE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: GUILD_NAME, colorKey: COLOR_KEY, slogan: '' }),
  }).then((r) => r.json());
  ok(created.success === true, '建了一个测试帮派', created.error || GUILD_NAME);

  // 找出这个帮派挂在谁身上（徽标要对上人）
  const who = await fetch(BASE + '/api/players').then((r) => r.json());
  const member = (who.players || []).find((p) => p.guild && p.guild.name === GUILD_NAME);
  ok(!!member, '列表接口里有人带上了帮派', member ? `${member.nickname} / ${member.guild.colorKey}` : '没找到');
  if (!member) return;

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
  if (THEME === 'dark') {
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('laroja-theme', 'dark');
      } catch (e) {}
    });
  }
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await p.goto(BASE + '/members', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('.p-card', { timeout: 30000 });
  await p.waitForTimeout(500);

  // ---- 1. 只有一个人有帮派，别的卡片不该被染色 ----
  const tinted = await waitForTinted(p);
  ok(tinted === 1, '只有一个群友卡片带帮派配色', tinted + ' 张');
  const plain = await p.locator('.p-card:not(.has-guild)').count();
  ok(plain > 0, '其它卡片保持原样', plain + ' 张');
  if (tinted === 0) return;

  const card = p.locator('.p-card.has-guild').first();
  const styleAttr = (await card.getAttribute('style')) || '';
  ok(/--guild-a:\s*rgba\(47,\s*125,\s*120,\s*0\.12\)/.test(styleAttr), '渐变起点是青碧 0.12', styleAttr.slice(0, 60));
  ok(/--guild-solid:\s*#2f7d78/.test(styleAttr), '实色是青碧', styleAttr);

  const bg = await card.evaluate((el) => getComputedStyle(el).backgroundImage);
  ok(/linear-gradient/.test(bg), '卡片背景真的挂上了渐变', bg.replace(/\s+/g, ' ').slice(0, 70));
  ok(/135deg/.test(bg), '渐变角度 135°');

  const line = await card.evaluate((el) => {
    const s = getComputedStyle(el, '::before');
    return { w: s.width, bg: s.backgroundColor };
  });
  ok(line.w === '2px', '左侧色线 2px', line.w);
  ok(/47,\s*125,\s*120/.test(line.bg), '色线用的是帮派实色', line.bg);

  // 边框：带帮派的卡片和普通卡片不该一样，否则渐变的边缘会显得「浮」
  const borders = await p.evaluate(() => {
    const g = document.querySelector('.p-card.has-guild');
    const n = document.querySelector('.p-card:not(.has-guild)');
    return [getComputedStyle(g).borderTopColor, getComputedStyle(n).borderTopColor];
  });
  ok(borders[0] !== borders[1], '边框跟着帮派色走', borders.join(' vs '));

  // ---- 2. 帮派徽标 ----
  const badge = card.locator('.p-guild');
  ok((await badge.count()) === 1, '卡片上有帮派徽标');
  const badgeName = ((await card.locator('.p-guild-name').first().textContent()) || '').trim();
  ok(badgeName === GUILD_NAME, '徽标显示帮派名', badgeName);
  const dot = await card.locator('.p-guild-dot').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  ok(/47,\s*125,\s*120/.test(dot), '徽标色块用同一个实色', dot);
  const overflowName = await card
    .locator('.p-guild-name')
    .first()
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  ok(overflowName <= 1, '帮派名没有被挤到溢出', overflowName + 'px');

  await card.screenshot({ path: 'shots/guild-card-' + THEME + '.png' });

  // ---- 3. 详情页「所属帮派」 ----
  await p.goto(BASE + '/members/' + member.id, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('.kv', { timeout: 30000 });
  await p.waitForTimeout(400);
  const kvVals = await p.locator('.kv').evaluateAll((els) =>
    els.map((el) => [
      (el.querySelector('.k') || {}).textContent || '',
      (el.querySelector('.v') || {}).textContent || '',
    ])
  );
  const guildRow = kvVals.find(([k]) => k.trim() === '所属帮派');
  ok(!!guildRow, '详情页基本信息里有「所属帮派」');
  ok(!!guildRow && guildRow[1].trim() === GUILD_NAME, '详情页显示帮派名', guildRow ? guildRow[1].trim() : '');
  ok((await p.locator('.detail-guild-dot').count()) === 1, '详情页有帮派色点');
  await p.locator('.side-card').first().screenshot({ path: 'shots/guild-detail-' + THEME + '.png' });

  // ---- 4. 手机端：色线和徽标不能把卡片撑破 ----
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
  const mp = await mctx.newPage();
  await mp.goto(BASE + '/members', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mp.waitForSelector('.p-card.has-guild', { timeout: 30000 });
  await mp.waitForTimeout(400);
  const mOverflow = await mp.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  ok(mOverflow <= 1, '手机端整页无横向溢出', mOverflow + 'px');
  const cardOverflow = await mp.evaluate(() => {
    const el = document.querySelector('.p-card.has-guild');
    return el.scrollWidth - el.clientWidth;
  });
  ok(cardOverflow <= 1, '手机端帮派卡片内部不溢出', cardOverflow + 'px');
  await mp.locator('.p-card.has-guild').first().screenshot({ path: 'shots/guild-card-mobile.png' });

  // ---- 5. 解散后必须回到「干净」状态 ----
  const del = await fetch(BASE + '/api/guild', { method: 'DELETE', headers: { cookie: COOKIE } }).then((r) => r.json());
  ok(del.success === true, '解散测试帮派', del.error || '');
  // 不直接读页面 HTML：列表缓存 45 秒，刚解散时页面可能还拿着上一份。
  // 轮询接口直到干净为止（这也是真实的用户可见结果），最多等 60 秒。
  const clean = await waitUntilClean();
  ok(clean, '解散后没有群友还挂着这个帮派（缓存清干净）', clean ? '已清空' : '60 秒内仍是脏的');

  console.log('\nconsole 错误:', errors.length, errors.slice(0, 3));
  ok(errors.filter((e) => !/ws:\/\/|WebSocket/.test(e)).length === 0, '无 console 报错（忽略 dev 的 HMR 断连）');
}

/** 解散之后轮询接口，直到没有任何人挂着这个测试帮派 */
async function waitUntilClean(maxSec = 60) {
  const deadline = Date.now() + maxSec * 1000;
  for (;;) {
    const d = await fetch(BASE + '/api/players').then((r) => r.json()).catch(() => ({}));
    const left = (d.players || []).filter((p) => p.guild && p.guild.name === GUILD_NAME).length;
    if (left === 0) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 5000));
  }
}
