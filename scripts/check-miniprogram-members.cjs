#!/usr/bin/env node
/**
 * 群友六维筛选：小程序移植版 vs 网页唯一逻辑层 —— 拿同一批真实数据逐条比对。
 *
 * 为什么需要它：小程序没有构建步骤，`require` 不了 `lib/member-filter.mjs`（ESM），
 * 所以 `miniprogram/utils/member-filter.js` 是一次**手动移植**。移植逻辑不会报错，
 * 只会「筛出来的人少几个」—— 页面上完全看不出来，除非有人拿两份结果对着数。
 * 这个脚本就是把两份结果对着数的机器。
 *
 * 比什么：
 *   ① 常量口径（段位门槛 / 分数区间 / 排序项）必须逐字一致；
 *   ② 各维度 facets 的命中数必须一致；
 *   ③ 三十来组筛选条件下，返回的 id 列表**连顺序**都要一致；
 *   ④ 页面经过真实交互（输入关键字、点英雄、换段位、重置）后的名单也要一致。
 *
 * 用法：
 *   node scripts/check-miniprogram-members.cjs                 # 打线上
 *   node scripts/check-miniprogram-members.cjs http://127.0.0.1:3006
 *
 * 只读，不写库，不产生任何残留。
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const BASE = process.argv[2] || 'https://dota.playerallocationsystem.online';
const ROOT = path.join(__dirname, '..', 'miniprogram');
const MP = require(path.join(ROOT, 'utils', 'member-filter.js'));

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};
const expect = (cond, msg) => (cond ? ok(msg) : bad(msg));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const idsOf = (list) => list.map((p) => String(p.id));
const mapOf = (arr, k, v) => {
  const m = {};
  arr.forEach((x) => {
    m[String(x[k])] = x[v];
  });
  return m;
};
/** 计数表比对：**不比较键顺序** —— 并列时两边用的排序器不同（localeCompare vs <），
 *  order 差异本身不算漂移，数字不一致才算。 */
const sameMap = (a, b) => {
  const norm = (o) =>
    JSON.stringify(
      Object.keys(o)
        .sort()
        .map((k) => [k, o[k]])
    );
  return norm(a) === norm(b);
};

async function fetchPlayers() {
  const r = await fetch(BASE + '/api/players');
  if (!r.ok) throw new Error('/api/players 返回 ' + r.status);
  const j = await r.json();
  const list = (j && j.players) || [];
  if (!list.length) throw new Error('/api/players 没返回任何群友，先确认环境');
  return list;
}

