/**
 * 「各区人数」卡片里的层级导航：返回上一级 / 进入下一级。
 *
 * 为什么要单独测：地图上点区块的语义是「能下钻就下钻、不能就选中」，
 * 而人数列表里的 chip 只负责选中、不下钻。用户希望在列表里直接上下走，
 * 于是卡片里加了两个按钮 —— 这两种交互的状态容易互相干扰，要一起验。
 *
 * 用法：BASE=https://dota.playerallocationsystem.online node scripts/check-map-step.cjs
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
const SHOT_DIR = process.env.SHOT_DIR || 'shots';

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let fail = 0;

  const ok = (cond, msg, extra = '') => {
    console.log((cond ? '  ok   ' : '  FAIL ') + msg + (extra ? '  (' + extra + ')' : ''));
    if (!cond) fail++;
  };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|_next\/static|WebSocket/i.test(t)) return;
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const backBtn = () => page.locator('.map-step-btn').nth(0);
  const intoBtn = () => page.locator('.map-step-btn').nth(1);
  const scopeName = async () =>
    ((await page.locator('.map-crumb-now').first().textContent().catch(() => '')) || '').trim();

  const waitScope = async (name) => {
    try {
      await page.waitForFunction(
        (n) => {
          const el = document.querySelector('.map-crumb-now');
          return el && el.textContent.includes(n);
        },
        name,
        { timeout: 12000 }
      );
      return true;
    } catch {
      return false;
    }
  };

  // ---------- [1] 深圳市：父级是广东省，各区不设下级 ----------
  console.log('[1] /map?adcode=440300（深圳市）');
  await page.goto(`${BASE}/map?adcode=440300`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);

  ok((await page.locator('.map-step-btn').count()) === 2, '人数卡片里有两个层级按钮');
  ok(!(await backBtn().isDisabled()), '「返回上一级」可用');
  ok(((await backBtn().textContent()) || '').includes('广东省'), '按钮标出目标「广东省」');
  ok(await intoBtn().isDisabled(), '深圳各区不设下级 →「进入下一级」禁用');

  await page.screenshot({ path: `${SHOT_DIR}/map-step-sz.png` });

  // ---------- [2] 点返回，退到广东省 ----------
  console.log('\n[2] 点「返回上一级」');
  await backBtn().click();
  const wentUp = await waitScope('广东省');
  ok(wentUp, '退回广东省', await scopeName());

  // ---------- [3] 广东省：选中广州市后可以下钻 ----------
  console.log('\n[3] 在广东省选中「广州市」');
  const gz = page.locator('.map-rank-chip', { hasText: '广州市' }).first();
  ok((await gz.count()) === 1, '人数列表里有广州市');
  await gz.click();
  await page.waitForTimeout(600);
  ok(!(await intoBtn().isDisabled()), '选中广州市后「进入下一级」可用');
  ok(((await intoBtn().textContent()) || '').includes('广州市'), '按钮标出目标「广州市」');

  await page.screenshot({ path: `${SHOT_DIR}/map-step-gd.png` });

  // ---------- [4] 点进入，下钻到广州市 ----------
  console.log('\n[4] 点「进入下一级」');
  await intoBtn().click();
  const wentDown = await waitScope('广州市');
  ok(wentDown, '进入广州市', await scopeName());
  const areaChips = await page.locator('.map-rank-chip').count();
  ok(areaChips > 3, '广州市显示其下级区', areaChips + ' 个');

  // ---------- [5] 叶子级：东莞市不设区县，进入必须禁用 ----------
  console.log('\n[5] 广东省里选「东莞市」（不设下级）');
  await page.goto(`${BASE}/map?adcode=440000`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);
  const dg = page.locator('.map-rank-chip', { hasText: '东莞市' }).first();
  await dg.click();
  await page.waitForTimeout(500);
  ok(await intoBtn().isDisabled(), '东莞市不设区县 →「进入下一级」禁用');
  const hint = ((await page.locator('.map-step-hint').first().textContent().catch(() => '')) || '').trim();
  ok(hint.includes('没有下级') || hint.includes('不设'), '给出「没有下级」的说明', hint);

  // ---------- [6] 全国：返回必须禁用 ----------
  console.log('\n[6] /map?adcode=100000（全国）');
  await page.goto(`${BASE}/map?adcode=100000`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);
  ok(await backBtn().isDisabled(), '全国是最上一级 →「返回上一级」禁用');

  // ---------- [7] 手机端不溢出 ----------
  console.log('\n[7] 手机端');
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mp = await mctx.newPage();
  await mp.goto(`${BASE}/map?adcode=440300`, { waitUntil: 'networkidle', timeout: 60000 });
  await mp.waitForTimeout(1200);
  const overflow = await mp.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  ok(overflow <= 0, '手机端无横向溢出', overflow + 'px');
  await mp.screenshot({ path: `${SHOT_DIR}/map-step-mobile.png`, fullPage: false });

  ok(errors.length === 0, 'console 无报错', errors.slice(0, 2).join(' | '));

  console.log('\n' + (fail ? `失败 ${fail} 项` : '全部通过'));
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
