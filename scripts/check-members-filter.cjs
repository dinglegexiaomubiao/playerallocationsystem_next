/**
 * 群友筛选的行为基线 —— 用来证明「重构没改行为」。
 *
 * 为什么需要它：`/members` 的筛选逻辑 2026-10-23 从页面抽到了 `lib/member-filter.mjs`
 * （为了给帮派的「邀请成员」复用）。抽出来的代码看起来一模一样，但这类重构最容易
 * 悄悄改掉某条边界：多选从 OR 变成 AND、排序少一个分支、facets 换了个 key。
 * 这些都不会报错，只会「结果少了几个人」，靠看页面对不出来。
 *
 * 用法（两步）：
 *   1. 改动前录基线：  node scripts/check-members-filter.cjs --record
 *   2. 改动后做对比：  node scripts/check-members-filter.cjs
 * 基线存在 `.cache/members-baseline.json`（不进仓库 —— 数据一变基线就过时，
 * 一份会过期的期望值留在仓库里比没有更糟）。
 *
 * 比什么：11 步操作后的卡片数、筛选摘要文案、前 5 个昵称，
 * 外加筛选栏的 DOM 结构指纹（标签 + class，忽略文本）。
 * 全部一致才算零差异。
 *
 * ⚠ 需要跑着的服务器（默认 3006，可用 BASE 覆盖），且库里有真实群友数据。
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
const BASELINE = '.cache/members-baseline.json';
const RECORD = process.argv.includes('--record');
const OUT = process.env.OUT || (RECORD ? BASELINE : '.cache/members-latest.json');

// 结构指纹：只取标签名 + class，忽略文本（文本会因数据变化而不同）
function structureHash(html) {
  const tags = [...html.matchAll(/<(\w+)([^>]*)>/g)].map((m) => {
    const cls = (m[2].match(/class="([^"]*)"/) || ['', ''])[1];
    return m[1] + (cls ? '.' + cls.split(/\s+/).sort().join('.') : '');
  });
  return tags.join('|');
}

async function capture() {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const apiErrors = [];
  p.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api/')) apiErrors.push(r.status() + ' ' + r.url());
  });

  await p.goto(BASE + '/members', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.p-card', { timeout: 20000 });
  await p.waitForTimeout(600);

  const snap = { url: BASE, at: new Date().toISOString(), steps: [] };

  const countCards = () => p.locator('.p-card').count();
  const summaryText = async () =>
    ((await p.locator('.filter-summary').first().textContent().catch(() => '')) || '')
      .replace(/\s+/g, ' ')
      .trim();
  const firstNames = async () =>
    p.$$eval('.p-card .p-name', (els) => els.slice(0, 5).map((e) => e.textContent.trim()));

  const record = async (name, extra = {}) => {
    const cards = await countCards();
    const summary = await summaryText();
    const names = await firstNames();
    snap.steps.push({ name, cards, summary, names, ...extra });
    console.log(`  ${name.padEnd(22)} 卡片 ${String(cards).padStart(3)}  ${summary}  [${names.slice(0, 3).join(' / ')}]`);
  };

  snap.total = await countCards();
  snap.structure = structureHash(await p.locator('.filter-bar').first().innerHTML());
  snap.filterFields = await p.$$eval('.filter-bar .filter-field > label', (els) =>
    els.map((e) => e.textContent.trim())
  );
  await record('初始');

  // 1-4) 搜索：单词 / 多词（AND）/ 无结果 / 点 × 清空
  const search = p.locator('.filter-search input').first();
  await search.fill('深圳');
  await p.waitForTimeout(350);
  await record('搜索「深圳」');

  await search.fill('深圳 中单');
  await p.waitForTimeout(350);
  await record('搜索「深圳 中单」');

  await search.fill('zzz不存在zzz');
  await p.waitForTimeout(350);
  await record('搜索无结果', { emptyShown: await p.locator('.empty').count() });

  const clearBtn = p.locator('.filter-search-clear').first();
  if (await clearBtn.count()) await clearBtn.click();
  await p.waitForTimeout(350);
  await record('点 × 清空搜索');

  // 5) 段位（取第二个非默认项）
  const tierSel = p.locator('.filter-field select').nth(0);
  const tierOpts = await tierSel.locator('option').evaluateAll((os) =>
    os.map((o) => ({ value: o.value, label: o.textContent.trim() }))
  );
  if (tierOpts.length > 1) {
    await tierSel.selectOption(tierOpts[1].value);
    await p.waitForTimeout(350);
    await record('段位=' + tierOpts[1].label);
    await tierSel.selectOption('all');
    await p.waitForTimeout(250);
  }

  // 6) 天梯分
  const scoreSel = p.locator('.filter-field select').nth(1);
  const scoreOpts = await scoreSel.locator('option').evaluateAll((os) =>
    os.map((o) => ({ value: o.value, label: o.textContent.trim() }))
  );
  if (scoreOpts.length > 1) {
    await scoreSel.selectOption(scoreOpts[1].value);
    await p.waitForTimeout(350);
    await record('天梯分=' + scoreOpts[1].label);
    await scoreSel.selectOption('all');
    await p.waitForTimeout(250);
  }

  // 7) 三种排序（验证排序分支一个没少）
  const sortSel = p.locator('.filter-field select').last();
  for (const v of ['champion', 'name', 'score']) {
    await sortSel.selectOption(v);
    await p.waitForTimeout(350);
    await record('排序=' + v);
  }

  // 8) 重置
  await search.fill('深圳');
  await p.waitForTimeout(300);
  const resetBtn = p.locator('.filter-summary button');
  if (await resetBtn.count()) {
    await resetBtn.click();
    await p.waitForTimeout(350);
    await record('点重置');
  }

  snap.errors = errors;
  snap.apiErrors = apiErrors;
  await b.close();
  return snap;
}

(async () => {
  console.log(`抓取 ${BASE}/members 的筛选行为…\n`);
  const snap = await capture();
  fs.writeFileSync(OUT, JSON.stringify(snap, null, 2), 'utf8');
  console.log('\n写入 ' + OUT);
  console.log('console 错误 ' + snap.errors.length + ' 条 / API 4xx 以上 ' + snap.apiErrors.length + ' 条');

  if (RECORD) {
    console.log('\n基线已录。改完代码后再跑一次（不带 --record）做对比。');
    return;
  }
  if (!fs.existsSync(BASELINE)) {
    console.log('\n⚠ 没有基线可比，先用 --record 录一份。');
    return;
  }

  // ---- 对比 ----
  const a = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const b = snap;
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  let diff = 0;
  console.log('\n与基线对比：');
  if (a.total !== b.total) {
    diff++;
    console.log(`  ✗ 总卡片数 ${a.total} → ${b.total}`);
  }
  if (a.structure !== b.structure) {
    diff++;
    console.log('  ✗ 筛选栏 DOM 结构变了');
  }
  if (!eq(a.filterFields, b.filterFields)) {
    diff++;
    console.log('  ✗ 筛选字段变了：' + JSON.stringify(a.filterFields) + ' → ' + JSON.stringify(b.filterFields));
  }
  for (let i = 0; i < Math.max(a.steps.length, b.steps.length); i++) {
    const s = a.steps[i];
    const t = b.steps[i];
    if (!s || !t) {
      diff++;
      console.log('  ✗ 步骤数不同');
      break;
    }
    if (s.name !== t.name || s.cards !== t.cards || s.summary !== t.summary || !eq(s.names, t.names)) {
      diff++;
      console.log(`  ✗ ${s.name}`);
      console.log(`      ${s.cards} 位 ${JSON.stringify(s.summary)} ${JSON.stringify(s.names.slice(0, 2))}`);
      console.log(`   →  ${t.cards} 位 ${JSON.stringify(t.summary)} ${JSON.stringify(t.names.slice(0, 2))}`);
    }
  }
  if (b.errors.length > a.errors.length) {
    diff++;
    console.log(`  ✗ console 报错 ${a.errors.length} → ${b.errors.length}`);
  }

  if (diff) {
    console.log(`\n✗ ${diff} 处差异 —— 筛选行为变了，不要当成纯重构提交`);
    process.exit(1);
  }
  console.log('\n✓ 零差异（11 步 + 结构指纹 + console）');
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
