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

  const name = (await p.locator('.map-panel-name').first().textContent().catch(() => '')) || '';
  ok(name.includes('南山区'), '右栏还原到南山区', '实际 ' + name.trim());

  const stat = ((await p.locator('.map-panel-stat').first().textContent().catch(() => '')) || '')
    .replace(/\s+/g, ' ')
    .trim();
  ok(/\b9\b/.test(stat) && /\b55\b/.test(stat), '统计行显示 9 位群友 / 55 家美食', stat);

  const members = await p.locator('.map-member').count();
  ok(members === 9, '群友列表 9 人', '实际 ' + members);

  const avatars = await p.locator('.map-member-avatar').count();
  ok(avatars === members, '每人一个头像位', avatars + '/' + members);

  const foods = await p.locator('.map-food').count();
  ok(foods === 14, '美食最多列 14 家', '实际 ' + foods);

  const rcs = await p.locator('.map-food-rc').count();
  ok(rcs === foods, '每家都有评价数标签', rcs + '/' + foods);

  const quotes = await p.locator('.map-food-quote').count();
  ok(quotes > 0, '有评价引文', '实际 ' + quotes);

  const firstRc = ((await p.locator('.map-food-rc').first().textContent().catch(() => '')) || '').trim();
  ok(!firstRc.includes('暂无'), '首条美食已有评价（按评价数排序生效）', firstRc);

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
