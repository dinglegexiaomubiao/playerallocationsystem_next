/**
 * 群友语录自检（/quotes 页 + /api/quotes + 底部悬浮栏 + /admin/quotes）。
 *
 * 为什么不能只看 200：语录页是 SSR 出行 + 客户端删改，悬浮栏是纯客户端组件
 * （要等 800ms 才拉数据、7 秒才换一条），curl 什么都看不出来。
 *
 * 用法：
 *   node scripts/check-quotes.cjs                     # 本地 3006
 *   BASE=https://dota.playerallocationsystem.online node scripts/check-quotes.cjs
 *
 * 会写库：为了验「提交 → 出现 → 删掉」整条链路，脚本会真的收一条测试语录，
 * 跑完（含抛错）一定删掉。打线上时默认只跑只读部分，要远端写库必须
 * 显式 ALLOW_REMOTE=1（和 guild:pages / guild:ui 同一个口径）。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { loadEnvConfig } = require('@next/env');
const { chromium } = require('playwright');

loadEnvConfig(process.cwd(), false);

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
const OUT = path.join(process.cwd(), 'shots', 'quotes');
const NAME = String(process.env.ADMIN_NAMES || 'dom').split(',')[0].trim();
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE);
const ALLOW_WRITE = IS_LOCAL || process.env.ALLOW_REMOTE === '1';

// 打线上要先注入服务器那把 AUTH_SECRET（两边不是同一个），见 pitfalls 第 15 节
const cookie = () => {
  if (process.env.COOKIE) return process.env.COOKIE;
  const secret = crypto.createHash('sha256').update(String(process.env.AUTH_SECRET || 'x')).digest();
  const payload = Buffer.from(JSON.stringify({ n: NAME, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `dd_session=${payload}.${sig}`;
};

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = '') => {
  if (cond) pass += 1;
  else fail += 1;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail ? '  (' + detail + ')' : ''));
};

/** 只取 cookie 串里的会话值 —— 直接 replace 前缀的话，带多个 cookie 时会连别的键一起塞进去 */
const sessionValue = () => {
  const m = /dd_session=([^;]+)/.exec(cookie());
  return m ? m[1] : '';
};

