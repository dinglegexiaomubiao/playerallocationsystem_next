/**
 * 首页分类 Tab 的自检：5 个 Tab、默认选中、切 Tab 过滤、分类内不重复类型标签、
 * 「更新」Tab 带版本号、空分类走空态、切 Tab 时卡片高度不抖、手机端不溢出，
 * 以及 /changelog 页的分组与日期。
 *
 * 为什么需要：Tab 是纯前端过滤，没有接口能验证「切过去到底对不对」。
 * 而且「全部」Tab 有个隐蔽规则 —— 每类保底一条，否则一类活跃就把整屏占满。
 * 这条只能靠页面上数标签种类来验。
 *
 * 用法：BASE=https://dota.playerallocationsystem.online node scripts/check-home-tabs.cjs
 * （只读，可以打线上）
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
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
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await p.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.home-hero-feed', { timeout: 20000 });
  await p.waitForTimeout(800);

  const tabs = await p.locator('.home-feed-tab').count();
  ok(tabs === 5, '5 个分类 Tab', tabs + ' 个');
  const labels = await p.locator('.home-feed-tab').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  ok(labels.length === 5 && labels[0].startsWith('全部'), '第一个是「全部」', labels.join(' / '));

  const onCount = await p.locator('.home-feed-tab.is-on').count();
  ok(onCount === 1, '只有一个选中态');
  const onLabel = ((await p.locator('.home-feed-tab.is-on').textContent()) || '').trim();
  ok(onLabel.startsWith('全部'), '默认选中的是「全部」', onLabel);

  const rowsAll = await p.locator('.home-hero-feed-row').count();
  ok(rowsAll > 0 && rowsAll <= 6, '「全部」最多 6 行', rowsAll + ' 行');
  const tagsInAll = await p.locator('.home-feed-tag').count();
  ok(tagsInAll > 0, '「全部」里每行有类型标签', tagsInAll + ' 个');

  // ---- 切 Tab 时 Hero 卡片高度必须一动不动 ----
  //
  // 用户报的「切 Tab 卡片大小抖动」：Hero 是 grid + align-items:stretch，右栏一矮整张卡跟着缩，
  // 视口里的东西全往上跳。现在右栏按 6 行预留高度，任何 Tab（包括空分类）都不该改变卡片高度。
  // 只量高度不够，所以每个 Tab 都量一遍取极差 —— 单点比较会漏掉「只有空 Tab 才塌」这种情况。
  const heroH = () =>
    p.locator('.home-hero').evaluate((el) => Math.round(el.getBoundingClientRect().height * 10) / 10);
  const heights = {};
  for (const label of ['开黑', '活动', '群友', '更新', '全部']) {
    await p.locator('.home-feed-tab').filter({ hasText: label }).first().click();
    await p.waitForTimeout(260);
    heights[label] = await heroH();
  }
  const hs = Object.values(heights);
  const spread = Math.max(...hs) - Math.min(...hs);
  ok(
    spread <= 1,
    '切 Tab 时 Hero 卡片高度不变',
    Object.entries(heights).map(([k, v]) => k + ' ' + v).join(' / ') + ' → 极差 ' + spread.toFixed(1) + 'px'
  );

  // ---- 切到「开黑」 ----
  await p.locator('.home-feed-tab').filter({ hasText: '开黑' }).click();
  await p.waitForTimeout(350);
  const rowsParty = await p.locator('.home-hero-feed-row').count();
  const tagsInParty = await p.locator('.home-feed-tag').count();
  ok(rowsParty > 0, '「开黑」Tab 有内容', rowsParty + ' 行');
  ok(tagsInParty === 0, '分类 Tab 内不再重复类型标签', tagsInParty + ' 个');

  // ---- 切到「更新」 ----
  await p.locator('.home-feed-tab').filter({ hasText: '更新' }).click();
  await p.waitForTimeout(350);
  const rowsFeat = await p.locator('.home-hero-feed-row').count();
  const vers = await p.locator('.home-feed-ver').count();
  ok(rowsFeat > 0, '「更新」Tab 有内容', rowsFeat + ' 行');
  ok(vers === rowsFeat, '每条更新都带版本号', vers + '/' + rowsFeat);
  const firstVer = ((await p.locator('.home-feed-ver').first().textContent()) || '').trim();
  ok(/^\d+\.\d+\.\d+$/.test(firstVer), '版本号格式正确', firstVer);

  await p.locator('.home-hero-feed').screenshot({ path: 'shots/home-tabs-feature.png' });

  // ---- 切到「活动」（库里 0 条，应该走空态） ----
  await p.locator('.home-feed-tab').filter({ hasText: '活动' }).click();
  await p.waitForTimeout(350);
  const rowsAct = await p.locator('.home-hero-feed-row').count();
  const emptyShown = await p.locator('.home-feed-empty').count();
  ok(rowsAct === 0 && emptyShown === 1, '空分类显示空态文案而不是空白', `行 ${rowsAct} / 空态 ${emptyShown}`);

  // ---- 回到「全部」 ----
  await p.locator('.home-feed-tab').filter({ hasText: '全部' }).click();
  await p.waitForTimeout(350);
  ok((await p.locator('.home-hero-feed-row').count()) === rowsAll, '切回「全部」恢复原样');

  // ---- Tab 有没有横向溢出 ----
  const overflow = await p.evaluate(() => {
    const el = document.querySelector('.home-feed-tabs');
    return el ? el.scrollWidth - el.clientWidth : -1;
  });
  ok(overflow <= 1, 'Tab 在一行内不溢出', overflow + 'px');

  await p.locator('.home-hero-feed').screenshot({ path: 'shots/home-tabs-all.png' });

  // ---- 更新日志页 ----
  await p.goto(BASE + '/changelog', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(500);
  const groups = await p.locator('.changelog-group').count();
  const items = await p.locator('.changelog-item').count();
  ok(groups >= 3, '日志页按版本分组', groups + ' 个版本');
  ok(items > 0, '有条目', items + ' 条');
  const verTexts = await p.locator('.changelog-ver').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  ok(verTexts.every((v) => /^\d+\.\d+\.\d+$/.test(v)), '版本号都合规', verTexts.join(' / '));
  const dates = await p.locator('.changelog-date').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  ok(dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), '每条都标了日期', dates.join(' / '));
  await p.screenshot({ path: 'shots/changelog-page.png', fullPage: true });

  // ---- 手机端 ----
  const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
  const mp = await mctx.newPage();
  await mp.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await mp.waitForSelector('.home-hero-feed', { timeout: 20000 });
  await mp.waitForTimeout(800);
  const mOverflow = await mp.evaluate(() => {
    const el = document.querySelector('.home-feed-tabs');
    return el ? el.scrollWidth - el.clientWidth : -1;
  });
  ok(mOverflow <= 1, '手机端 Tab 不溢出', mOverflow + 'px');
  const mDocOverflow = await mp.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  ok(mDocOverflow <= 1, '手机端整页无横向溢出', mDocOverflow + 'px');
  await mp.locator('.home-hero-feed').screenshot({ path: 'shots/home-tabs-mobile.png' });

  console.log('\nconsole 错误:', errors.length, errors.slice(0, 3));
  ok(errors.length === 0, '无 console 报错');

  await b.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('ERR', e.message);
  process.exitCode = 1;
});
