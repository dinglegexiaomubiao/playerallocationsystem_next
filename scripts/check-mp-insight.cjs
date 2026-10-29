#!/usr/bin/env node
/**
 * 群友名片「战绩解读」自检。
 *
 * 这个功能的特殊性在于**合规约束大于功能约束**：个人主体小程序未开放生成式 AI
 * 类目，2026-10-29 就因「涉及深度合成技术」被驳回过一次。所以自检分三块：
 *
 *   ① 口径层：`utils/match-stat.js` 是 `lib/match-format.mjs` 的手工移植，
 *      两边必须对同一批对局给出逐字段相同的汇总——这是「小程序和网页数字对不上」
 *      那次事故的护栏，漂移了就在这里红；
 *   ② 规则层：buildInsight 对同一份数字必须给出同一份结论，分档边界不漏，
 *      且样本口径固定为整份对局（最多 200 场），GPM/伤害必须自带「近 20 场」标签；
 *   ③ 合规层：静态扫 miniprogram 与 lib/changelog.js，用户可见文案里不许出现
 *      「AI / 智能 / 生成 / 推断 / 深度合成」这类会触发类目判定的字样。
 *
 * 全程不联网、不读库、不消耗任何模型额度，随时可跑：
 *   node scripts/check-mp-insight.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const { buildInsight, tierOf, streakOf } = require(path.join(MP, 'utils', 'insight.js'));
const MP_STAT = require(path.join(MP, 'utils', 'match-stat.js'));

let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => {
  console.log('  FAIL ' + m);
  fail++;
};
const expect = (cond, msg) => (cond ? ok(msg) : bad(msg));

// ---------------------------------------------------------------- 样本

/** 造一批对局（最新在前），字段与 /api/player-matches 的 normalize 输出一致 */
function makeMatches(n) {
  // 英雄刻意做偏斜：影魔最多、斧王最少，用来验证「常用前三」不是平均分配
  const heroPool = ['影魔', '影魔', '影魔', '米拉娜', '米拉娜', '潮汐猎人', '潮汐猎人', '斧王'];
  const out = [];
  for (let i = 0; i < n; i++) {
    // 前 4 场连胜、第 5 场断掉，制造一个可断言的「4 连胜」
    let isWin;
    if (i < 4) isWin = true;
    else if (i === 4) isWin = false;
    else isWin = i % 3 !== 0;
    out.push({
      matchId: String(900000000 + i),
      hero: heroPool[i % heroPool.length],
      isWin,
      kills: 4 + (i % 9),
      deaths: i % 5,
      assists: 6 + (i % 7),
      duration: 1800 + (i % 11) * 90,
      startTime: 1760000000 - i * 3600,
    });
  }
  return out;
}

const MATCHES = makeMatches(60);

const DATA = {
  matches: MATCHES,
  lifetime: { win: 900, lose: 800, total: 1700, winRate: 52.9 },
  recent20: {
    total: 20,
    wins: 11,
    losses: 9,
    winRate: 55,
    avgGpm: 612,
    avgHeroDamage: 28400,
    avgKda: '3.4',
  },
  heroesLifetime: [
    { name: '影魔', matches: 320, winRate: 58 },
    { name: '米拉娜', matches: 140, winRate: 45 },
    { name: '潮汐猎人', matches: 210, winRate: 62 },
    { name: '斧王', matches: 30, winRate: 80 },
  ],
};

const PLAYER = {
  score: 4120,
  heroes: ['影魔', '斧王'],
  win_rate: 68,
  positions: ['1 号位'],
};

// ---------------------------------------------------------------- ① 口径层

