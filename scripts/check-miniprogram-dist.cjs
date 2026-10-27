#!/usr/bin/env node
/**
 * 群友分布（pages/dist）：排行 + 下钻 + 未填名单。
 *
 * 这一页的风险不在写库，而在**三件容易静默出错的事**：
 *   ① 面包屑与 scope 不同步 —— 下钻后还显示上一级名字，用户会以为自己点错了；
 *   ② 未填地区名单丢了 —— 168 位群友里只有 38 位填了地区，不摆出来会让人以为群里就这些人；
 *   ③ 把 areas[].path（SVG 路径）整包塞进 setData —— 一次响应 53KB，多钻两级就顶到 1MB 上限。
 *
 * 用法：node scripts/check-miniprogram-dist.cjs [BASE]
 * 只读，不写库。
 */
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const BASE = process.argv[2] || 'https://dota.playerallocationsystem.online';
const ROOT = path.join(__dirname, '..', 'miniprogram');

const rt = createRuntime({ baseUrl: BASE, root: ROOT, token: '' });
const { loadPage, wait } = rt;

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};
const expect = (cond, msg) => (cond ? ok(msg) : bad(msg));

async function until(fn, timeoutMs, label) {
  const end = Date.now() + (timeoutMs || 15000);
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(150);
  }
  bad('等待超时：' + (label || '条件未成立'));
  return false;
}

const isDesc = (arr) => arr.every((x, i) => i === 0 || arr[i - 1].count >= x.count);

