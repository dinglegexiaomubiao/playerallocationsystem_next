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
let skipped = 0;
const ok = (cond, label, detail = '') => {
  if (cond) pass += 1;
  else fail += 1;
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail ? '  (' + detail + ')' : ''));
};

/**
 * 跳过 ≠ 通过。库里一句语录都没有的时候（新站点、或刚清库），
 * 「SSR 里就有条目」「按月分组」「衬线正文」「悬浮栏出现」这几条必然不成立 ——
 * 那不是 bug，是没数据。打线上只读时尤其常见，所以标成 -- 而不是 FAIL，
 * 否则每次空库都红 6 条，真出问题反而看不出来。
 */
const skip = (label, detail = '') => {
  skipped += 1;
  console.log('  --   ' + label + (detail ? '  (' + detail + ')' : ''));
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
    // 先探一次库里有没有语录 —— 后面好几条断言成不成立，取决于这个。
    // ⚠ 这是**快照**，写库段会真的往里塞一条，所以写完之后必须重探（见下面 if (ALLOW_WRITE) 之后）。
    const probe = async () => {
      const p = await fetch(BASE + '/api/quotes')
        .then((r) => r.json())
        .catch(() => ({}));
      return { empty: !p.total, total: p.total || 0, people: p.people || 0 };
    };
    let st = await probe();
    let EMPTY = st.empty;
    const showState = (tag = '库状态') =>
      console.log(
        '\n[' + tag + ']  ' + (st.empty ? '空（只有空态可验）' : st.total + ' 句 / ' + st.people + ' 位群友')
      );
    showState();

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

    // 写库模式刚往库里塞了一条（要等 finally 才删），前面那份空状态已经过期。
    // 不重探的话，下面页面段会拿「库是空的」去断言有内容的页面 —— 必红。
    if (ALLOW_WRITE) {
      st = await probe();
      EMPTY = st.empty;
      showState('库状态 · 写入后重探');
    }

    // ---------- 2. 语录页（匿名） ----------
    console.log('\n[页面 /quotes · 匿名]');
    const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    const pa = await ctxA.newPage();
    watch(pa);
    const resp = await pa.goto(BASE + '/quotes', { waitUntil: 'domcontentloaded', timeout: 60000 });
    ok(resp.status() === 200, '页面 200', String(resp.status()));
    await pa.waitForSelector(EMPTY ? '.quote-empty' : '.quote-item', { timeout: 40000 }).catch(() => {});
    const items = await pa.locator('.quote-item').count();
    const emptyBox = await pa.locator('.quote-empty').count();
    ok((await pa.locator('.quote-form').count()) === 0, '匿名看不到提交表单');
    ok((await pa.locator('.site-nav').count()) === 1, '页面只有一个 header（没有重复套 Layout）');
    ok((await pa.locator('.site-footer').count()) === 1, '页面只有一个 footer');
    if (EMPTY) {
      ok(items === 0, '空库时不出条目', items + ' 条');
      ok(emptyBox === 1, '空库时显示空态');
      skip('按月分组标签存在', '库是空的');
      skip('正文用的是衬线字体', '库是空的，没有正文');
    } else {
      ok(items > 0, 'SSR 里就有语录条目', items + ' 条');
      ok((await pa.locator('.quote-month-label').count()) > 0, '按月分组标签存在');
      ok(emptyBox === 0, '有内容时不显示空态');
      const serif = await pa.evaluate(() => {
        const t = document.querySelector('.quote-text');
        return t ? getComputedStyle(t).fontFamily : '';
      });
      ok(/serif|Songti|SimSun|Georgia/i.test(serif), '正文用的是衬线字体', serif.slice(0, 40));
    }

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

    // ---------- 3.5 评价接口（登录） ----------
    if (ALLOW_WRITE) {
      console.log('\n[评价接口 · /api/quotes/:id/reviews]');
      const rq = await post({ content: `评价测试语录 ${Date.now()}`, saidAt: today(), sourceText: '游戏内路人' });
      ok(rq.status === 201 && rq.d.quote, '评价测试语录建好', String(rq.status));
      const qid = rq.d.quote ? rq.d.quote.id : null;
      if (qid) created.push(qid);

      const anonRev = await fetch(BASE + '/api/quotes/' + qid + '/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: 4, comment: '匿名不行' }),
      });
      ok(anonRev.status === 401, '未登录评价被拒', String(anonRev.status));

      const rev = await fetch(BASE + '/api/quotes/' + qid + '/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie() },
        body: JSON.stringify({ score: 4.5, comment: '这条有意思' }),
      });
      const revD = await rev.json().catch(() => ({}));
      ok(rev.status === 201 && revD.review && revD.review.score === 4.5, '半星评价提交成功', String(rev.status));
      ok(
        revD.ratingCount === 1 && Math.abs((revD.ratingAvg || 0) - 4.5) < 0.01,
        '平均分/人数已更新',
        `avg=${revD.ratingAvg} n=${revD.ratingCount}`
      );

      const bad1 = await fetch(BASE + '/api/quotes/' + qid + '/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie() },
        body: JSON.stringify({ score: 6 }),
      });
      ok(bad1.status === 400, '超过 5 分被拦', String(bad1.status));
      const bad2 = await fetch(BASE + '/api/quotes/' + qid + '/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie() },
        body: JSON.stringify({ score: 2.3 }),
      });
      ok(bad2.status === 400, '非 0.5 步进被拦', String(bad2.status));

      // 一人一评：重复提交走 upsert，人数不涨
      const rev2 = await fetch(BASE + '/api/quotes/' + qid + '/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: cookie() },
        body: JSON.stringify({ score: 3, comment: '改主意了' }),
      });
      const rev2D = await rev2.json().catch(() => ({}));
      ok(
        rev2.status === 201 && rev2D.review && rev2D.review.score === 3 && rev2D.ratingCount === 1,
        '改评覆盖旧评价（人数不涨）',
        `score=${rev2D.review && rev2D.review.score} n=${rev2D.ratingCount}`
      );

      const listR = await fetch(BASE + '/api/quotes/' + qid + '/reviews', {
        headers: { cookie: cookie() },
      }).then((r) => r.json());
      ok(
        (listR.reviews || []).length === 1 && listR.myReview && listR.myReview.score === 3,
        '列表返回 1 条且「我的评价」正确',
        (listR.reviews || []).length + ' 条'
      );

      // 后台评价管理：能列出来、能删
      const admList = await fetch(BASE + '/api/admin/quotes-reviews', {
        headers: { cookie: cookie() },
      }).then((r) => r.json());
      ok(
        admList.ok && (admList.reviews || []).some((x) => x.id === (rev2D.review && rev2D.review.id)),
        '后台能列出这条评价',
        'ok=' + admList.ok
      );
      const delR = await fetch(BASE + '/api/admin/quotes-reviews', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', cookie: cookie() },
        body: JSON.stringify({ id: rev2D.review.id }),
      });
      const delD = await delR.json().catch(() => ({}));
      ok(delR.status === 200 && delD.ok, '后台能删这条评价', String(delR.status));

      const afterDel = await fetch(BASE + '/api/quotes/' + qid + '/reviews', {
        headers: { cookie: cookie() },
      }).then((r) => r.json());
      ok(afterDel.ratingCount === 0, '删评价后平均分人数归零', 'n=' + afterDel.ratingCount);

      // 页面侧：每条语录都渲染了评价区
      const ctxR = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 2,
      });
      await ctxR.addCookies([
        { name: 'dd_session', value: sessionValue(), domain: new URL(BASE).hostname, path: '/' },
      ]);
      const pr = await ctxR.newPage();
      watch(pr);
      await pr.goto(BASE + '/quotes', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await pr.waitForSelector('.quote-reviews', { timeout: 40000 }).catch(() => {});
      const rvCount = await pr.locator('.quote-reviews').count();
      ok(rvCount > 0, '语录页每条都渲染评价区', rvCount + ' 个');
      await pr.screenshot({ path: path.join(OUT, 'quotes-reviews.png') });
      await ctxR.close();
    }

    // ---------- 4. 悬浮栏 ----------
    // 门槛是「至少 3 条」，不是「空 / 非空」—— 得重新探，不能沿用页面段的状态
    console.log('\n[底部悬浮栏]');
    st = await probe();
    const ENOUGH = st.total >= 3;
    if (!ENOUGH) console.log('  （库里 ' + st.total + ' 条，不足 3 条，验的是「不该出现」）');
    const ctxC = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const pc = await ctxC.newPage();
    watch(pc);
    await pc.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    // 少于 3 条本来就不显示 —— 这时只等一小会儿，确认它确实没冒出来
    await pc.waitForSelector('.quote-ticker', { timeout: ENOUGH ? 25000 : 3500 }).catch(() => {});
    const hasBar = await pc.locator('.quote-ticker').count();
    if (ENOUGH) ok(hasBar === 1, '首页出现底部语录栏', hasBar + ' 个');
    else ok(hasBar === 0, '语录不足 3 条时不出现悬浮栏', hasBar + ' 个');

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
    await pd.waitForSelector(EMPTY ? '.quote-empty' : '.quote-item', { timeout: 40000 }).catch(() => {});
    await pd.waitForTimeout(900);
    const darkOk = await pd.evaluate(() => {
      const t = document.querySelector('.quote-text') || document.querySelector('.quote-empty p');
      const bg = document.body;
      return {
        color: t ? getComputedStyle(t).color : '',
        attr: document.documentElement.getAttribute('data-theme'),
      };
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
    await pm.waitForSelector(EMPTY ? '.quote-empty' : '.quote-item', { timeout: 40000 }).catch(() => {});
    await pm.waitForTimeout(700);
    const mOver = await pm.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    ok(mOver <= 1, '手机端语录页无横向溢出', mOver + 'px');
    if ((await pm.locator('.quote-meta').count()) === 0) {
      skip('手机端元信息行不溢出', '没有条目');
    } else {
      const metaOver = await pm.evaluate(() => {
        const m = document.querySelector('.quote-meta');
        return m ? m.scrollWidth - m.clientWidth : 0;
      });
      ok(metaOver <= 1, '手机端元信息行不溢出', metaOver + 'px');
    }
    await pm.screenshot({ path: path.join(OUT, 'quotes-mobile.png') });

    const mHome = await ctxM.newPage();
    await mHome.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await mHome.waitForSelector('.quote-ticker', { timeout: ENOUGH ? 25000 : 3500 }).catch(() => {});
    await mHome.waitForTimeout(900);
    const mBar = await mHome.evaluate(() => {
      const t = document.querySelector('.quote-ticker');
      if (!t) return null;
      const f = document.querySelector('.fb-fab').getBoundingClientRect();
      return { h: Math.round(t.getBoundingClientRect().height), gap: Math.round(t.getBoundingClientRect().top - f.bottom) };
    });
    if (!ENOUGH) {
      ok(!mBar, '手机端也不出现悬浮栏（不足 3 条）');
    } else {
      ok(!!mBar, '手机端悬浮栏出现');
      ok(mBar && mBar.h >= 50 && mBar.h <= 56, '手机端栏高在 50~56', mBar && mBar.h + 'px');
      ok(mBar && mBar.gap > 0, '手机上浮球也没被压住', mBar && 'gap=' + mBar.gap + 'px');
    }
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
    const rows = await pe.locator('.adm-data tbody tr').count();
    if (EMPTY) skip('后台表格有行', '库是空的（空表可能渲染空态行或 0 行）');
    else ok(rows > 0, '后台表格有行', rows + ' 行');
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
    console.log(`\n结果：${pass} 通过 / ${fail} 失败${skipped ? ` / ${skipped} 跳过` : ''}${
      ALLOW_WRITE ? '' : '（只读模式）'
    }`);
    await browser.close();
    process.exitCode = fail ? 1 : 0;
  }
})();
