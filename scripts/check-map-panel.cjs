/**
 * 群友分布右栏的回归检查：新面板 + 美食评价 + ?dist= 选区还原 + 活动页可渲染。
 *
 * 为什么单独一个脚本：2026-10-23 两条开发线撞在一起，右栏被对方整块重写，
 * 合并时要保证「三级下钻」和「右栏新面板」同时活着。check-map-levels.cjs 只验
 * 层级与几何，验不到右栏结构，所以补这个。
 *
 * 用法：BASE=https://dota.playerallocationsystem.online node scripts/check-map-panel.cjs
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errors = [];
  // HMR / favicon 之类不算；只收真正的页面错误
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|_next\/static|WebSocket/i.test(t)) return;
    errors.push(t);
  });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  let fail = 0;
  const ok = (cond, msg, extra = '') => {
    console.log((cond ? '  ok   ' : '  FAIL ') + msg + (extra ? '  (' + extra + ')' : ''));
    if (!cond) fail++;
  };

  // ---- A. ?dist= 直接还原 + 右栏面板 ----
  console.log('[A] /map?adcode=440300&dist=南山区（直接带参数进来）');
  await p.goto(`${BASE}/map?adcode=440300&dist=${encodeURIComponent('南山区')}`, {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  await p.waitForTimeout(1500);

  // 数量从接口取，别写死 —— 群友和美食是会变的，写死会误报
  const api = await fetch(`${BASE}/api/map/geo?adcode=440300`).then((r) => r.json());
  const ns = (api.areas || []).find((a) => a.name === '南山区') || {};
  const expMembers = ns.playerCount || 0;
  const expFoods = ns.foodCount || 0;

  const name = (await p.locator('.map-panel-name').first().textContent().catch(() => '')) || '';
  ok(name.includes('南山区'), '右栏还原到南山区', '实际 ' + name.trim());

  const stat = ((await p.locator('.map-panel-stat').first().textContent().catch(() => '')) || '')
    .replace(/\s+/g, ' ')
    .trim();
  ok(stat.includes(String(expMembers)) && stat.includes(String(expFoods)), '统计行与接口一致', stat);

  const members = await p.locator('.map-member').count();
  ok(members === expMembers, '群友全部列出', `${members}/${expMembers}`);

  const avatars = await p.locator('.map-member-avatar').count();
  ok(avatars === members, '每人一个头像位', avatars + '/' + members);

  // 以前这里写死 14 —— 右栏只列 14 家、其余让人跳去 /food。现在要求全部列出并可滚动。
  const foods = await p.locator('.map-food').count();
  ok(foods === expFoods, '美食全部列出（不再截断）', `${foods}/${expFoods}`);
  ok(foods > 14, '确认超过旧的 14 家上限', foods + ' 家');

  const rcs = await p.locator('.map-food-rc').count();
  ok(rcs === foods, '每家都有评价数标签', rcs + '/' + foods);

  const quotes = await p.locator('.map-food-quote').count();
  ok(quotes > 0, '有评价引文', '实际 ' + quotes);

  const firstRc = ((await p.locator('.map-food-rc').first().textContent().catch(() => '')) || '').trim();
  ok(!firstRc.includes('暂无'), '首条美食已有评价（按评价数排序生效）', firstRc);

  // ---- 滚动：内容超出时能滚，且滚到底能看到最后一家 ----
  const scroll = await p.evaluate(() => {
    const el = document.querySelector('.map-food-list');
    if (!el) return { ok: false, why: '没有 .map-food-list' };
    const sy = getComputedStyle(el).overflowY;
    return {
      ok: el.scrollHeight > el.clientHeight && /auto|scroll/.test(sy),
      why: `scrollHeight=${el.scrollHeight} clientHeight=${el.clientHeight} overflowY=${sy}`,
    };
  });
  ok(scroll.ok, '美食列表可滚动（不被截断）', scroll.why);

  const lastVisible = await p.evaluate(() => {
    const el = document.querySelector('.map-food-list');
    if (!el) return false;
    el.scrollTop = el.scrollHeight;
    const items = el.querySelectorAll('.map-food');
    const last = items[items.length - 1];
    if (!last) return false;
    const r = last.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    return r.top >= c.top - 2 && r.bottom <= c.bottom + 2;
  });
  ok(lastVisible, '滚到底能看到最后一家（能看全）');

  const memberScroll = await p.evaluate(() => {
    const el = document.querySelector('.map-member-list');
    if (!el) return false;
    const sy = getComputedStyle(el).overflowY;
    return /auto|scroll/.test(sy);
  });
  ok(memberScroll, '群友列表也带滚动（人多时可看全）');

  // ---- B. 点区块把选区写回地址栏 ----
  console.log('\n[B] 点列表里的「南山区」，看 URL 是否写入 dist');
  await p.goto(`${BASE}/map?adcode=440300`, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(1000);
  const chip = p.locator('button', { hasText: '南山区' }).first();
  await chip.click();
  await p.waitForTimeout(1200);
  const url = decodeURIComponent(p.url());
  ok(/dist=南山区/.test(url), 'URL 写入 dist=南山区', url.split('/map')[1] || '');
  ok(/adcode=440300/.test(url), 'URL 同时保留 adcode=440300（层级不丢）', url.split('/map')[1] || '');

  // ---- C. 活动功能（那条线的成果）仍在 ----
  // ⚠ 活动表 activity_posts 目前 0 行，页面是空状态 —— 这时不该要求有 .act-type 徽标。
  //   这条只验「路由能挂载、页面能渲染、没有 500」，数据为空是真实状态不是 bug。
  console.log('\n[C] /activities 活动页（当前库里 0 条活动，只验能渲染）');
  const resp = await p.goto(`${BASE}/activities`, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(1000);
  ok(resp && resp.status() === 200, '活动页 HTTP 200', '实际 ' + (resp ? resp.status() : '无响应'));
  const text = ((await p.locator('main, .wrap').first().textContent().catch(() => '')) || '').trim();
  ok(text.length > 30, '活动页渲染出内容（含空状态文案）', text.length + ' 字');
  const actTypes = await p.locator('.act-type').count();
  console.log('       提示：活动类型徽标 ' + actTypes + ' 个（0 条数据时为 0 属正常）');

  ok(errors.length === 0, 'console 无报错', errors.slice(0, 2).join(' | '));

  await p.goto(`${BASE}/map?adcode=440300&dist=${encodeURIComponent('南山区')}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: 'shots/merged-map-south.png' });

  console.log('\n' + (fail ? `失败 ${fail} 项` : '全部通过'));
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