const pad = (n) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const future = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const post = (body, withCookie = true) =>
  fetch(BASE + '/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(withCookie ? { cookie: cookie() } : {}) },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, d: await r.json().catch(() => ({})) }));

const del = (id) =>
  fetch(BASE + '/api/quotes/' + id, { method: 'DELETE', headers: { cookie: cookie() } }).then(
    async (r) => ({ status: r.status })
  );

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const created = [];
  const errs = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      // dev 的 HMR 断连、头像 404、以及未登录时 /api/guild 之类都不算页面问题
      if (/favicon|_next\/static|_next\/hmr|WebSocket|avatar|\.png|\.jpg|502/.test(t)) return;
      errs.push('[console] ' + t.slice(0, 160));
    });
  };

  try {
    // ---------- 1. 接口 ----------
    console.log('\n[接口 · /api/quotes]');
    const anon = await post({ content: '匿名能提吗', saidAt: today(), sourceText: '路人' }, false);
    ok(anon.status === 401, '未登录提交被拒', String(anon.status));

    if (ALLOW_WRITE) {
      const text = `自检用的一句话 ${Date.now()}`;
      const r1 = await post({ content: text, saidAt: today(), sourceText: '游戏内路人' });
      ok(r1.status === 201 && r1.d.success, '提交成功', String(r1.status));
      if (r1.d.quote) created.push(r1.d.quote.id);
      ok(r1.d.quote && r1.d.quote.saidAt === today(), '日期原样返回（没被时区退一天）', r1.d.quote && r1.d.quote.saidAt);
      ok(r1.d.quote && r1.d.quote.source.type === 'text', '自定义出处正确', r1.d.quote && r1.d.quote.source.text);

      const r2 = await post({ content: text.replace(/\s/g, '  ') + '。', saidAt: today(), sourceText: '游戏内路人' });
      ok(r2.status === 200 && r2.d.duplicate === true, '重复提交被识别（不报错）', r2.d.message || '');

      const players = await fetch(BASE + '/api/players').then((x) => x.json());
      const someone = (players.players || []).find((p) => p.nickname);
      if (someone) {
        const r3 = await post({ content: '冒名测试', saidAt: today(), sourceText: someone.nickname });
        ok(r3.status === 400 && /群友/.test(r3.d.error || ''), '自定义出处与群友重名被拦', r3.d.error);
      }

      const r4 = await post({ content: '未来语录', saidAt: future(), sourceText: '路人' });
      ok(r4.status === 400, '未来日期被拦', r4.d.error);

      const r5 = await post({ content: '。。。', saidAt: today(), sourceText: '路人' });
      ok(r5.status === 400, '纯标点被拦', r5.d.error);

      const r6 = await post({ content: '没写出处', saidAt: today() });
      ok(r6.status === 400, '出处为空被拦', r6.d.error);
    } else {
      console.log('  --   跳过写库断言（远端且未设 ALLOW_REMOTE=1）');
    }

    // ---------- 2. 语录页（匿名） ----------
    console.log('\n[页面 /quotes · 匿名]');
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    const pa = await ctxA.newPage();
    watch(pa);
    const resp = await pa.goto(BASE + '/quotes', { waitUntil: 'domcontentloaded', timeout: 60000 });
    ok(resp.status() === 200, '页面 200', String(resp.status()));
    await pa.waitForSelector('.quote-item', { timeout: 40000 }).catch(() => {});
    const items = await pa.locator('.quote-item').count();
    ok(items > 0, 'SSR 里就有语录条目', items + ' 条');
    ok((await pa.locator('.quote-month-label').count()) > 0, '按月分组标签存在');
    ok((await pa.locator('.quote-form').count()) === 0, '匿名看不到提交表单');
    ok((await pa.locator('.site-nav').count()) === 1, '页面只有一个 header（没有重复套 Layout）');
    ok((await pa.locator('.site-footer').count()) === 1, '页面只有一个 footer');
    // 有语录时不该出现空状态
    ok((await pa.locator('.quote-empty').count()) === 0, '有内容时不显示空态');

    const serif = await pa.evaluate(() => {
      const t = document.querySelector('.quote-text');
      return t ? getComputedStyle(t).fontFamily : '';
    });
    ok(/serif|Songti|SimSun|Georgia/i.test(serif), '正文用的是衬线字体', serif.slice(0, 40));

    const navOn = await pa.locator('header.site-nav .nav-links a.active').textContent().catch(() => '');
    ok((navOn || '').includes('群友语录'), '导航高亮「群友语录」', (navOn || '').trim());
    await pa.screenshot({ path: path.join(OUT, 'quotes-anon.png') });

    // ---------- 3. 提交链路（登录） ----------
    if (ALLOW_WRITE) {
      console.log('\n[提交链路 · 登录]');
      const ctxB = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
      await ctxB.addCookies([{ name: 'dd_session', value: sessionValue(), domain: new URL(BASE).hostname, path: '/' }]);
      const pb = await ctxB.newPage();
      watch(pb);
      await pb.goto(BASE + '/quotes', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pb.waitForSelector('.quote-item', { timeout: 40000 });
      // useSession 要等一次 /api/auth/me，goto 完立刻数会数到 0
      const plusReady = await pb
        .waitForSelector('button:has-text("+ 收一句")', { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      ok(plusReady, '登录后出现「+ 收一句」');

      await pb.click('button:has-text("+ 收一句")');
      await pb.waitForSelector('.quote-form', { timeout: 20000 });
      ok((await pb.locator('.quote-mode.is-on').textContent()) === '选群友', '默认落在「选群友」');

      await pb.fill('#quote-who', '無');
      await pb.waitForSelector('.quote-results button', { timeout: 20000 });
      ok((await pb.locator('.quote-results button').count()) > 0, '搜群友有结果');
      await pb.locator('.quote-results button').first().click();
      ok((await pb.locator('.quote-picked').count()) === 1, '选中后显示已选的人');
      await pb.locator('.quote-picked-x').click();

      await pb.click('.quote-mode:has-text("自己写")');
      const mark = `界面收录 ${Date.now()}`;
      await pb.fill('#quote-text-who', '群里某人');
      await pb.fill('#quote-content', mark);
      await pb.click('button:has-text("收录这句")');
      await pb.waitForTimeout(2500);
      const flashText = await pb.locator('.adm-msg').textContent().catch(() => '');
      ok((flashText || '').includes('收好了'), '提交后提示「收好了」', (flashText || '').trim());
      ok((await pb.locator('.quote-text', { hasText: mark }).count()) === 1, '新语录出现在列表里');

      // 从接口拿到刚建那条的 id，记下来待会清理
      const listed = await fetch(BASE + '/api/quotes?limit=100').then((x) => x.json());
      const mine = (listed.quotes || []).find((q) => q.content === mark);
      if (mine) created.push(mine.id);

      if (mine) {
        await del(mine.id);
        created.splice(created.indexOf(mine.id), 1);
        await pb.reload({ waitUntil: 'domcontentloaded' });
        await pb.waitForTimeout(1200);
        ok((await pb.locator('.quote-text', { hasText: mark }).count()) === 0, '删掉后从列表消失');
      }
      await ctxB.close();
    }

    // ---------- 4. 悬浮栏 ----------
    console.log('\n[底部悬浮栏]');
    const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const pc = await ctxC.newPage();
    watch(pc);
    await pc.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pc.waitForSelector('.quote-ticker', { timeout: 25000 }).catch(() => {});
    const hasBar = await pc.locator('.quote-ticker').count();
    ok(hasBar === 1, '首页出现底部语录栏', hasBar + ' 个');

    if (hasBar) {
      const first = ((await pc.locator('.quote-ticker-text').textContent()) || '').trim();
      const from = ((await pc.locator('.quote-ticker-from').textContent()) || '').trim();
      ok(first.length > 0, '第一句有内容', first.slice(0, 20) + ' / ' + from);

      const geo = await pc.evaluate(() => {
        const t = document.querySelector('.quote-ticker').getBoundingClientRect();
        const f = document.querySelector('.fb-fab').getBoundingClientRect();
        return { gap: Math.round(t.top - f.bottom), pad: getComputedStyle(document.body).paddingBottom };
      });
      ok(geo.gap > 0, '反馈浮球没压在语录栏上', 'gap=' + geo.gap + 'px');
      ok(geo.pad === '48px', 'body 给栏留了位置', geo.pad);
      await pc.screenshot({ path: path.join(OUT, 'ticker.png') });

      await pc.waitForTimeout(8000);
      const second = ((await pc.locator('.quote-ticker-text').textContent()) || '').trim();
      ok(second !== first, '过了 7 秒换了一条', second.slice(0, 20));

      await pc.click('.quote-ticker-x');
      await pc.waitForTimeout(500);
      ok((await pc.locator('.quote-ticker').count()) === 0, '点 × 后消失');
      const pad0 = await pc.evaluate(() => getComputedStyle(document.body).paddingBottom);
      ok(pad0 === '0px', '关闭后不留空档', pad0);

      await pc.reload({ waitUntil: 'domcontentloaded' });
      await pc.waitForTimeout(2200);
      ok((await pc.locator('.quote-ticker').count()) === 0, '刷新后不再出现');

      // 语录页自己不显示
      await pc.evaluate(() => localStorage.removeItem('laroja-quotes-bar'));
      await pc.goto(BASE + '/quotes', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pc.waitForTimeout(2500);
      ok((await pc.locator('.quote-ticker').count()) === 0, '语录页不显示悬浮栏');
    }

    // ---------- 5. 夜间 / 手机 ----------
    console.log('\n[夜间 / 手机]');
    const ctxD = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    await ctxD.addInitScript(() => {
      try {
        localStorage.setItem('laroja-theme', 'dark');
        localStorage.removeItem('laroja-quotes-bar');
      } catch (e) {}
    });
    const pd = await ctxD.newPage();
    watch(pd);
    await pd.goto(BASE + '/quotes', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pd.waitForSelector('.quote-item', { timeout: 40000 });
    await pd.waitForTimeout(900);
    const darkOk = await pd.evaluate(() => {
      const t = document.querySelector('.quote-text');
      const bg = document.body;
      return { color: getComputedStyle(t).color, attr: document.documentElement.getAttribute('data-theme') };
    });
    ok(darkOk.attr === null, '夜间主题确实生效（没有 data-theme）', String(darkOk.attr));
    await pd.screenshot({ path: path.join(OUT, 'quotes-dark.png') });

    const ctxM = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const pm = await ctxM.newPage();
    watch(pm);
    await pm.goto(BASE + '/quotes', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pm.waitForSelector('.quote-item', { timeout: 40000 });
    await pm.waitForTimeout(700);
    const mOver = await pm.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    ok(mOver <= 1, '手机端语录页无横向溢出', mOver + 'px');
    const metaOver = await pm.evaluate(() => {
      const m = document.querySelector('.quote-meta');
      return m ? m.scrollWidth - m.clientWidth : 0;
    });
    ok(metaOver <= 1, '手机端元信息行不溢出', metaOver + 'px');
    await pm.screenshot({ path: path.join(OUT, 'quotes-mobile.png') });

    const mHome = await ctxM.newPage();
    await mHome.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await mHome.waitForSelector('.quote-ticker', { timeout: 25000 }).catch(() => {});
    await mHome.waitForTimeout(900);
    const mBar = await mHome.evaluate(() => {
      const t = document.querySelector('.quote-ticker');
      if (!t) return null;
      const f = document.querySelector('.fb-fab').getBoundingClientRect();
      return { h: Math.round(t.getBoundingClientRect().height), gap: Math.round(t.getBoundingClientRect().top - f.bottom) };
    });
    ok(!!mBar, '手机端悬浮栏出现');
    ok(mBar && mBar.h >= 50 && mBar.h <= 56, '手机端栏高在 50~56', mBar && mBar.h + 'px');
    ok(mBar && mBar.gap > 0, '手机上浮球也没被压住', mBar && 'gap=' + mBar.gap + 'px');
    await mHome.screenshot({ path: path.join(OUT, 'ticker-mobile.png') });

    // ---------- 6. 后台 ----------
    console.log('\n[后台 /admin/quotes]');
    const ctxE = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctxE.addCookies([
      { name: 'dd_session', value: sessionValue(), domain: new URL(BASE).hostname, path: '/' },
    ]);
    const pe = await ctxE.newPage();
    watch(pe);
    const ar = await pe.goto(BASE + '/admin/quotes', { waitUntil: 'domcontentloaded', timeout: 60000 });
    ok(ar.status() === 200, '后台页 200', String(ar.status()));
    await pe.waitForSelector('.adm-data tbody tr', { timeout: 40000 }).catch(() => {});
    ok((await pe.locator('.adm-data tbody tr').count()) > 0, '后台表格有行');
    const onNav = await pe.locator('.adm-nav-link.is-on').textContent().catch(() => '');
    ok((onNav || '').includes('语录'), '后台导航高亮「语录」', (onNav || '').trim());
    await pe.screenshot({ path: path.join(OUT, 'admin-quotes.png') });
  } catch (e) {
    ok(false, '脚本异常', e.message);
  } finally {
    // 清理：只删自己建的
    for (const id of created) {
      try {
        await del(id);
      } catch {
        /* 已经不存在就算了 */
      }
    }
    if (created.length) console.log(`\n清理了 ${created.length} 条测试语录`);
    console.log('\nconsole 错误:', errs.length ? errs.slice(0, 4) : '无');
    console.log(`\n结果：${pass} 通过 / ${fail} 失败${ALLOW_WRITE ? '' : '（只读模式）'}`);
    await browser.close();
    process.exitCode = fail ? 1 : 0;
  }
})();