(async () => {
  console.log('\n[战绩口径 · 小程序移植与网页端实现对拍]');

  const LIB = await import(
    require('url').pathToFileURL(path.join(ROOT, 'lib', 'match-format.mjs')).href
  );

  // 边界样本：0 死亡（KDA 退化成求和）、0 时长、单场
  const EDGE = [
    { hero: '影魔', isWin: true, kills: 10, deaths: 0, assists: 5, duration: 0 },
    { hero: '影魔', isWin: false, kills: 0, deaths: 8, assists: 0, duration: 2400 },
    { hero: '斧王', isWin: true, kills: 3, deaths: 2, assists: 11, duration: 3601 },
  ];

  const sets = [
    ['常规 60 场', MATCHES],
    ['边界 3 场（0 死亡 / 0 时长）', EDGE],
    ['空集', []],
  ];

  for (const [label, list] of sets) {
    const a = LIB.summarize(list);
    const b = MP_STAT.summarize(list);
    const same = JSON.stringify(a) === JSON.stringify(b);
    expect(same, 'summarize 一致（' + label + '）：' + JSON.stringify(b));

    const ba = LIB.bestOf(list);
    const bb = MP_STAT.bestOf(list);
    expect(JSON.stringify(ba) === JSON.stringify(bb), 'bestOf 一致（' + label + '）：' + JSON.stringify(bb));
  }

  expect(MP_STAT.kdaOf(10, 0, 5) === LIB.kdaOf(10, 0, 5), 'kdaOf 0 死亡退化为「击杀+助攻」');
  expect(MP_STAT.kdaOf(3, 2, 11) === LIB.kdaOf(3, 2, 11), 'kdaOf 常规除法一致');

  const ms = MP_STAT.streakOf(MATCHES, 3);
  expect(!!ms && ms.n === 4 && ms.isWin, '连胜识别：最近 4 场连胜');
  expect(MP_STAT.streakOf([{ isWin: true }, { isWin: true }, { isWin: false }], 3) === null, '两连胜太短，不单独列');

  const st = MP_STAT.summarize(MATCHES);
  expect(st.total === 60 && st.wins + st.losses === 60, '场次 = 胜 + 负 = 60');

  // ---------------------------------------------------------------- ② 规则层

  console.log('\n[战绩解读 · 规则统计]');

  const out = buildInsight(DATA, PLAYER);
  const text = out.blocks.map((b) => b.num + '. ' + b.segs.map((s) => s.t).join('')).join('\n');

  expect(out.empty === false, '有数据时 empty=false');
  expect(out.items === out.blocks.length, 'items 与 blocks 数量一致');
  expect(out.items >= 6, '固定维度基本齐全（实得 ' + out.items + ' 项）');
  expect(text.indexOf('近 60 场') >= 0, '第 1 条按整份对局算样本（近 60 场），不是固定的 20 场');
  expect(
    text.indexOf(st.wins + ' 胜 ' + st.losses + ' 负') >= 0,
    '胜负数与统计一致：' + st.wins + ' 胜 ' + st.losses + ' 负'
  );
  expect(text.indexOf('万古流芳') >= 0, '4120 分归入「万古流芳」段位');
  expect(text.indexOf('生涯 900 胜 800 负') >= 0, '生涯对照用 /wl 的数字');
  expect(text.indexOf('与自报值基本一致') >= 0, '实际胜率 vs 自报 68% 差 8 个点以内，判「基本一致」');
  expect(text.indexOf('经济与输出（近 20 场）') >= 0, 'GPM / 伤害必须标「近 20 场」，不能和 200 场合在一起');
  expect(text.indexOf('常用英雄（近 60 场）') >= 0, '常用英雄窗口与样本一致');
  expect(text.indexOf('高熟练度英雄（生涯）') >= 0, '影魔(320场/58%)、潮汐(210场/62%) 过绝活门槛');
  expect(text.indexOf('潮汐猎人(210 场') < text.indexOf('影魔(320 场'), '高熟练度按胜率从高到低排（62% 在 58% 前）');
  expect(text.indexOf('斧王') < 0, '斧王只有 30 场且不在常用前三，整段结论里不该出现');
  expect(text.indexOf('最近 4 场连胜') >= 0, '连赢 4 场被识别为连胜');
  expect(!/可能|倾向|建议|推测|估计/.test(text), '结论里不出现模型口气的措辞（可能/倾向/建议/推测）');
  expect(/口径：近 60 场公开对局 · GPM\/伤害取近 20 场/.test(out.note), '页脚口径写明两个窗口：' + out.note);

  const top3 = MP_STAT.heroStatsOf(MATCHES).slice(0, 3);
  expect(top3.length === 3, '常用英雄给出前 3 个');
  expect(
    top3[0].matches >= top3[1].matches && top3[1].matches >= top3[2].matches,
    '常用英雄按场次从多到少：' + top3.map((h) => h.name + h.matches).join(' / ')
  );

  // 边界：空数据
  const empty = buildInsight(null, PLAYER);
  expect(empty.empty === true && empty.blocks.length === 0, '无对局时返回 empty 且不渲染空壳');
  expect(!!empty.emptyText, '无对局时给出可读的空态文案');

  const noMatches = buildInsight({ matches: [] }, PLAYER);
  expect(noMatches.empty === true, '空 matches 视为无数据');

  // 边界：全负 / 没有 GPM 窗口 / 没有生涯
  const bare = buildInsight(
    {
      matches: [
        { hero: '影魔', isWin: false, kills: 1, deaths: 9, assists: 2, duration: 2000 },
        { hero: '影魔', isWin: false, kills: 2, deaths: 7, assists: 3, duration: 2100 },
      ],
    },
    { score: 0, heroes: [], win_rate: 0 }
  );
  const bareText = bare.blocks.map((b) => b.segs.map((s) => s.t).join('')).join('\n');
  expect(bareText.indexOf('0 胜 2 负') >= 0, '全负时胜负数为 0 胜 2 负');
  expect(bareText.indexOf('经济与输出') < 0, '没有近 20 场数据时不出 GPM/伤害那一条');
  expect(bare.blocks.length >= 2, '缺省字段也不崩（生涯/自报/英雄缺失时只保留有的维度）');

  const streakOnly = buildInsight({ matches: [{ isWin: true }, { isWin: true }] }, {});
  expect(streakOnly.items === 1, '两场且全胜：只有第 1 条，不出现「2 连胜」');

  expect(tierOf(0) === '先锋', '0 分归「先锋」');
  expect(tierOf(5520) === '冠绝一世', '5520 分归「冠绝一世」');
  expect(streakOf(MATCHES, 3).n === 4, '导出的 streakOf 与内部实现同一份');

  // ---------------------------------------------------------------- ③ 合规层

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

  const cl = fs.readFileSync(path.join(ROOT, 'lib', 'changelog.js'), 'utf8');
  const clHit = cl.match(BANNED);
  expect(!clHit, clHit ? 'lib/changelog.js 含「' + clHit[0] + '」（会在小程序更新日志页露出）' : 'lib/changelog.js 无违规字样');

  // ---------------------------------------------------------------- ④ 数据源护栏

  console.log('\n[数据源 · 与网页端同一接口同一窗口]');

  const memberJs = fs.readFileSync(path.join(MP, 'pages', 'member', 'member.js'), 'utf8');
  expect(memberJs.indexOf('/api/ai-analysis') < 0, '名片页不请求 /api/ai-analysis');
  expect(memberJs.indexOf('utils/insight') >= 0, '名片页用本地规则统计（utils/insight）');
  expect(memberJs.indexOf("'/api/player-matches") >= 0, '名片页走 /api/player-matches（与网页同一接口）');
  expect(
    memberJs.indexOf("'/api/player-stats") < 0,
    '名片页不再走 /api/player-stats（那是最近 20 场口径，两边数字对不上的根源）'
  );

  const api = fs.readFileSync(path.join(ROOT, 'pages', 'api', 'player-matches.js'), 'utf8');
  expect(api.indexOf('recent20') >= 0, '接口返回 recent20（GPM/伤害的唯一来源）');
  expect(api.indexOf('heroesLifetime') >= 0, '接口返回 heroesLifetime（绝活判定依据）');

  console.log('\n结果：' + (fail === 0 ? '全部通过' : fail + ' 项失败'));
  process.exit(fail === 0 ? 0 : 1);
})();
