/**
 * 帮派页自检（/guilds 列表页 + /guild/[id] 主页）。
 *
 * 为什么不能只看 HTTP 200：这两页都是「SSR 出行 + 客户端拉 /api/guild」，
 * curl 抓到的是骨架。列表行有没有渲染、导航有没有高亮、夜间配色对不对、
 * 手机上溢不溢出，全都看不出来。
 *
 * 用法：
 *   node scripts/check-guild-pages.cjs                     # 本地 3006
 *   BASE=https://dota.playerallocationsystem.online node scripts/check-guild-pages.cjs
 *
 * 会写库：为了验「已加入」那一态，脚本临时建一个帮派，跑完（含抛错）一定解散。
 * 清理只删自己建的那个，不动别人的。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { loadEnvConfig } = require('@next/env');
const { chromium } = require('playwright');

loadEnvConfig(process.cwd(), false);

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
const OUT = path.join(process.cwd(), 'shots', 'guild');
const NAME = String(process.env.ADMIN_NAMES || 'dom').split(',')[0].trim();

// 打线上要先注入服务器那把 AUTH_SECRET（两边不是同一个），见 pitfalls 第 15 节
const cookie = () => {
  if (process.env.COOKIE) return process.env.COOKIE;
  const secret = crypto.createHash('sha256').update(String(process.env.AUTH_SECRET || 'x')).digest();
  const payload = Buffer.from(JSON.stringify({ n: NAME, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `dd_session=${payload}.${sig}`;
};
const COOKIE = cookie();

const api = async (p, opt = {}) => {
  const r = await fetch(BASE + p, {
    ...opt,
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE, ...(opt.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
};

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}${extra ? '  ' + extra : ''}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label}${extra ? '  ' + extra : ''}`);
  }
};

(async () => {
  const errors = [];
  let tempId = null;
  const browser = await chromium.launch();

  const makeCtx = async (opts = {}) => {
    const { anon = false, ...ctxOpts } = opts;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...ctxOpts });
    if (anon) return ctx; // 真的不带 cookie，否则「匿名视角」其实还是登录态
    await ctx.addCookies(
      COOKIE.split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const i = pair.indexOf('=');
          return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: new URL(BASE).hostname, path: '/' };
        })
    );
    return ctx;
  };

  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      // dev server 的 HMR WebSocket 在这套环境里必然握手失败，与代码无关；
      // 头像/图标 404 也不算页面问题。
      // 401 是匿名视角下 /api/guild 的正常回应（GuildPanel 靠它判断「未登录」并出登录按钮），
      // 浏览器把它记成 failed resource，但代码里已经处理过了。
      if (/favicon|_next\/static|_next\/hmr|WebSocket|avatar|\.png|\.jpg|\.webp|status of 401/.test(t)) return;
      errors.push('[console] ' + t.slice(0, 180));
    });
  };

  try {
    fs.mkdirSync(OUT, { recursive: true });

    // ---- 先拿公开数据做基准 ----
    const list = await api('/api/guilds');
    const guilds = (list.d && list.d.guilds) || [];
    console.log(`\n[公开数据] /api/guilds ${list.status}，共 ${guilds.length} 个帮派`);
    ok(list.status === 200 && list.d.success === true, '列表接口可用');
    ok(Array.isArray(guilds), '返回的是数组');
    if (guilds.length) {
      const g0 = guilds[0];
      ok(typeof g0.createdAt === 'string', 'createdAt 已序列化成字符串（Date 进 props 会 500）');
      ok(Array.isArray(g0.headAvatars) && g0.headAvatars.length <= 5, '头像最多 5 个', `实际 ${g0.headAvatars.length}`);
      ok(g0.memberCount <= g0.maxMembers, '人数不超过上限', `${g0.memberCount}/${g0.maxMembers}`);
    }

    // ---- 列表页：匿名视角 ----
    console.log('\n[列表页 /guilds · 匿名]');
    const ctx1 = await makeCtx({ anon: true });
    const p1 = await ctx1.newPage();
    watch(p1);
    const r1 = await p1.goto(BASE + '/guilds', { waitUntil: 'networkidle', timeout: 60000 });
    ok(r1 && r1.status() === 200, 'HTTP 200', String(r1 && r1.status()));
    ok((await p1.locator('.nav-links a.active').innerText().catch(() => '')).trim() === '帮派', '导航高亮「帮派」');
    ok((await p1.locator('.page-hero h1').innerText()).replace(/\s+/g, '') === '群友帮派', '页头标题');
    const rows = await p1.locator('.guild-row').count();
    ok(rows === guilds.length, '列表行数与接口一致', `页面 ${rows} / 接口 ${guilds.length}`);
    ok((await p1.locator('.guild-row-bar').count()) === rows, '每行都有配色竖条');
    // 匿名时「我的帮派」应该给创建引导，而不是报错
    ok((await p1.locator('.guild-block-page').count()) === 1, '「我的帮派」区块存在');
    const anonHint = await p1.locator('.guild-block-page .guild-block-hint').first().innerText().catch(() => '');
    ok(/登录|绑定/.test(anonHint), '匿名时提示要登录/绑定', anonHint.slice(0, 24));

    const overflow = async (page) =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok((await overflow(p1)) <= 0, '1440 宽度无横向溢出', `${await overflow(p1)}px`);
    await p1.screenshot({ path: path.join(OUT, 'guilds-anon.png'), fullPage: true });

    // ---- 列表页：登录但未加入 ----
    console.log('\n[列表页 /guilds · 已登录未加入]');
    const ctx2 = await makeCtx();
    const p2 = await ctx2.newPage();
    watch(p2);
    await p2.goto(BASE + '/guilds', { waitUntil: 'networkidle', timeout: 60000 });
    const createBtn = p2.locator('.guild-block-page button', { hasText: '创建帮派' });
    ok((await createBtn.count()) === 1, '有「创建帮派」按钮');
    const btnW = await createBtn.evaluate((el) => el.getBoundingClientRect().width).catch(() => 0);
    const wrapW = await p2.locator('.wrap').first().evaluate((el) => el.getBoundingClientRect().width);
    ok(btnW > 0 && btnW < wrapW * 0.6, '页面上创建按钮不是通栏', `${Math.round(btnW)}px / 容器 ${Math.round(wrapW)}px`);

    // ---- 建一个临时帮派，验「已加入（帮主）」 ----
    console.log('\n[临时建帮，验已加入态]');
    const colors = await api('/api/guild');
    const free = (colors.d && colors.d.colors && colors.d.colors.free) || [];
    if (!free.length) {
      ok(false, '没有空闲配色，跳过建帮验证');
    } else {
      const created = await api('/api/guild', {
        method: 'POST',
        body: JSON.stringify({ name: '自检临时帮派', colorKey: free[0], slogan: '跑完就散，别当真' }),
      });
      tempId = created.d && created.d.id;
      // 创建接口回 201（不是 200）
      ok([200, 201].includes(created.status) && created.d.success, '创建成功', `id=${tempId}`);

      if (tempId) {
        await p2.reload({ waitUntil: 'networkidle' });
        const miniName = await p2.locator('.guild-block-page .guild-mini-name').innerText().catch(() => '');
        ok(miniName === '自检临时帮派', '「我的帮派」显示刚建的帮', miniName);
        ok(
          (await p2.locator('.guild-block-page button', { hasText: '帮派管理' }).count()) === 1,
          '帮主有「帮派管理」入口'
        );
        ok((await p2.locator('.guild-row.is-mine').count()) === 1, '列表里自己的帮派带「我的」标记');
        ok(
          (await p2.locator('.guild-row').first().getAttribute('class')).includes('is-mine'),
          '自己的帮派排在第一位'
        );
        const rows2 = await p2.locator('.guild-row').count();
        ok(rows2 === guilds.length + 1, '新建后列表多一行', `${rows2}`);
        await p2.screenshot({ path: path.join(OUT, 'guilds-joined.png'), fullPage: true });

        // ---- 详情页 ----
        console.log('\n[详情页 /guild/[id]]');
        const p3 = await ctx2.newPage();
        watch(p3);
        const r3 = await p3.goto(BASE + '/guild/' + tempId, { waitUntil: 'networkidle', timeout: 60000 });
        ok(r3 && r3.status() === 200, 'HTTP 200', String(r3 && r3.status()));
        ok((await p3.locator('.guild-hero h1').innerText()).trim() === '自检临时帮派', '标题是帮派名');
        ok((await p3.locator('.guild-hero-slogan').innerText()).includes('跑完就散'), '口号显示');
        ok((await p3.locator('.guild-role').first().innerText()).includes('帮主'), '我是帮主的身份标记');
        ok((await p3.locator('.guild-member').count()) === 1, '成员行 1 条（只有帮主）');
        ok((await p3.locator('.guild-hero-dot').count()) === 1, '配色色块在');
        await p3.screenshot({ path: path.join(OUT, 'guild-detail.png'), fullPage: true });

        // ---- 夜间 ----
        console.log('\n[夜间]');
        const ctxDark = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await ctxDark.addCookies(
          COOKIE.split(';')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((pair) => {
              const i = pair.indexOf('=');
              return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: new URL(BASE).hostname, path: '/' };
            })
        );
        // 夜间 = 没有 data-theme 属性，靠 localStorage 让 _app 别再贴回去
        await ctxDark.addInitScript(() => localStorage.setItem('laroja-theme', 'dark'));
        const pd = await ctxDark.newPage();
        watch(pd);
        await pd.goto(BASE + '/guilds', { waitUntil: 'networkidle' }).catch(() => {});
        await pd.screenshot({ path: path.join(OUT, 'guilds-dark.png'), fullPage: true });
        await pd.goto(BASE + '/guild/' + tempId, { waitUntil: 'networkidle' }).catch(() => {});
        await pd.screenshot({ path: path.join(OUT, 'guild-detail-dark.png'), fullPage: true });
        const darkAttr = await pd.evaluate(() => document.documentElement.getAttribute('data-theme'));
        ok(darkAttr === null, '夜里确实是「摘掉 data-theme」', String(darkAttr));

        // ---- 手机 ----
        console.log('\n[手机 390]');
        // 不能对已有 page 调 setViewportSize，要单独开 context（见 pitfalls）
        const mctx = await makeCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const mp = await mctx.newPage();
        watch(mp);
        for (const [u, tag] of [
          ['/guilds', 'guilds'],
          ['/guild/' + tempId, 'guild-detail'],
        ]) {
          await mp.goto(BASE + u, { waitUntil: 'networkidle' }).catch(() => {});
          const ov = await mp.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth
          );
          ok(ov <= 0, `${u} 手机无横向溢出`, `${ov}px`);
          await mp.screenshot({ path: path.join(OUT, 'mobile-' + tag + '.png'), fullPage: true });
        }
      }
    }

    // ---- 不存在的帮派 ----
    console.log('\n[不存在的帮派]');
    const ctxX = await makeCtx();
    const px = await ctxX.newPage();
    const rx = await px.goto(BASE + '/guild/99999999', { waitUntil: 'domcontentloaded', timeout: 60000 });
    ok(rx && rx.status() === 404, 'HTTP 404', String(rx && rx.status()));
    ok((await px.locator('h1').innerText()).includes('没有这个帮派'), '有友好提示而不是白屏');
    ok((await px.locator('a', { hasText: '回帮派列表' }).count()) >= 1, '给了回去的链接');

    console.log('\n[console]');
    ok(errors.length === 0, '无 JS 报错', errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail += 1;
    console.log('\n✗ 脚本抛错:', e.message);
  } finally {
    // 清理：只解散自己建的那个
    if (tempId) {
      const del = await api('/api/guild', { method: 'DELETE' }).catch(() => ({ status: 0, d: {} }));
      console.log(`\n[清理] 解散临时帮派 ${tempId} → ${del.status}`);
    }
    await browser.close();
    console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
