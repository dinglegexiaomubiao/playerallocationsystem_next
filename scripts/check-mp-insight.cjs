#!/usr/bin/env node
/**
 * 群友名片「战绩解读」自检。
 *
 * 2026-10-30 起小程序重新展示**服务器生成的 AI 文本**（POST /api/ai-analysis，
 * 服务器内部调大模型）。2026-10-29 曾因「涉及深度合成技术」被驳回，算力在哪不影响
 * 判定，提审风险随之回来（见 小程序项目档案 提审记录）。自检分三块：
 *
 *   ① 口径层：`utils/match-stat.js` 是 `lib/match-format.mjs` 的手工移植，
 *      两边必须对同一批对局给出逐字段相同的汇总——这是「小程序和网页数字对不上」
 *      那次事故的护栏，漂移了就在这里红；
 *   ② 规则层：buildInsight（本地规则引擎，现仅作离线自检/可回退参考保留）
 *      对同一份数字必须给出同一份结论，分档边界不漏，且样本口径固定为整份对局
 *      （最多 200 场），GPM/伤害必须自带「近 20 场」标签；
 *   ③ AI 呈现护栏：不再禁止「AI」字样，而是确保 AI 区块被明确标注、且必须登录才能触发，
 *      避免误导用户与额度滥用。
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
      // 下面这几个字段是 2026-10-30 扩维度时补上的：
      // 模式/组队/段位/版本四条结论全靠它们，缺了那几条就出不来
      modeLabel: i % 5 === 0 ? '普通' : '天梯',
      partySize: i % 4 === 0 ? 3 : 1,
      rankLabel: i % 2 === 0 ? '传奇 3' : '传奇 4',
      patch: i % 2 === 0 ? '7.41' : '7.40',
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

  /* ---- 2026-10-30 扩维度时新增的七个函数，同样要逐字段对拍 ----
     这几个是「名片页内容太少」那次补的，网页端暂时没调用（放在 lib 里是为了只有一份实现），
     但小程序必须抄一份，所以照样纳入对拍——漂移了就在这里红。 */
  const NEW_FNS = [
    'averagesOf',
    'modeBreakdown',
    'durationByResult',
    'partyBreakdown',
    'rankMode',
    'patchBreakdown',
  ];
  for (const fn of NEW_FNS) {
    for (const [label, list] of sets) {
      const a = JSON.stringify(LIB[fn](list));
      const b = JSON.stringify(MP_STAT[fn](list));
      expect(a === b, fn + ' 一致（' + label + '）：' + (b.length > 90 ? b.slice(0, 90) + '…' : b));
    }
  }

  const ACT_NOW = 1760100000;
  expect(
    JSON.stringify(LIB.activityOf(MATCHES, 7, ACT_NOW)) === JSON.stringify(MP_STAT.activityOf(MATCHES, 7, ACT_NOW)),
    'activityOf 一致（固定时钟）：' + JSON.stringify(MP_STAT.activityOf(MATCHES, 7, ACT_NOW))
  );
  expect(
    LIB.fmtAgo(MATCHES[1].startTime, ACT_NOW * 1000) === MP_STAT.fmtAgo(MATCHES[1].startTime, ACT_NOW * 1000),
    'fmtAgo 一致：' + MP_STAT.fmtAgo(MATCHES[1].startTime, ACT_NOW * 1000)
  );
  // 空集不能炸：这几个函数都会被「一个号 0 场」的路径调到
  expect(MP_STAT.modeBreakdown([]).length === 0, 'modeBreakdown 空集返回空数组');
  expect(MP_STAT.rankMode([]) === null, 'rankMode 空集返回 null（没有段位数据时不下结论）');
  expect(MP_STAT.activityOf([]) === null, 'activityOf 空集返回 null');

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
  expect(out.items >= 10, '固定维度基本齐全（实得 ' + out.items + ' 项）');
  expect(text.indexOf('近 60 场') >= 0, '第 1 条按整份对局算样本（近 60 场），不是固定的 20 场');
  expect(
    text.indexOf(st.wins + ' 胜 ' + st.losses + ' 负') >= 0,
    '胜负数与统计一致：' + st.wins + ' 胜 ' + st.losses + ' 负'
  );
  expect(text.indexOf('万古流芳') >= 0, '4120 分归入「万古流芳」段位');
  expect(text.indexOf('生涯 900 胜 800 负') >= 0, '生涯对照用 /wl 的数字');
  expect(text.indexOf('与自报值基本一致') >= 0, '实际胜率 vs 自报 68% 差 8 个点以内，判「基本一致」');
  expect(text.indexOf('经济与输出（近 20 场）') >= 0, 'GPM / 伤害必须标「近 20 场」，不能和 200 场合在一起');
  expect(text.indexOf('常用擅长项（近 60 场）') >= 0, '常用擅长项窗口与样本一致');
  expect(text.indexOf('高熟练度擅长项（生涯）') >= 0, '影魔(320场/58%)、潮汐(210场/62%) 过绝活门槛');
  expect(text.indexOf('潮汐猎人(210 场') < text.indexOf('影魔(320 场'), '高熟练度按胜率从高到低排（62% 在 58% 前）');
  expect(text.indexOf('斧王') < 0, '斧王只有 30 场且不在常用前三，整段结论里不该出现');
  expect(text.indexOf('最近 4 场连胜') >= 0, '连赢 4 场被识别为连胜');
  expect(!/可能|倾向|建议|推测|估计/.test(text), '结论里不出现模型口气的措辞（可能/倾向/建议/推测）');

  // ---- 2026-10-30 新增的六条维度 ----
  expect(text.indexOf('对局构成') >= 0, '「对局构成」按 modeLabel + 单排/组队给出一行');
  expect(/模式 天梯 \d+ 场 \/ 普通 \d+ 场/.test(text), '模式分布按场次从多到少：' + text.split('\n')[1]);
  expect(/单排 \d+ 场（胜率 \d+%） · 组队 \d+ 场（胜率 \d+%）/.test(text), '单排 / 组队各带胜率');
  expect(
    text.indexOf('对局段位') >= 0 && text.indexOf('「传奇 4」30 场') >= 0,
    '对局段位取众数（传奇 3 / 传奇 4 各 30 场，平票按字典序取「传奇 4」，保证每次一致）'
  );
  expect(/60 场有段位数据，占 100%/.test(text), '段位结论必须写明有数据的覆盖场次');
  expect(text.indexOf('场均数据') >= 0 && text.indexOf('死亡数属') >= 0, '「场均数据」含 KDA、场均 K/D/A 与死亡分档');

  // 助攻/击杀比：主夹具里两者接近 1，属于不描述区间，所以单独造一组明显的
  const assistCase = buildInsight(
    {
      matches: [
        { hero: '水晶室女', isWin: true, kills: 2, deaths: 5, assists: 14, duration: 2100 },
        { hero: '水晶室女', isWin: false, kills: 1, deaths: 7, assists: 11, duration: 2200 },
      ],
    },
    {}
  );
  const assistText = assistCase.blocks.map((b) => b.segs.map((s) => s.t).join('')).join('\n');
  expect(assistText.indexOf('助攻是击杀的 8.3 倍') >= 0, '助攻显著多于击杀时点明倍数（14+11 / 2+1 = 8.3）');
  // 反过来：击杀碾压助攻时也要说，但用另一种措辞
  const carryCase = buildInsight(
    {
      matches: [
        { hero: '影魔', isWin: true, kills: 16, deaths: 3, assists: 4, duration: 2100 },
        { hero: '影魔', isWin: true, kills: 12, deaths: 2, assists: 3, duration: 2200 },
      ],
    },
    {}
  );
  const carryText = carryCase.blocks.map((b) => b.segs.map((s) => s.t).join('')).join('\n');
  expect(carryText.indexOf('击杀多于助攻') >= 0, '击杀远多于助攻时点明（助攻 / 击杀 0.3）');
  // 两者接近 1 时不硬编一句废话
  const evenCase = buildInsight(
    {
      matches: [
        { hero: '影魔', isWin: true, kills: 8, deaths: 3, assists: 8, duration: 2100 },
        { hero: '影魔', isWin: true, kills: 8, deaths: 3, assists: 8, duration: 2100 },
      ],
    },
    {}
  );
  const evenText = evenCase.blocks.map((b) => b.segs.map((s) => s.t).join('')).join('\n');
  expect(
    evenText.indexOf('助攻是击杀的') < 0 && evenText.indexOf('击杀多于助攻') < 0,
    '助攻/击杀接近 1 时不出这条（否则等于说废话）'
  );

  // 全部字段缺失时，这几条新增维度必须各自安静地跳过，不能吐出「0 场」这种空话
  const sparse = buildInsight(
    {
      matches: [
        { hero: '影魔', isWin: true, kills: 5, deaths: 3, assists: 6, duration: 2000 },
        { hero: '影魔', isWin: false, kills: 3, deaths: 5, assists: 4, duration: 2100 },
      ],
    },
    {}
  );
  const sparseText = sparse.blocks.map((b) => b.segs.map((s) => s.t).join('')).join('\n');
  expect(sparseText.indexOf('对局构成') < 0, '没有 modeLabel / partySize 时不出「对局构成」');
  expect(sparseText.indexOf('对局段位') < 0, '没有 rankLabel 时不出「对局段位」');
  expect(sparseText.indexOf('版本对照') < 0, '没有 patch 时不出「版本对照」');
  expect(sparseText.indexOf('活跃度') < 0, '没有 startTime 时不出「活跃度」');
  expect(text.indexOf('活跃度') >= 0 && /近 7 天打了 \d+ 场/.test(text), '「活跃度」给出最近一场与近 7 天场次');
  expect(text.indexOf('版本对照') >= 0 && /7\.40 打了 30 场/.test(text), '「版本对照」拿当前版本和其余场次最多的版本比');

  // 胜负与时长：主夹具里胜/负平均时长差不到 2 分钟，所以单独造一组刚好过线的
  const durWin = [];
  for (let i = 0; i < 5; i++) durWin.push({ hero: '影魔', isWin: true, kills: 5, deaths: 1, assists: 5, duration: 2400 });
  const durLose = [];
  for (let i = 0; i < 5; i++) durLose.push({ hero: '影魔', isWin: false, kills: 2, deaths: 6, assists: 4, duration: 1800 });
  const durOut = buildInsight({ matches: durWin.concat(durLose) }, {});
  const durText = durOut.blocks.map((b) => b.segs.map((s) => s.t).join('')).join('\n');
  expect(/赢的 5 场平均 40:00，输的 5 场平均 30:00，赢下的局平均多打 10:00/.test(durText), '胜负与时长：差 10 分钟要点明方向与差值');
  const shortCase = buildInsight(
    {
      matches: [
        { hero: '影魔', isWin: true, kills: 5, deaths: 1, assists: 5, duration: 1830 },
        { hero: '影魔', isWin: false, kills: 2, deaths: 6, assists: 4, duration: 1800 },
      ],
    },
    {}
  );
  expect(
    shortCase.blocks.map((b) => b.segs.map((s) => s.t).join('')).join('\n').indexOf('胜负与时长') < 0,
    '两端场次不足 5 场时不出「胜负与时长」'
  );
  expect(/口径：近 60 场公开对局 · GPM\/伤害取近 20 场/.test(out.note), '页脚口径写明两个窗口：' + out.note);

  const top3 = MP_STAT.heroStatsOf(MATCHES).slice(0, 3);
  expect(top3.length === 3, '常用擅长项给出前 3 个');
  expect(
    top3[0].matches >= top3[1].matches && top3[1].matches >= top3[2].matches,
    '常用擅长项按场次从多到少：' + top3.map((h) => h.name + h.matches).join(' / ')
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

  // ---------------------------------------------------------------- ③ AI 呈现护栏

  console.log('\n[AI 呈现 · 明确标注 + 登录前置，避免误导与额度滥用]');

  // 2026-10-30 起小程序重新展示服务器生成的 AI 文本（提审风险见 小程序项目档案）。
  // 护栏目标变了：不再禁止「AI」字样，而是确保它被明确标注、且必须登录才能触发。
  const memberWxml2 = fs.readFileSync(path.join(MP, 'pages', 'member', 'member.wxml'), 'utf8');
  expect(memberWxml2.indexOf('AI 战绩分析') >= 0, '名片页该区块明确标注「AI 战绩分析」');
  expect(memberWxml2.indexOf('由服务器 AI 生成') >= 0, 'AI 文本处标注「由服务器 AI 生成」，让用户/审核知道是生成式内容');

  const memberJs2 = fs.readFileSync(path.join(MP, 'pages', 'member', 'member.js'), 'utf8');
  expect(memberJs2.indexOf('/api/ai-analysis') >= 0, '名片页改用服务端 /api/ai-analysis（服务器调大模型）');
  expect(memberJs2.indexOf('session.isLoggedIn()') >= 0, '名片页在调 AI 前检查登录态（与网页一致，防额度滥用）');
  expect(memberJs2.indexOf('pages/login/login') >= 0, '未登录时引导去登录页，而不是直接调 AI');

  // ---------------------------------------------------------------- ④ 数据源护栏

  console.log('\n[数据源 · 战绩口径与网页端同源]');

  // memberJs2 已在 ③ 读取，这里复用
  expect(memberJs2.indexOf('utils/insight') < 0, '名片页不再用本地规则引擎（utils/insight），改走服务端 AI');
  expect(memberJs2.indexOf("'/api/player-matches") >= 0, '名片页仍走 /api/player-matches（与网页同一接口）');
  expect(
    memberJs2.indexOf("'/api/player-stats") < 0,
    '名片页不直接走 /api/player-stats（由服务端 /api/ai-analysis 内部拉取，避免重复往返）'
  );

  const api = fs.readFileSync(path.join(ROOT, 'pages', 'api', 'player-matches.js'), 'utf8');
  expect(api.indexOf('recent20') >= 0, '接口返回 recent20（GPM/伤害的唯一来源）');
  expect(api.indexOf('heroesLifetime') >= 0, '接口返回 heroesLifetime（绝活判定依据）');

  // ---------------------------------------------------------------- ⑤ 展示层
  // 「内容太少」那次补的三块：模式分布 / 近 20 场色块 / 逐场明细。
  // 它们全靠 member.js 算好塞进 setData，wxml 只是渲染，两边缺一个就是空白块。
  console.log('\n[展示层 · 名片页补齐的三块内容]');

  const memberWxml = fs.readFileSync(path.join(MP, 'pages', 'member', 'member.wxml'), 'utf8');
  expect(memberJs2.indexOf('stat.modeBreakdown') >= 0, 'member.js 算模式分布');
  expect(memberJs2.indexOf('tiles:') >= 0, 'member.js 生成近 20 场色块数据');
  expect(memberJs2.indexOf('listMore') >= 0, 'member.js 给逐场明细分页开关');
  expect(memberJs2.indexOf('onTapMoreMatches') >= 0, 'member.js 有「展开更多」处理函数');
  expect(memberWxml.indexOf('stats-modes') >= 0, 'wxml 渲染模式分布');
  expect(memberWxml.indexOf('class="tiles"') >= 0, 'wxml 渲染近 20 场色块');
  expect(memberWxml.indexOf('class="mlist"') >= 0, 'wxml 渲染逐场明细');
  expect(memberWxml.indexOf('bindtap="onTapMoreMatches"') >= 0, '「展开更多」已绑定');
  // 逐场明细里网页端有的字段，小程序一个都不能少
  for (const f of ['item.kdaText', 'item.mode', 'item.durText', 'item.patch', 'item.rank', 'item.ago']) {
    expect(memberWxml.indexOf(f) >= 0, '逐场明细包含 ' + f);
  }

  console.log('\n结果：' + (fail === 0 ? '全部通过' : fail + ' 项失败'));
  process.exit(fail === 0 ? 0 : 1);
})();
