/**
 * 群友分布图「三级下钻」自检。
 *
 * 覆盖：默认落点、面包屑路径、全国图（含南海诸岛插图）、省图、市图、
 * 点区块下钻、叶子区块（东莞）不进空图、日间对比度、手机端横向溢出、console 报错。
 *
 * 用法：BASE=http://127.0.0.1:3000 node scripts/check-map-levels.cjs
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const SHOTS = process.env.SHOTS || path.join(__dirname, '..', 'shots');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log('  ok   ' + msg);
  } else {
    fail++;
    console.log('  FAIL ' + msg);
  }
}

/** 等地图稳定：面包屑当前级文字 + 区块数量都到位 */
async function currentLevel(page) {
  await page.waitForFunction(
    () => {
      const now = document.querySelector('.map-crumb-now');
      return !!now && document.querySelectorAll('.mmap-district').length > 0;
    },
    { timeout: 20000 }
  );
  await page.waitForTimeout(250);
  return page.evaluate(() => ({
    now: document.querySelector('.map-crumb-now')?.textContent.trim(),
    crumbs: [...document.querySelectorAll('.map-crumb-link')].map((b) => b.textContent.trim()),
    blocks: document.querySelectorAll('.mmap-district').length,
    nanhai: !!document.querySelector('.mmap-nanhai-path'),
    drillable: document.querySelectorAll('.mmap-district.is-drill').length,
    mine: document.querySelectorAll('.mmap-district.is-mine').length,
    // 热力档位统计：lv1~lv3 的区块数
    hot: [...document.querySelectorAll('.mmap-district')].filter((el) => el.getAttribute('class').match(/lv[123]/))
      .length,
    note: document.querySelector('.map-note')?.textContent.trim() || '',
  }));
}

