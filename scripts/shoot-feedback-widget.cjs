#!/usr/bin/env node
/**
 * 反馈浮窗「我的反馈」自检 + 截图。
 *
 * 要点：面板里的列表是客户端按 localStorage 的设备串去拉的，
 * 所以在浏览器里必须先把这个串塞进去，才能看到测试数据。
 * 用 addInitScript 在页面脚本之前写 localStorage，比登录后再塞更稳
 * （不会出现「先渲染空态、再闪出列表」的中间态）。
 *
 * 用法：
 *   COOKIE="dd_session=..." node scripts/shoot-feedback-widget.cjs
 */
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'https://dota.playerallocationsystem.online';
const COOKIE = process.env.COOKIE || '';
const OUT = path.join(process.cwd(), 'shots');

const host = new URL(BASE).hostname;
const token = 'uitest' + Date.now().toString(36);
const MARK = '【浮窗自检】';

let failed = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`✅ ${label}${extra ? ' — ' + extra : ''}`);
  else {
    failed += 1;
    console.log(`❌ ${label}${extra ? ' — ' + extra : ''}`);
  }
};

async function api(pathname, { method = 'GET', body, admin = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (admin && COOKIE) headers.Cookie = COOKIE;
  const res = await fetch(BASE + pathname, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

(async () => {
  // —— 准备两条数据：一条有回复、一条待处理 ——
  // 文案里必须带本次运行唯一的后缀：接口对「同 IP + 同分类 + 同内容」
  // 10 分钟内最多收 3 条，重复跑同一个脚本会被去重成 deduped（无 id）。
  const uniq = Math.random().toString(36).slice(2, 6);
  const a = await api('/api/support', {
    method: 'POST',
    body: {
      kind: 'feedback',
      category: 'bug',
      message: `${MARK}手机上群友信息页偶尔一片空白，下拉刷新才出来，电信卡。(${uniq})`,
      client_token: token,
      detail: { form: '问题反馈' },
    },
  });
  const b = await api('/api/support', {
    method: 'POST',
    body: {
      kind: 'feedback',
      category: 'feature',
      message: `${MARK}希望赛事页能看到每一局的经济曲线，比只看 KDA 直观。(${uniq})`,
      client_token: token,
      detail: { form: '功能建议' },
    },
  });
  const idA = a.json && a.json.id;
  const idB = b.json && b.json.id;
  if (!idA || !idB) {
    console.error('造数失败，无法继续：', JSON.stringify(a.json), JSON.stringify(b.json));
    process.exit(1);
  }
  console.log(`造数：A=${idA}（会回复） B=${idB}（保持待处理） token=${token}`);

  if (COOKIE && idA) {
    await api('/api/support', {
      method: 'PATCH',
      admin: true,
      body: {
        id: idA,
        status: 'done',
        reply: '查到了，是页面加载时请求被浏览器缓存挡了一下。已经改成每次都回服务器确认，刷新试试。',
      },
    });
  }

  const cookies = COOKIE
    ? COOKIE.split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((kv) => {
          const i = kv.indexOf('=');
          return {
            name: kv.slice(0, i).trim(),
            value: kv.slice(i + 1).trim(),
            domain: host,
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax',
          };
        })
    : [];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (cookies.length) await ctx.addCookies(cookies);
  await ctx.addInitScript((tk) => {
    try {
      window.localStorage.setItem('laroja-fb-token', tk);
      // 清掉已读时间 → 有回复的那条会带「新回复」标记
      window.localStorage.removeItem('laroja-fb-seen');
    } catch (e) {
      /* 忽略 */
    }
  }, token);

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE + '/members', { waitUntil: 'networkidle' });
  await page.waitForSelector('.fb-fab', { timeout: 15000 });
  const dot = await page.locator('.fb-fab-dot').count();
  ok(true, '浮窗按钮已渲染', `未读点=${dot}`);

  await page.locator('.fb-fab').click();
  await page.waitForSelector('.fb-panel', { timeout: 8000 });
  ok((await page.locator('.fb-tab').count()) === 2, '有「写反馈 / 我的反馈」两个 tab');
  await page.screenshot({ path: path.join(OUT, 'fb-write.png') });

  await page.locator('.fb-tab').nth(1).click();
  await page.waitForSelector('.fb-mine-row', { timeout: 12000 });
  const rows = await page.locator('.fb-mine-row').count();
  ok(rows >= 2, '我的反馈里列出了提交过的记录', `${rows} 条`);

  const badges = await page.locator('.fb-st').allInnerTexts();
  ok(badges.some((t) => t.includes('待处理')), '显示「待处理」状态', badges.join(' / '));

  const box = await page.locator('.fb-panel').boundingBox();
  ok(!!box && box.height > 120, '面板高度正常（没被内容撑破）', box ? Math.round(box.height) + 'px' : '?');
  await page.screenshot({ path: path.join(OUT, 'fb-mine.png') });

  // 展开「已处理」那条，看留言是否显示。
  // 注意不能直接点第一条：列表按时间倒序，最新的那条通常还没回复。
  const doneRow = page.locator('.fb-mine-row').filter({ has: page.locator('.fb-st.s-done') }).first();
  const target = (await doneRow.count()) ? doneRow : page.locator('.fb-mine-row').first();
  await target.click();
  await page.waitForSelector('.fb-mine-body', { timeout: 5000 });
  const reply = await page.locator('.fb-reply-body').first().innerText().catch(() => '');
  ok(!!reply.trim(), '展开后能看到管理员留言', reply.slice(0, 24) + '…');
  const bodyBox = await page.locator('.fb-mine-item.is-open').boundingBox();
  ok(!!bodyBox && bodyBox.height > 60, '展开区间有高度', bodyBox ? Math.round(bodyBox.height) + 'px' : '?');
  await page.screenshot({ path: path.join(OUT, 'fb-mine-open.png') });

  // 手机端：单独开一个 390 宽的 context。
  // 在桌面 context 里对已有 page 调 setViewportSize 时，实测会残留一部分
  // 桌面布局（媒体查询已生效但部分块没重排），报出假的「横向溢出」。
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  if (COOKIE) await mctx.addCookies(cookies);
  await mctx.addInitScript((tk) => {
    try {
      window.localStorage.setItem('laroja-fb-token', tk);
      window.localStorage.removeItem('laroja-fb-seen');
    } catch (e) {
      /* 忽略 */
    }
  }, token);
  const mp = await mctx.newPage();
  await mp.goto(BASE + '/members', { waitUntil: 'networkidle' });
  await mp.locator('.fb-fab').click();
  await mp.locator('.fb-tab').nth(1).click();
  await mp.waitForSelector('.fb-mine-row', { timeout: 12000 });
  const mbox = await mp.locator('.fb-panel').boundingBox();
  ok(!!mbox && mbox.width <= 390, '手机端面板不溢出', mbox ? Math.round(mbox.width) + 'px' : '?');
  await mp.locator('.fb-mine-row').first().click();
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: path.join(OUT, 'fb-mine-mobile.png') });
  // 用 clientWidth 比：手机上出现纵向滚动条时 innerWidth 会比可用宽度大，
  // 拿 innerWidth 当基准会报出假的「横向溢出」。
  const overflow = await mp.evaluate(() => {
    const avail = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll('*')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > avail + 1 || r.left < -1);
      })
      .map((el) => el.tagName + '.' + String(el.className || '').slice(0, 30));
    return { avail, scrollW: document.documentElement.scrollWidth, wide: wide.slice(0, 5) };
  });
  ok(
    overflow.scrollW <= overflow.avail + 1,
    '手机端无横向滚动',
    `滚动宽 ${overflow.scrollW} / 可用 ${overflow.avail}${
      overflow.wide.length ? ' · 越界: ' + overflow.wide.join(', ') : ''
    }`
  );

  ok(errors.length === 0, '无 JS 运行时错误', errors.join(' | '));

  await browser.close();
  console.log(`\n清理：DELETE FROM public.support_reports WHERE id IN (${idA}, ${idB});`);
  console.log(failed ? `${failed} 项未通过` : '全部通过');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('脚本异常:', e.message);
  process.exit(1);
});
