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
const GUILD_SLOGAN = '青碧一伙，专治不服';
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
 *
 * 注意等的是**我们这个测试帮派**的卡片，不是「随便一张有帮派的卡」：
 * 库里本来就有真实帮派（阴暗组），按后者等会立刻命中别家那张，配色断言全错。
 */
function testCard(p) {
  return p
    .locator('.p-card.has-guild')
    .filter({ has: p.locator('.p-guild-name', { hasText: new RegExp('^' + GUILD_NAME + '$') }) });
}

async function waitForTinted(p, maxSec = 60) {
  const deadline = Date.now() + maxSec * 1000;
  for (;;) {
    if ((await testCard(p).count()) > 0) return true;
    if (Date.now() > deadline) return false;
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
    body: JSON.stringify({ name: GUILD_NAME, colorKey: COLOR_KEY, slogan: GUILD_SLOGAN }),
  }).then((r) => r.json());
  ok(created.success === true, '建了一个测试帮派', created.error || GUILD_NAME);
  const guildId = created.id;

  // 找出这个帮派挂在谁身上（徽标要对上人）。
  // /api/players 有 45s 列表缓存，建帮后清缓存这件事在 dev 下不一定立刻生效
  // （page 与 api 路由各持一份模块实例），所以这里短轮询几次，别一次查不到就判死。
  let member = null;
  for (let i = 0; i < 8; i++) {
    const who = await fetch(BASE + '/api/players').then((r) => r.json());
    member = (who.players || []).find((p) => p.guild && p.guild.name === GUILD_NAME);
    if (member) break;
    await new Promise((r) => setTimeout(r, 2500));
  }
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
  const notFound = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // 记下 404 的具体 URL：只说「Failed to load resource」等于没说
  p.on('response', (r) => {
    if (r.status() === 404) notFound.push(r.url());
  });

  await p.goto(BASE + '/members', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('.p-card', { timeout: 30000 });
  await p.waitForTimeout(500);

  // ---- 1. 测试帮派那张卡被染色，没帮派的人保持原样 ----
  // 库里已有真实帮派，所以不能断言「全站只有一张染色卡」——
  // 只能断言「我们这张染了」「没帮派的没染」。
  const tinted = await waitForTinted(p);
  ok(tinted, '测试帮派的卡片带上了配色', GUILD_NAME);
  if (!tinted) return;
  const plain = await p.locator('.p-card:not(.has-guild)').count();
  ok(plain > 0, '没帮派的卡片保持原样', plain + ' 张');

  const card = testCard(p).first();
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
  const guildBorder = await card.evaluate((el) => getComputedStyle(el).borderTopColor);
  const plainBorder = await p
    .locator('.p-card:not(.has-guild)')
    .first()
    .evaluate((el) => getComputedStyle(el).borderTopColor);
  ok(guildBorder !== plainBorder, '边框跟着帮派色走', [guildBorder, plainBorder].join(' vs '));

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

  // 徽标是链接，但整卡盖着一个绝对定位的 .p-card-hit —— 没抬 z-index 就点不到。
  // 用 click({trial}) 而不是 elementFromPoint：它会先滚动到可见，再做命中测试；
  // 被覆盖层挡住时直接抛 "intercepts pointer events"，正好是我们要断言的东西。
  const badgeHref = await badge.getAttribute('href');
  ok(badgeHref === '/guild/' + guildId, '徽标链到帮派主页', badgeHref);
  let badgeHittable = true;
  try {
    await badge.click({ trial: true, timeout: 5000 });
  } catch (e) {
    badgeHittable = false;
  }
  ok(badgeHittable, '徽标浮在整卡覆盖层之上（点得到）');

  await card.screenshot({ path: 'shots/guild-card-' + THEME + '.png' });

  // ---- 3. 详情页「所属帮派」：名字是链接、口号在下面一行 ----
  await p.goto(BASE + '/members/' + member.id, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForSelector('.kv', { timeout: 30000 });
  await p.waitForTimeout(400);
  const kvVals = await p.locator('.kv').evaluateAll((els) =>
    els.map((el) => (el.querySelector('.k') || {}).textContent || '')
  );
  ok(kvVals.some((k) => k.trim() === '所属帮派'), '详情页基本信息里有「所属帮派」');

  const guildLink = p.locator('.kv-guild .detail-guild');
  ok((await guildLink.count()) === 1, '详情页帮派名是链接');
  const linkName = ((await guildLink.locator('.detail-guild-name').textContent()) || '').trim();
  ok(linkName === GUILD_NAME, '详情页显示帮派名', linkName);
  const detailHref = await guildLink.getAttribute('href');
  ok(detailHref === '/guild/' + guildId, '帮派名指到帮派主页', detailHref);
  const sloganText = ((await p.locator('.kv-guild .detail-guild-slogan').textContent()) || '').trim();
  ok(sloganText.includes(GUILD_SLOGAN), '详情页显示帮派口号', sloganText);
  ok((await p.locator('.detail-guild-dot').count()) === 1, '详情页有帮派色点');
  // 截图目标要精确到「基本信息」那张卡：页面里 .side-card 不止一个
  const infoCard = p.locator('.side-card').filter({ has: p.locator('.kv-guild') });
  await infoCard.screenshot({ path: 'shots/guild-detail-' + THEME + '.png' });
  await p.screenshot({ path: 'shots/member-detail-' + THEME + '.png', fullPage: false });

  // 点一下真的能走过去（用户要的「点帮派能看帮派信息」）
  await guildLink.click();
  await p.waitForURL('**/guild/' + guildId, { timeout: 30000 });
  await p.waitForSelector('.guild-hero', { timeout: 30000 });
  const heroName = ((await p.locator('.guild-hero-title').textContent()) || '').trim();
  ok(heroName.includes(GUILD_NAME), '点帮派名落到帮派主页', heroName.slice(0, 24));

  // 帮派主页上的两处「从 id 生成的东西」，都踩过坑：
  //   1) 成员链接：player_id 是 17 位雪花号，被 Number() 截一位就 404，而且不报错
  //   2) 头像：直接塞 steamstatic 外链会被 CSP 的 img-src 拦掉，全退成首字母色块
  const memberHref = await p.locator('.guild-member-link').first().getAttribute('href');
  ok(memberHref === '/members/' + member.id, '成员链接用的是真实 id（雪花号没被截断）', memberHref);

  // 直接访问一次，确认 SSR 的状态码是 200 ——
  // 客户端 Link 跳转时 dev server 会为数据请求回一次 404 再整页加载（HMR 环境噪声），
  // 只看 console 会把这条噪声当成「帮派主页 404」。状态码才是事实。
  const direct = await p.goto(BASE + '/guild/' + guildId, { waitUntil: 'domcontentloaded', timeout: 60000 });
  ok(direct && direct.status() === 200, '帮派主页直接访问返回 200', direct && direct.status());
  const avatarImg = p.locator('.guild-member-avatar img').first();
  if (await avatarImg.count()) {
    const avatarSrc = await avatarImg.getAttribute('src');
    ok(/^\/api\/avatar\/\d+$/.test(String(avatarSrc)), '成员头像走站内代理', avatarSrc);
  } else {
    // 帮主自己没同步到头像时 Avatar 回退成首字母色块，这是正常态，不算失败
    ok(true, '帮主没同步到头像，回退首字母色块（代理断言跳过）');
  }

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
  const mCard = testCard(mp).first();
  const cardOverflow = (await mCard.count())
    ? await mCard.evaluate((el) => el.scrollWidth - el.clientWidth)
    : -1;
  ok(cardOverflow >= 0 && cardOverflow <= 1, '手机端帮派卡片内部不溢出', cardOverflow + 'px');
  await mCard.screenshot({ path: 'shots/guild-card-mobile.png' });

  // 详情页在手机上是单列，帮派名 + 口号两行也不能把页面顶宽
  await mp.goto(BASE + '/members/' + member.id, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mp.waitForSelector('.kv-guild', { timeout: 30000 });
  await mp.waitForTimeout(400);
  const mDetailOverflow = await mp.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  ok(mDetailOverflow <= 1, '手机端详情页无横向溢出（帮派两行不顶宽）', mDetailOverflow + 'px');
  await mp
    .locator('.side-card')
    .filter({ has: mp.locator('.kv-guild') })
    .screenshot({ path: 'shots/guild-detail-mobile.png' });

  // ---- 5. 解散后必须回到「干净」状态 ----
  const del = await fetch(BASE + '/api/guild', { method: 'DELETE', headers: { cookie: COOKIE } }).then((r) => r.json());
  ok(del.success === true, '解散测试帮派', del.error || '');
  // 不直接读页面 HTML：列表缓存 45 秒，刚解散时页面可能还拿着上一份。
  // 轮询接口直到干净为止（这也是真实的用户可见结果），最多等 60 秒。
  const clean = await waitUntilClean();
  ok(clean, '解散后没有群友还挂着这个帮派（缓存清干净）', clean ? '已清空' : '60 秒内仍是脏的');

  // dev server 的 HMR WebSocket 在这套环境里必然握手失败，与代码无关
  const realErrors = errors.filter((e) => !/ws:\/\/|WebSocket/.test(e));
  console.log('\nconsole 错误:', errors.length, '（真实错误', realErrors.length, '）');
  if (realErrors.length) console.log(realErrors.slice(0, 5));
  if (notFound.length) console.log('404 的 URL：', [...new Set(notFound)].slice(0, 6));
  ok(realErrors.length === 0, '无 console 报错（忽略 dev 的 HMR 断连）', realErrors.slice(0, 2).join(' | '));
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
