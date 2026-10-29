#!/usr/bin/env node
/**
 * 群友名片「战绩解读」自检。
 *
 * 这个功能的特殊性在于**合规约束大于功能约束**：个人主体小程序未开放生成式 AI
 * 类目，2026-10-29 就因「涉及深度合成技术」被驳回过一次。所以自检分两块：
 *
 *   ① 规则层：buildInsight 对同一份数字必须给出同一份结论，分档边界不漏；
 *   ② 合规层：静态扫 miniprogram 与 lib/changelog.js，用户可见文案里不许出现
 *      「AI / 智能 / 生成 / 推断 / 深度合成」这类会触发类目判定的字样。
 *      改文案时手滑加回去，这一条会当场红。
 *
 * 全程不联网、不读库、不消耗任何模型额度，随时可跑：
 *   node scripts/check-mp-insight.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const { buildInsight, tierOf, streakOf } = require(path.join(MP, 'utils', 'insight.js'));

let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => {
  console.log('  FAIL ' + m);
  fail++;
};
const expect = (cond, msg) => (cond ? ok(msg) : bad(msg));

// ---------------------------------------------------------------- 样本

const STATS = {
  recentTotal: 20,
  recentWinRate: 60,
  avgKda: 3.8,
  avgKills: 9.2,
  avgDeaths: 4.1,
  avgAssists: 6.4,
  avgGpm: 612,
  avgHeroDamage: 28400,
  mostPlayedHeroes: [
    { name: '影魔', matches: 6, winRate: 66 },
    { name: '米拉娜', matches: 5, winRate: 40 },
    { name: '潮汐猎人', matches: 4, winRate: 75 },
    { name: '斧王', matches: 3, winRate: 33 }
  ],
  heroesLifetime: [
    { name: '影魔', matches: 320, winRate: 58 },
    { name: '米拉娜', matches: 140, winRate: 45 },
    { name: '潮汐猎人', matches: 210, winRate: 62 },
    { name: '斧王', matches: 30, winRate: 80 }
  ],
  recentMatches: [
    { hero: '影魔', isWin: true },
    { hero: '潮汐猎人', isWin: true },
    { hero: '米拉娜', isWin: true },
    { hero: '斧王', isWin: false }
  ]
};

const PLAYER = {
  score: 4120,
  heroes: ['影魔', '斧王'],
  win_rate: 55,
  positions: ['1 号位']
};

// ---------------------------------------------------------------- ① 规则层

console.log('\n[战绩解读 · 规则统计]');

const out = buildInsight(STATS, PLAYER);
const text = out.blocks
  .map((b) => b.num + '. ' + b.segs.map((s) => s.t).join(''))
  .join('\n');

expect(out.empty === false, '有数据时 empty=false');
expect(out.items === out.blocks.length, 'items 与 blocks 数量一致');
expect(out.items >= 6, '固定维度基本齐全（实得 ' + out.items + ' 项）');
expect(text.indexOf('20 场') >= 0, '第 1 条说明样本量（近 20 场）');
expect(text.indexOf('12 胜 8 负') >= 0, '胜场数由胜率反推正确（60% × 20 = 12 胜）');
expect(text.indexOf('万古流芳') >= 0, '4120 分归入「万古流芳」段位');
expect(text.indexOf('与自报值基本一致') >= 0, '60% vs 自报 55% 只差 5 个点，判「基本一致」而不是「明显偏高」');
expect(text.indexOf('偏高') >= 0, 'KDA 3.8 / GPM 612 / 伤害 28400 均落在偏高或中等档');
expect(text.indexOf('高熟练度英雄') >= 0, '影魔(320场/58%)、潮汐(210场/62%) 过绝活门槛');
expect(text.indexOf('潮汐猎人(210 场') < text.indexOf('影魔(320 场'), '高熟练度按胜率从高到低排（62% 在 58% 前）');
expect(text.indexOf('斧王') < 0, '斧王只有 30 场且不在常用前三，整段结论里不该出现');
expect(text.indexOf('3 连胜') >= 0 || text.indexOf('最近 3 场连胜') >= 0, '连赢 3 场被识别为连胜');
expect(!/可能|倾向|建议|推测|估计/.test(text), '结论里不出现模型口气的措辞（可能/倾向/建议/推测）');

// 边界：空数据
const empty = buildInsight(null, PLAYER);
expect(empty.empty === true && empty.blocks.length === 0, '无战绩时返回 empty 且不渲染空壳');
expect(!!empty.emptyText, '无战绩时给出可读的空态文案');

// 边界：0 场 / 全负 / 短连胜
const zero = buildInsight({ recentTotal: 0 }, PLAYER);
expect(zero.empty === true, '近 0 场视为无数据');

const allLose = buildInsight(
  {
    recentTotal: 5,
    recentWinRate: 0,
    recentMatches: [
      { isWin: false },
      { isWin: false },
      { isWin: false }
    ]
  },
  { score: 0, heroes: [], win_rate: 0 }
);
expect(allLose.blocks.length >= 1, '全负也不崩，至少有第 1 条');
expect(allLose.blocks[0].segs.map((s) => s.t).join('').indexOf('0 胜 5 负') >= 0, '全负时胜负数为 0 胜 5 负');

const shortStreak = streakOf([{ isWin: true }, { isWin: true }, { isWin: false }]);
expect(shortStreak === null, '两连胜太短，不单独列（阈值 ' + 3 + ' 场）');

expect(tierOf(0) === '先锋', '0 分归「先锋」');
expect(tierOf(5520) === '冠绝一世', '5520 分归「冠绝一世」');

// ---------------------------------------------------------------- ② 合规层

console.log('\n[合规 · 用户可见文案不含生成式 AI 字样]');

const BANNED = /AI\s*分析|AI\s*战力|AI\s*复审|AI\s*问答|AI\s*助手|智能分析|智能生成|深度合成|AIGC|大模型/i;

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

// wxml 是用户真正看到的，必须干净
const wxmlFiles = walk(MP, []).filter((f) => /\.wxml$/.test(f));
let wxmlHit = 0;
for (const f of wxmlFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const m = src.match(BANNED);
  if (m) {
    bad('用户可见文案含「' + m[0] + '」：' + path.relative(ROOT, f));
    wxmlHit++;
  }
}
expect(wxmlHit === 0, wxmlFiles.length + ' 个 wxml 全部通过文案扫描');

// 更新日志会被小程序的「更新日志」页整页展示，等同用户可见
const cl = fs.readFileSync(path.join(ROOT, 'lib', 'changelog.js'), 'utf8');
const clHit = cl.match(BANNED);
expect(!clHit, clHit ? 'lib/changelog.js 含「' + clHit[0] + '」（会在小程序更新日志页露出）' : 'lib/changelog.js 无违规字样');

// 名片页不许再往回发 /api/ai-analysis
const memberJs = fs.readFileSync(path.join(MP, 'pages', 'member', 'member.js'), 'utf8');
expect(memberJs.indexOf('/api/ai-analysis') < 0, '名片页不再请求 /api/ai-analysis');
expect(memberJs.indexOf('utils/insight') >= 0, '名片页改用本地规则统计（utils/insight）');

console.log('\n结果：' + (fail === 0 ? '全部通过' : fail + ' 项失败'));
process.exit(fail === 0 ? 0 : 1);