async function clickDrill(page, name) {
  const el = page.locator('.mmap-district.is-drill').first();
  const target = page.locator(`.mmap-district.is-drill`).filter({ hasText: name });
  const use = (await target.count()) > 0 ? target.first() : el;
  await use.click({ force: true });
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  page.on('pageerror', (e) => errs.push(String(e)));

  console.log('\n[1] 默认落点（未登录 → 深圳市）');
  await page.goto(BASE + '/map', { waitUntil: 'networkidle', timeout: 90000 });
  let lv = await currentLevel(page);
  ok(lv.now === '深圳市', '当前级 = 深圳市（实际 ' + lv.now + '）');
  ok(lv.crumbs.join('>') === '全国>广东省', '面包屑 = 全国>广东省（实际 ' + lv.crumbs.join('>') + '）');
  ok(lv.blocks === 9, '深圳 9 个区（实际 ' + lv.blocks + '）');
  ok(lv.hot >= 6, '有热力的区 ' + lv.hot + ' 个（≥6）');
  ok(!lv.nanhai, '深圳图不画南海插图');
  await page.screenshot({ path: path.join(SHOTS, 'map-lv-sz.png'), clip: { x: 0, y: 0, width: 1440, height: 1000 } });

  console.log('\n[2] 面包屑回到省级（广东省）');
  await page.locator('.map-crumb-link', { hasText: '广东省' }).click();
  await page.waitForTimeout(900);
  lv = await currentLevel(page);
  ok(lv.now === '广东省', '当前级 = 广东省（实际 ' + lv.now + '）');
  ok(lv.blocks >= 20, '广东各市数量 ' + lv.blocks + '（≥20）');
  ok(lv.drillable >= 15, '可下钻的市 ' + lv.drillable + ' 个');
  await page.screenshot({ path: path.join(SHOTS, 'map-lv-gd.png'), clip: { x: 0, y: 0, width: 1440, height: 1000 } });

  console.log('\n[3] 全国图 + 南海诸岛插图');
  await page.locator('.map-crumb-link', { hasText: '全国' }).click();
  await page.waitForTimeout(1400);
  lv = await currentLevel(page);
  ok(lv.now === '全国', '当前级 = 全国（实际 ' + lv.now + '）');
  ok(lv.blocks === 34, '34 个省级区（实际 ' + lv.blocks + '）');
  ok(lv.nanhai, '南海诸岛插图已渲染');
  ok(lv.drillable >= 33, '可下钻的省级区 ' + lv.drillable + '（台湾省不提供下级，不算）');
  await page.screenshot({ path: path.join(SHOTS, 'map-lv-cn.png'), clip: { x: 0, y: 0, width: 1440, height: 1000 } });

  console.log('\n[4] 从全国点「广东省」下钻');
  const gd = page.locator('.mmap-district.is-drill').filter({ hasText: '广东省' });
  ok((await gd.count()) > 0, '广东在图上可点击');
  await gd.first().click({ force: true });
  await page.waitForTimeout(1000);
  lv = await currentLevel(page);
  ok(lv.now === '广东省', '点省份后到广东省（实际 ' + lv.now + '）');

  console.log('\n[5] 再点「深圳市」看区');
  const sz = page.locator('.mmap-district.is-drill').filter({ hasText: '深圳市' });
  ok((await sz.count()) > 0, '深圳在省图上可点击');
  await sz.first().click({ force: true });
  await page.waitForTimeout(1000);
  lv = await currentLevel(page);
  ok(lv.now === '深圳市', '到深圳市（实际 ' + lv.now + '）');
  ok(lv.blocks === 9, '回到 9 个区（实际 ' + lv.blocks + '）');

  console.log('\n[6] 叶子区块：东莞市不设区县，点了不能进空图');
  await page.goto(BASE + '/map?adcode=441900', { waitUntil: 'networkidle', timeout: 90000 });
  lv = await currentLevel(page);
  ok(lv.note.length > 0 || lv.blocks > 0, '东莞 adcode 有明确结果（' + (lv.note || lv.now) + '）');

  console.log('\n[7] 日间主题对比度');
  await page.goto(BASE + '/map', { waitUntil: 'networkidle', timeout: 90000 });
  await currentLevel(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await page.waitForTimeout(400);
  const contrast = await page.evaluate(() => {
    const parse = (c) => c.match(/[\d.]+/g).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const name = document.querySelector('.mmap-label-name');
    if (!name) return null;
    const fg = parse(getComputedStyle(name).fill);
    // 区名压在地图色块上：取它下面那块区的填充色作为背景
    const area = document.querySelector('.mmap-district');
    const bg = parse(getComputedStyle(area).fill);
    const L1 = lum(fg);
    const L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    return +ratio.toFixed(2);
  });
  ok(contrast >= 4.5, '区名在日间主题下对比度 ' + contrast + ':1（≥4.5）');
  await page.screenshot({ path: path.join(SHOTS, 'map-lv-light.png'), clip: { x: 0, y: 0, width: 1440, height: 1000 } });

  console.log('\n[8] 手机端');
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.goto(BASE + '/map', { waitUntil: 'networkidle', timeout: 90000 });
  await currentLevel(mp);
  const mOver = await mp.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  ok(mOver === 0, '手机端无横向溢出（差 ' + mOver + 'px）');
  await mp.screenshot({ path: path.join(SHOTS, 'map-lv-mobile.png') });
  // 手机端也要能下钻
  await mp.locator('.map-crumb-link', { hasText: '全国' }).click();
  await mp.waitForTimeout(1600);
  const mCtx = await currentLevel(mp);
  ok(mCtx.blocks === 34 && mCtx.nanhai, '手机端全国图 34 省 + 南海插图（' + mCtx.blocks + '）');

  const real = errs.filter((e) => !/hmr|WebSocket|Failed to load resource/i.test(e));
  ok(real.length === 0, 'console 无报错' + (real.length ? ': ' + real.slice(0, 2).join(' | ') : ''));

  await browser.close();
  console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});
