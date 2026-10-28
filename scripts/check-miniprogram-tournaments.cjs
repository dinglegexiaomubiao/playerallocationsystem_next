#!/usr/bin/env node
/**
 * 赛事状态分组：小程序移植版 vs 网页唯一逻辑层 —— 逐条比对。
 *
 * 为什么需要它：小程序没有构建步骤，`require` 不了 `lib/tournament-format.mjs`（ESM），
 * 所以 `miniprogram/utils/format.js` 里的 `tourStatusGroup()` 是一次**手动移植**。
 * 移植错了不会报错，只会「筛出来的届数少几条」—— 页面上完全看不出来，
 * 除非有人把两份结果对着数。这个脚本就是对着数的机器。
 *
 * 比什么：
 *   ① 同一批原始 status（含空值、大小写、没见过的值）分组必须完全一致；
 *   ② 三组的 label 必须和网页端 STATUS_GROUP_LABEL 一致；
 *   ③ 赛事列表页真的渲染 `shown`（筛选结果）而不是 `list`（原始数据）
 *      —— 只筛不渲染是这套改动最容易漏的地方，模板里看不出来。
 *
 * 用法：node scripts/check-miniprogram-tournaments.cjs
 * 纯离线，不打接口、不写库。
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const MP = require(path.join(ROOT, 'miniprogram', 'utils', 'format.js'));

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};

// 覆盖：空值、三组的标准值、同义词、大小写、没见过的脏值
const FIXTURES = [
  undefined,
  null,
  '',
  'planning',
  'planned',
  'postponed',
  'ongoing',
  'active',
  'elimination',
  'semifinal',
  'final',
  'finished',
  'done',
  'LIVE',
  'FINISHED',
  'Planning',
  'cancelled',
  'whatever',
];

(async () => {
  console.log('\n[赛事状态分组比对] 小程序 vs 网页 lib/tournament-format.mjs');

  const lib = await import(
    pathToFileURL(path.join(ROOT, 'lib', 'tournament-format.mjs')).href
  );

  // ① 分组结果逐条一致
  const mismatches = [];
  for (const s of FIXTURES) {
    const a = MP.tourStatusGroup(s);
    const b = lib.statusGroup(s);
    if (a !== b) mismatches.push(`${JSON.stringify(s)}: 小程序 ${a} ≠ 网页 ${b}`);
  }
  if (mismatches.length) {
    bad('分组不一致：\n      ' + mismatches.join('\n      '));
  } else {
    ok(`${FIXTURES.length} 个 status 分组全部一致`);
  }

  // ② label 一致
  const LABELS = { planning: '筹备中', live: '进行中', finished: '已结束' };
  const labelBad = Object.keys(LABELS).filter(
    (k) => lib.STATUS_GROUP_LABEL[k] !== LABELS[k]
  );
  if (labelBad.length) {
    bad('网页端 STATUS_GROUP_LABEL 改了，小程序 tab 文案要跟着改：' + labelBad.join(', '));
  } else {
    ok('三组 label 与网页端一致（筹备中 / 进行中 / 已结束）');
  }

  // 小程序 tab 的 key 必须正好是这三个分组 + 「全部」，否则有赛事永远筛不出来
  const pageJs = fs.readFileSync(
    path.join(ROOT, 'miniprogram', 'pages', 'tournaments', 'tournaments.js'),
    'utf8'
  );
  const tabKeys = [...pageJs.matchAll(/key:\s*'([a-z]*)'/g)].map((m) => m[1]);
  const expected = ['', 'planning', 'live', 'finished'];
  if (JSON.stringify(tabKeys) !== JSON.stringify(expected)) {
    bad(`筛选 tab 的 key 应正好是 ${JSON.stringify(expected)}，实际 ${JSON.stringify(tabKeys)}`);
  } else {
    ok('筛选 tab 的 key 覆盖全部三组 + 全部');
  }

  // ③ 模板必须渲染筛选后的 shown
  const wxml = fs.readFileSync(
    path.join(ROOT, 'miniprogram', 'pages', 'tournaments', 'tournaments.wxml'),
    'utf8'
  );
  if (/wx:for="\{\{shown\}\}"/.test(wxml)) {
    ok('模板渲染的是筛选后的 shown');
  } else {
    bad('模板没有渲染 shown —— 筛了但列表不会变');
  }
  if (/wx:for="\{\{list\}\}"/.test(wxml)) {
    bad('模板还在遍历 list，会把未筛选的全量数据渲染出来');
  }

  // 空状态文案分两种：一条赛事都没有 vs 筛不出来
  if (pageJs.includes('没有符合条件的赛事') && pageJs.includes('还没有赛事')) {
    ok('空状态区分「没有赛事」与「筛不出来」');
  } else {
    bad('空状态没区分：筛不出结果时会误报「还没有赛事」');
  }

  console.log('');
  if (fail) {
    console.log(`❌ ${fail} 项未通过\n`);
    process.exit(1);
  }
  console.log('✅ 全部通过\n');
})().catch((e) => {
  console.error('比对脚本自身出错：', e);
  process.exit(1);
});