(async () => {
  console.log('\n[群友筛选口径比对] ' + BASE + '\n');

  const LIB = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'member-filter.mjs')).href);
  // 段位门槛不在 member-filter.mjs 里（它只是 import 进来用），真正的唯一来源是 tier.mjs
  const LIB_TIER = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'tier.mjs')).href);
  const players = await fetchPlayers();
  console.log('  真实数据 ' + players.length + ' 位群友\n');

  // ---------- ① 常量口径 ----------
  console.log('— 常量口径 —');
  const pickTier = (t) => ({ key: t.key, label: t.label, min: t.min, max: t.max });
  expect(same(LIB_TIER.TIERS.map(pickTier), MP.TIERS.map(pickTier)), '段位门槛 6 档逐字一致');

  const pickRange = (r) => ({
    value: r.value,
    label: r.label,
    min: r.min === undefined ? null : r.min,
    max: r.max === undefined ? null : r.max,
    none: !!r.none,
  });
  expect(
    same(LIB.SCORE_RANGES.map(pickRange), MP.SCORE_RANGES.map(pickRange)),
    '分数区间 ' + LIB.SCORE_RANGES.length + ' 档逐字一致（含「未填写分数」）'
  );

  // 排序项在网页端是写死在面板里的 <option>，没有共享常量，只能从源码里读
  const panel = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'member', 'MemberFilterPanel.js'),
    'utf8'
  );
  const sortBlock = (panel.match(/排序[\s\S]{0,600}?<\/select>/) || [''])[0];
  const webSorts = [...sortBlock.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  expect(
    webSorts.length > 0 && same(webSorts, MP.SORTS.map((s) => s.value)),
    '排序项与网页面板一致：' + webSorts.join(' / ')
  );

  // ---------- ② facets ----------
  console.log('— 各维度 facets 命中数 —');
  const mpTier = MP.buildTierFacets(players);
  const libTier = LIB.buildTierFacets(players);
  expect(sameMap(mapOf(libTier, 'key', 'count'), mapOf(mpTier, 'key', 'count')), '段位 6 档人数一致');
  expect(
    same(
      libTier.map((t) => t.count),
      mpTier.map((t) => t.count)
    ),
    '段位顺序也一致（下拉顺序就是用户找项的顺序）'
  );

  const mpScore = MP.buildScoreFacets(players);
  const libScore = LIB.buildScoreFacets(players);
  expect(sameMap(mapOf(libScore, 'value', 'count'), mapOf(mpScore, 'value', 'count')), '分数区间 8 档人数一致');

  const mpRH = MP.buildRegionHeroFacets(players);
  const libRH = LIB.buildRegionHeroFacets(players);
  expect(
    sameMap(Object.fromEntries(libRH.region), mapOf(mpRH.region, 'value', 'count')),
    '地区 facets 一致（' + mpRH.region.length + ' 个地区）'
  );
  expect(
    sameMap(Object.fromEntries(libRH.hero), mapOf(mpRH.hero, 'value', 'count')),
    '英雄 facets 一致（' + mpRH.hero.length + ' 个英雄）'
  );
  const mpHeroOrder = mpRH.hero.map((x) => x.count);
  expect(
    mpHeroOrder.every((c, i) => i === 0 || mpHeroOrder[i - 1] >= c),
    '英雄按出现次数降序（第一屏就该是最常见的）'
  );

  // ---------- ③ 筛选矩阵 ----------
  console.log('— 筛选矩阵（id 列表逐条比对）—');

  const posAll = [];
  players.forEach((p) => (p.positions || []).forEach((x) => posAll.indexOf(x) < 0 && posAll.push(x)));
  const topRegions = mpRH.region.slice(0, 3).map((x) => x.value);
  const topHeroes = mpRH.hero.slice(0, 3).map((x) => x.value);
  const aName = String(players[0].nickname || '').slice(0, 2);

  const cases = [];
  const add = (name, f) => cases.push({ name, f });

  add('不筛（默认）', {});
  add('搜索「深圳」', { keyword: '深圳' });
  add('搜索双词（地区全称）', { keyword: topRegions[0] || '' });
  add('搜索无结果', { keyword: 'zzz不存在zzz' });
  if (aName.length >= 2) add('搜索昵称片段「' + aName + '」', { keyword: aName });

  MP.TIERS.forEach((t) => add('段位=' + t.label, { tier: t.key }));
  MP.SCORE_RANGES.forEach((r) => add('分数=' + r.label, { score: r.value }));

  posAll.slice(0, 4).forEach((p) => add('位置=' + p, { position: [p] }));
  if (posAll.length >= 2) add('位置多选 OR（' + posAll[0] + '+' + posAll[1] + '）', { position: posAll.slice(0, 2) });

  topRegions.forEach((r) => add('地区=' + r, { region: r }));
  topHeroes.forEach((h) => add('英雄=' + h, { hero: [h] }));
  if (topHeroes.length >= 2) add('英雄多选 OR（' + topHeroes[0] + '+' + topHeroes[1] + '）', { hero: topHeroes.slice(0, 2) });

  add('地区+英雄', { region: topRegions[0], hero: topHeroes.slice(0, 1) });
  add('段位+分数', { tier: MP.TIERS[1].key, score: MP.SCORE_RANGES[2].value });
  if (posAll.length) add('段位+位置', { tier: MP.TIERS[2].key, position: [posAll[0]] });
  add('关键字+地区', { keyword: '深圳', region: topRegions[0] });
  add('全条件叠加', {
    keyword: '深圳',
    tier: MP.TIERS[3].key,
    score: 'all',
    position: posAll.slice(0, 1),
    region: '全部',
    hero: topHeroes.slice(0, 1),
    sort: 'name',
  });
  ['score', 'champion', 'name'].forEach((s) => add('排序=' + s, { sort: s }));

  let diffCases = 0;
  let mismatch = null;
  for (const c of cases) {
    const a = idsOf(LIB.filterMembers(players, c.f));
    const b = idsOf(MP.filterMembers(players, c.f));
    const activeA = LIB.countActiveFilters(c.f);
    const activeB = MP.countActiveFilters(c.f);
    if (!same(a, b) || activeA !== activeB) {
      diffCases++;
      if (!mismatch) mismatch = { name: c.name, lib: a, mp: b };
    }
  }
  expect(diffCases === 0, cases.length + ' 组筛选结果与网页端完全一致（含排序）');
  if (mismatch) {
    const onlyLib = mismatch.lib.filter((x) => mismatch.mp.indexOf(x) < 0);
    const onlyMp = mismatch.mp.filter((x) => mismatch.lib.indexOf(x) < 0);
    console.log('     首个不一致：' + mismatch.name);
    console.log('       网页 ' + mismatch.lib.length + ' 位 / 小程序 ' + mismatch.mp.length + ' 位');
    if (onlyLib.length) console.log('       仅网页有：' + onlyLib.slice(0, 5).join(','));
    if (onlyMp.length) console.log('       仅小程序有：' + onlyMp.slice(0, 5).join(','));
    if (!onlyLib.length && !onlyMp.length) console.log('       集合相同但顺序不同 —— 排序分支漂移');
  }

  // 空结果这个分支必须真的是空（不是「没筛」）
  expect(MP.filterMembers(players, { keyword: 'zzz不存在zzz' }).length === 0, '无结果时返回空数组（不是退回全量）');

  // 不传筛选等价于默认筛选
  expect(
    same(idsOf(MP.filterMembers(players, null)), idsOf(MP.filterMembers(players, MP.emptyFilters()))),
    'filterMembers(null) 与空筛选等价'
  );
  // 每次 emptyFilters 都是新对象，改一个不会污染下一次
  const f1 = MP.emptyFilters();
  f1.position.push('中单');
  f1.hero.push('影魔');
  expect(MP.emptyFilters().position.length === 0 && MP.emptyFilters().hero.length === 0, 'emptyFilters() 不共享可变数组');

  // ---------- ④ 页面真交互 ----------
  console.log('— 页面交互（pages/members）—');
  const rt = createRuntime({ baseUrl: BASE, root: ROOT, token: '' });
  const p = rt.loadPage('pages/members/members.js');
  await p.onLoad();
  await rt.wait(300);

  expect(!p.data.loading && !p.data.error, '页面加载完成无报错');
  expect(p.data.total === players.length, '总人数 ' + p.data.total + ' 与接口一致');
  expect(p.data.shown === players.length, '未筛选时全部展示');
  expect(p.data.activeCount === 0, '未筛选时 activeCount = 0');
  expect(p.data.heroChips.length === mpRH.hero.length, '英雄选项 ' + p.data.heroChips.length + ' 个（来自真实数据）');
  expect(
    p.data.heroChips.every((c) => c.count >= 1 && c.on === false),
    '英雄选项带人数且默认不选中'
  );
  expect(p.data.posChips.length > 0, '位置选项 ' + p.data.posChips.length + ' 个（来自 /api/options）');

  // 输入关键字（走页面自己的 onKeyword，含 apply）
  p.onKeyword({ detail: { value: '深圳' } });
  const libKw = LIB.filterMembers(players, { keyword: '深圳' });
  expect(
    p.data.shown === libKw.length && same(p.data.list.map((x) => x.id), idsOf(libKw)),
    '输入「深圳」后名单与 lib 一致（' + p.data.shown + ' 位）'
  );
  expect(p.data.activeCount === 1, 'activeCount = 1');

  // 点英雄 chip（多选 OR）
  p.onHero({ currentTarget: { dataset: { name: topHeroes[0] } } });
  p.onHero({ currentTarget: { dataset: { name: topHeroes[1] } } });
  const libHero = LIB.filterMembers(players, { keyword: '深圳', hero: topHeroes.slice(0, 2) });
  expect(p.data.heroCount === 2, '已选 2 个英雄');
  expect(
    same(p.data.list.map((x) => x.id), idsOf(libHero)),
    '英雄多选 OR + 关键字后名单一致（' + p.data.shown + ' 位）'
  );
  // 再点一次是取消
  p.onHero({ currentTarget: { dataset: { name: topHeroes[1] } } });
  expect(p.data.heroCount === 1, '再点一次取消该英雄');

  // 换段位（下标 → key 的映射）
  const tierIdx = p._tiers.findIndex((t) => t.key === MP.TIERS[1].key);
  p.onTier({ detail: { value: String(tierIdx) } });
  expect(p._filters.tier === MP.TIERS[1].key, '段位下拉下标映射到 key：' + p._filters.tier);

  // 换地区
  const regionIdx = p._regions.findIndex((r) => r.value === topRegions[0]);
  p.onRegion({ detail: { value: String(regionIdx) } });
  expect(p._filters.region === topRegions[0], '地区下拉映射到值：' + p._filters.region);

  // 清空关键字
  p.onClearKeyword();
  expect(p.data.activeCount === MP.countActiveFilters(p._filters), '清空关键字后 activeCount 与实际条件数一致');

  // 重置
  p.reset();
  expect(p.data.shown === players.length, '重置后回到全量 ' + p.data.shown + ' 位');
  expect(p.data.activeCount === 0 && p.data.heroCount === 0, '重置后条件清零');
  // id 必须是原始字符串：库里既有 13 位老 id 也有 17 位雪花号，Number() 会静默改尾数
  const rawIds = new Set(players.map((x) => String(x.id)));
  expect(
    p.data.list.every((x) => typeof x.id === 'string' && rawIds.has(x.id)),
    '卡片 id 与库内原始字符串逐字相同（没被 Number 截断）'
  );

  // 分页/点击跳转用不到，但要确认 id 没被丢精度
  const firstLib = String(LIB.filterMembers(players, {})[0].id);
  expect(p.data.list[0].id === firstLib, '首条 id 与 lib 排序结果一致：' + firstLib);

  console.log('\n' + (fail ? '✗ ' + fail + ' 项未通过' : '✓ 全部通过（' + cases.length + ' 组筛选 + 页面交互）'));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nERR ' + e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