(async () => {
  console.log('\n[群友分布 · 排行与下钻] ' + BASE + '\n');

  const p = loadPage('pages/dist/dist.js');
  p.onLoad();
  await until(() => !p.data.loading, 20000, '首屏加载');

  // ---------- 首屏：默认落深圳市 ----------
  console.log('— 首屏（默认层级）—');
  expect(!p.data.error, '无报错');
  expect(p.data.scopeName === '深圳市', '默认落在 ' + p.data.scopeName);
  expect(p.data.crumbs.length === 3, '面包屑 3 级：' + p.data.crumbs.map((c) => c.name).join(' › '));
  expect(
    p.data.crumbs[0].name === '全国' && p.data.crumbs[0].adcode === '100000',
    '第一级是「全国」且可点回（adcode 100000）'
  );
  expect(
    p.data.crumbs[p.data.crumbs.length - 1].name === '深圳市',
    '最后一级就是当前层级（不是上一级）'
  );
  expect(p.data.isRoot === false, 'isRoot = false');

  const stats = p.data.stats.reduce((m, s) => Object.assign(m, { [s.key]: s.value }), {});
  expect(stats.players > 0, '群友总数 ' + stats.players);
  expect(stats.filled > 0 && stats.filled <= stats.players, '已填地区 ' + stats.filled + ' ≤ 总数');
  expect(stats.missing === stats.players - stats.filled, '未填 = 总数 - 已填（' + stats.missing + '）');

  // ---------- 排行 ----------
  console.log('\n— 排行条 —');
  expect(p.data.areas.length >= 5, '区划 ' + p.data.areas.length + ' 个');
  expect(isDesc(p.data.areas), '按人数降序：' + p.data.areas.slice(0, 3).map((a) => a.name + '(' + a.count + ')').join(' > '));
  expect(
    p.data.areas.every((a) => a.pct >= 0 && a.pct <= 100),
    '比例条宽度都在 0~100%'
  );
  expect(
    p.data.areas.filter((a) => a.count > 0).every((a) => a.pct >= 4),
    '有人的区最少给 4% 宽度（否则 1 人和 0 人看起来一样）'
  );
  expect(
    p.data.areas.every((a) => a.path === undefined && a.center === undefined),
    '没把 SVG 路径 / 坐标带进 data（接口里是重字段）'
  );
  const sum = p.data.areas.reduce((n, a) => n + a.count, 0);
  expect(sum > 0 && sum <= stats.filled, '各区人数合计 ' + sum + ' ≤ 已填地区 ' + stats.filled + '（其余在别的省市）');

  // ---------- 未填地区名单 ----------
  console.log('\n— 未填地区 —');
  expect(p.data.missingTotal > 0, '未填 ' + p.data.missingTotal + ' 位');
  expect(p.data.missing.length === p.data.missingTotal, '名单全量留在 data（折叠只是显示层）');
  expect(p.data.missingPreview.length === Math.min(12, p.data.missingTotal), '预览只取前 12 位：' + p.data.missingPreview.length);
  expect(p.data.missingOpen === false, '默认折叠');
  p.toggleMissing();
  expect(p.data.missingOpen === true, '点「展开全部」后打开');
  p.toggleMissing();
  expect(p.data.missingOpen === false, '再点收起');

  // ---------- 点区展开名单 ----------
  console.log('\n— 展开某个区的名单 —');
  const idx = p.data.areas.findIndex((a) => a.count > 0 && a.players.length > 0 && !a.canDrill);
  if (idx >= 0) {
    const before = p.data.areas[idx];
    p.onTapCount({ currentTarget: { dataset: { index: idx } } });
    expect(p.data.areas[idx].open === true, '点人数展开「' + before.name + '」的 ' + before.players.length + ' 位群友');
    expect(
      p.data.areas[idx].players.every((x) => typeof x.id === 'string' && x.name.length > 0),
      '名单里 id 是字符串、昵称非空'
    );
    // 只刷这一项，别的行不能被带着变
    const otherOpen = p.data.areas.filter((a, i) => i !== idx && a.open).length;
    expect(otherOpen === 0, '只用路径键刷这一行，其他行状态没被牵连');
    p.onTapCount({ currentTarget: { dataset: { index: idx } } });
    expect(p.data.areas[idx].open === false, '再点收起');
  } else {
    console.log('  · 本级没有「有名单但不可下钻」的区，跳过展开断言');
  }

  // ---------- 下钻：回全国 ----------
  console.log('\n— 下钻 —');
  p.onTapCrumb({ currentTarget: { dataset: { adcode: '100000' } } });
  await until(() => p.data.scopeName === '全国' && !p.data.loadingDrill, 20000, '切到全国');
  expect(p.data.scopeName === '全国', '点面包屑「全国」→ ' + p.data.scopeName);
  expect(p.data.isRoot === true, '全国 isRoot = true');
  expect(p.data.areas.length >= 20, '省级区划 ' + p.data.areas.length + ' 个');
  expect(p.data.crumbs.length === 1, '面包屑收敛成 1 级：' + p.data.crumbs.map((c) => c.name).join(' › '));
  expect(
    p.data.areas.every((a) => a.canDrill !== undefined),
    '每个区划带 canDrill（页面据此决定是下钻还是展开名单）'
  );
  expect(
    p.data.missing.length === p.data.missingTotal,
    '下钻后未填名单不被清空（geo 接口不返回 missing，沿用首屏的）'
  );

  // 下钻省
  const gd = p.data.areas.filter((a) => a.name === '广东省')[0];
  if (gd) {
    p.drill(gd.adcode);
    await until(() => p.data.scopeName === '广东省' && !p.data.loadingDrill, 20000, '下钻广东省');
    expect(p.data.scopeName === '广东省', '下钻到 ' + p.data.scopeName + '（' + p.data.areas.length + ' 个市）');
    expect(p.data.crumbs.map((c) => c.name).join(' › ') === '全国 › 广东省', '面包屑跟着变：' + p.data.crumbs.map((c) => c.name).join(' › '));
  } else {
    bad('省级列表里没有「广东省」，下钻断言无法进行');
  }

  // ---------- 不设下级行政区的地方 ----------
  console.log('\n— 边界：不设下级行政区 —');
  p.drill('441900'); // 东莞市
  await until(() => !p.data.loadingDrill, 20000, '东莞市');
  expect(!!p.data.notice, '给出提示：' + p.data.notice);
  expect(p.data.scopeName === '广东省', '回落到有数据的一级：' + p.data.scopeName);
  expect(p.data.areas.length >= 20, '列表仍可用（' + p.data.areas.length + ' 个市），不是白屏');

  // 非法 adcode 不发请求
  const before = p.data.scopeName;
  p.drill('abc');
  await wait(300);
  expect(p.data.scopeName === before, '非法 adcode 直接忽略（不发请求）');

  // 点当前层级的面包屑不发请求
  p.drill('440000');
  await until(() => p.data.scopeName === '广东省' && !p.data.loadingDrill, 20000, '回到广东省');
  const same = p.data.crumbs[p.data.crumbs.length - 1];
  p.onTapCrumb({ currentTarget: { dataset: { adcode: same.adcode } } });
  await wait(400);
  expect(p.data.scopeName === '广东省', '点当前层级的面包屑不重复请求');

  console.log('\n' + (fail ? '✗ ' + fail + ' 项未通过' : '✓ 全部通过'));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nERR ' + e.message);
  if (e.stack) console.error(e.stack.split('\n').slice(1, 3).join('\n'));
  process.exit(1);
});
