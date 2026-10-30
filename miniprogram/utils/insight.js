// 战绩解读：把 OpenDota 的公开战绩数字，按固定规则整理成分条结论。
//
// ⚠ 这里**不调用任何大模型**，每句话都能追溯到具体数字（阈值就是下面那几个常量）。
// 这不是技术取舍，是合规硬约束：个人主体小程序未开放「深度合成 / AI 生成」服务类目，
// 页面上只要出现由模型生成的文字，提审就会被判「涉及深度合成技术」驳回
// （2026-10-29 实际被驳回过一次）。
//
// 所以这个文件只做算术和分档：不推断、不预测、不写「可能 / 倾向 / 建议练」这类模型口气。
// 想加新维度，先问自己：这条结论背后的数字是哪一个？指不出来就别加。
//
// ---- 样本口径（2026-10-29 改，别改回去）----
// 输入换成了 /api/player-matches 的那份数据，也就是**最多 200 场**，
// 与网页成员页「最近比赛」的默认「全部」tab 完全同源。
// 之前用的是 /api/player-stats 的 recentMatches（最近 20 场），
// 结果同一个人的胜率在小程序和网页能差 35 个百分点（实测账号 124801257：25% vs 60%）。
// 20 场里一波连胜就能把胜率抬高 15 个点，样本太薄，不作为结论基础。
//
// 唯一的例外是 GPM 和英雄伤害：只有 recentMatches 这个窗口给这两个字段，
// 所以它们单独标注「近 20 场」，绝不和 200 场的胜率混在一句话里。
//
// 输出结构与页面 wx:for 直接对接：
//   { blocks: [{ k, type:'item', num, segs:[{k,b,t}] }], items, note }
//
// ---- 维度清单（2026-10-30 扩过一次，用户反馈「内容太少」）----
// 潜在 14 条，实际条数取决于这个号有没有对应数据：
//   1 近期战绩  2 对局构成  3 对局段位  4 生涯对照  5 自报胜率对照
//   6 场均数据  7 胜负与时长  8 经济与输出  9 常用擅长项  10 自报与实操重合
//   11 高熟练度擅长项  12 版本对照  13 近期走势  14 活跃度
// 每条都对应 /api/player-matches 里的一个字段，没有对应数据就整条不出现
// （比如一个号 200 场全在同一个版本，第 12 条就不会有）。

const stat = require('./match-stat.js');

// ---- 分档阈值（改这里就等于改结论，别在下面写魔法数字） ----
const KDA_TIERS = [
  [4.5, '很突出'],
  [3.5, '偏高'],
  [2.5, '中等'],
  [1.8, '偏低'],
  [0, '明显偏低']
];

const GPM_TIERS = [
  [600, '偏高'],
  [500, '中等偏上'],
  [400, '中等'],
  [0, '偏低']
];

const DMG_TIERS = [
  [30000, '偏高'],
  [20000, '中等'],
  [0, '偏低']
];

// 场均死亡分档。实测群里主力号多在 4~7 次，所以 6 以上才算多
const DEATH_TIERS = [
  [8, '明显偏多'],
  [6, '偏多'],
  [4, '中等'],
  [2, '偏少'],
  [0, '明显偏少']
];

// 助攻 / 击杀比：1 附近是噪音，只在明显偏一侧时才描述
const ASSIST_RATIO_HIGH = 1.5;
const ASSIST_RATIO_LOW = 0.8;

// 胜负平均时长差：少于 2 分钟不值得单独说；两端各至少 5 场才有可比性
const DURATION_GAP = 120;
const DURATION_MIN_SIDE = 5;

// 版本对照：两个版本各至少这么多场才提，否则是「换版本那天刚好输了两把」
const PATCH_MIN_MATCHES = 10;

// 对局段位：有段位数据的场次少于这个数就不下结论（average_rank 常为 null）
const RANK_MIN_COVERED = 10;

// 活跃度窗口（天）
const ACTIVITY_DAYS = 7;

// 自报胜率与实际胜率的「吻合」区间：差 8 个百分点以内不评价
const WINRATE_GAP = 8;

// 绝活判定：累计场次够多且胜率过半，缺一不可。用的是生涯数据，不是这 200 场。
const SIGNATURE_MIN_MATCHES = 100;
const SIGNATURE_MIN_WINRATE = 51;

// 连胜 / 连败至少这么长才值得单独说
const STREAK_MIN = 3;

const TIER_TABLE = [
  [5420, '冠绝一世'],
  [4620, '超凡入圣'],
  [3850, '万古流芳'],
  [3080, '传奇'],
  [2310, '统帅'],
  [1540, '中军'],
  [770, '卫士'],
  [0, '先锋']
];

function tierOf(score) {
  const n = Number(score) || 0;
  for (let i = 0; i < TIER_TABLE.length; i++) {
    if (n >= TIER_TABLE[i][0]) return TIER_TABLE[i][1];
  }
  return '未定级';
}

function pickTier(tiers, value) {
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return '';
  for (let i = 0; i < tiers.length; i++) {
    if (n >= tiers[i][0]) return tiers[i][1];
  }
  return '';
}

/** 一行「小标题：正文」。num 从 1 开始，segs 里第一段加粗当小标题。 */
function line(num, head, body) {
  return {
    k: num - 1,
    type: 'item',
    num: String(num),
    segs: [
      { k: 0, b: true, t: head },
      { k: 1, b: false, t: '：' + body }
    ]
  };
}

/** 英雄名列表（自报擅长）与近期常用英雄的重合 */
function overlapHeroes(selfHeroes, topHeroes) {
  const self = Array.isArray(selfHeroes) ? selfHeroes : [];
  const top = Array.isArray(topHeroes) ? topHeroes : [];
  if (!self.length || !top.length) return [];
  const hit = [];
  for (let i = 0; i < self.length; i++) {
    const name = String(self[i] || '').trim();
    if (!name) continue;
    for (let j = 0; j < top.length; j++) {
      if (String(top[j].name || '').trim() === name) {
        hit.push(name);
        break;
      }
    }
  }
  return hit;
}

/**
 * @param {object} data  /api/player-matches 返回体（至少要有 matches）
 * @param {object} player 名片区已有字段：nickname / score / positions / heroes / win_rate
 * @returns {{blocks: Array, items: number, note: string, empty: boolean, emptyText: string, summary: object|null}}
 */
function buildInsight(data, player) {
  const p = player || {};
  const d = data || {};
  const matches = Array.isArray(d.matches) ? d.matches : [];
  const blocks = [];
  let num = 0;
  const push = (head, body) => {
    num++;
    blocks.push(line(num, head, body));
  };

  if (!matches.length) {
    return {
      blocks: [],
      items: 0,
      note: '',
      summary: null,
      empty: true,
      emptyText:
        '拉不到这位群友的公开对局（没填 SteamID，或 OpenDota 上没有近 200 场记录），暂时没有可统计的数据。'
    };
  }

  const sum = stat.summarize(matches);
  const total = sum.total;
  const wins = sum.wins;
  const losses = sum.losses;
  const winRate = sum.winRate;

  // 1. 样本与胜负：先说清「这堆结论是基于多少场比赛」，避免被当成全期评价
  let first = '近 ' + total + ' 场 ' + wins + ' 胜 ' + losses + ' 负，胜率 ' + winRate + '%';
  if (p.score) first += '（当前天梯 ' + p.score + ' 分 · ' + tierOf(p.score) + '）';
  push('近期战绩', first);

  // 2. 对局构成：这批对局都打在什么模式里、单排还是组队。
  //    只拿得到 modeLabel 才有意义——全是「其他」说明接口没给模式，宁可不写。
  const modes = stat.modeBreakdown(matches);
  const party = stat.partyBreakdown(matches);
  const modeOk = modes.length > 1 || (modes.length === 1 && modes[0].label !== '其他');
  const constitution = [];
  if (modeOk) {
    const shown = modes.slice(0, 4).map(function (m) {
      return m.label + ' ' + m.total + ' 场';
    });
    constitution.push('模式 ' + shown.join(' / ') + (modes.length > 4 ? ' 等' : ''));
  }
  if (party.solo.total > 0 && party.team.total > 0) {
    constitution.push(
      '单排 ' + party.solo.total + ' 场（胜率 ' + party.solo.winRate + '%）' +
        ' · 组队 ' + party.team.total + ' 场（胜率 ' + party.team.winRate + '%）'
    );
  }
  if (constitution.length) push('对局构成', constitution.join('；'));

  // 3. 对局段位：average_rank 常为 null，所以必须带上「有数据的场次」，
  //    否则会被当成「这 200 场都在这个段位」。
  const rank = stat.rankMode(matches);
  if (rank && rank.covered >= RANK_MIN_COVERED) {
    push(
      '对局段位',
      '出现最多的是「' + rank.label + '」' + rank.total + ' 场（' +
        rank.covered + ' 场有段位数据，占 ' + Math.round((rank.covered / total) * 100) + '%）'
    );
  }

  // 4. 生涯对照：网页上也有这一行，两边数字同源（都来自 /wl）
  const life = d.lifetime;
  if (life && Number(life.total) > 0) {
    push(
      '生涯对照',
      '生涯 ' + Number(life.win) + ' 胜 ' + Number(life.lose) + ' 负，胜率 ' + Number(life.winRate) + '%' +
        '；近 ' + total + ' 场' + (winRate > Number(life.winRate) ? '高于' : winRate < Number(life.winRate) ? '低于' : '持平于') + '生涯水平'
    );
  }

  // 5. 自报胜率对照：只在本人填过胜率时才有意义
  const selfWin = Number(p.win_rate) || 0;
  if (selfWin > 0) {
    const gap = winRate - selfWin;
    let verdict;
    if (gap >= WINRATE_GAP) verdict = '明显高于自报值';
    else if (gap <= -WINRATE_GAP) verdict = '明显低于自报值';
    else verdict = '与自报值基本一致';
    push('自报胜率对照', '自报 ' + selfWin + '%，近 ' + total + ' 场实际 ' + winRate + '%，' + verdict);
  }

  // 6. 场均数据：KDA 三分项 + 死亡分档 + 助攻/击杀结构，一条说完，
  //    不再单拆几条——分项数字摆出来，用户在别处能自己复核
  const avg = stat.averagesOf(matches);
  const avgKills = Number(avg.kills) || 0;
  const avgDeaths = Number(avg.deaths) || 0;
  const avgAssists = Number(avg.assists) || 0;
  if (avgKills + avgDeaths + avgAssists > 0) {
    const seg = [
      'KDA ' + sum.kda + '（场均 ' + avg.kills + ' 击杀 / ' + avg.deaths + ' 死亡 / ' + avg.assists + ' 助攻）',
    ];
    const kdaTier = pickTier(KDA_TIERS, Number(sum.kda) || 0);
    if (kdaTier) seg.push('KDA 属「' + kdaTier + '」');
    const deathTier = pickTier(DEATH_TIERS, avgDeaths);
    if (deathTier) seg.push('死亡数属「' + deathTier + '」');
    // 助攻与击杀都非 0 才谈比例，否则除出来的是假信号
    if (avgKills > 0 && avgAssists > 0) {
      const ratio = avgAssists / avgKills;
      if (ratio >= ASSIST_RATIO_HIGH) {
        seg.push('助攻是击杀的 ' + ratio.toFixed(1) + ' 倍');
      } else if (ratio <= ASSIST_RATIO_LOW) {
        seg.push('击杀多于助攻（助攻 / 击杀 ' + ratio.toFixed(1) + '）');
      }
    }
    push('场均数据', seg.join('，'));
  }

  // 7. 胜负与时长：同样的样本里，赢的局和输的局打得长短差多少
  const dur = stat.durationByResult(matches);
  if (
    dur.winCount >= DURATION_MIN_SIDE &&
    dur.loseCount >= DURATION_MIN_SIDE &&
    Math.abs(dur.diff) >= DURATION_GAP
  ) {
    push(
      '胜负与时长',
      '赢的 ' + dur.winCount + ' 场平均 ' + stat.fmtDuration(dur.winAvg) +
        '，输的 ' + dur.loseCount + ' 场平均 ' + stat.fmtDuration(dur.loseAvg) +
        '，' + (dur.diff > 0 ? '赢下的局平均多打 ' : '赢下的局平均少打 ') +
        stat.fmtDuration(Math.abs(dur.diff))
    );
  }

  // 8. 经济与输出：只有近 20 场那个窗口有 GPM / 伤害，标题和句子里都写明，
  //    否则用户会拿它去对上面 200 场的胜率。
  const r20 = d.recent20;
  if (r20 && (Number(r20.avgGpm) > 0 || Number(r20.avgHeroDamage) > 0)) {
    const parts = [];
    if (Number(r20.avgGpm) > 0) parts.push('场均 GPM ' + r20.avgGpm + '（' + pickTier(GPM_TIERS, r20.avgGpm) + '）');
    if (Number(r20.avgHeroDamage) > 0) {
      parts.push('场均伤害 ' + r20.avgHeroDamage + '（' + pickTier(DMG_TIERS, r20.avgHeroDamage) + '）');
    }
    push('经济与输出（近 ' + Number(r20.total) + ' 场）', parts.join('，'));
  }

  // 9. 常用英雄：只列前三，多了页面放不下。窗口与上面几条一致（近 N 场）。
  const heroes = stat.heroStatsOf(matches);
  const top = heroes.slice(0, 3);
  if (top.length) {
    push(
      '常用擅长项（近 ' + total + ' 场）',
      top
        .map(function (h) {
          return h.name + '(' + h.matches + ' 场 / ' + h.winRate + '% 胜率)';
        })
        .join('、')
    );
  }

  // 10. 自报擅长与实际常用的重合：给一个可核对的事实，不评价「该练什么」
  const hit = overlapHeroes(p.heroes, top);
  if (hit.length) {
    push('自报与实操重合', '自报擅长项里，' + hit.join('、') + ' 正好进了近期常用前三');
  }

  // 11. 绝活：按「生涯场次 + 胜率」两个硬条件筛，不做主观判断
  const lifeHeroes = Array.isArray(d.heroesLifetime) ? d.heroesLifetime : [];
  const signature = lifeHeroes
    .filter(function (h) {
      return Number(h.matches) >= SIGNATURE_MIN_MATCHES && Number(h.winRate) > SIGNATURE_MIN_WINRATE;
    })
    .sort(function (a, b) {
      return Number(b.winRate) - Number(a.winRate);
    })
    .slice(0, 3);
  if (signature.length) {
    push(
      '高熟练度擅长项（生涯）',
      signature
        .map(function (h) {
          return h.name + '(' + h.matches + ' 场 / ' + h.winRate + '% 胜率)';
        })
        .join('、') +
        ' —— 生涯 ' + SIGNATURE_MIN_MATCHES + ' 场以上且胜率过 ' + SIGNATURE_MIN_WINRATE + '%'
    );
  }

  // 12. 版本对照：拿「最近一场所在的版本」和「其余版本里场次最多的那个」比。
  //     matches 已按开赛时间倒序，所以 matches[0].patch 就是当前版本。
  const patches = stat.patchBreakdown(matches);
  const curPatch = String((matches[0] || {}).patch || '');
  let curRow = null;
  let prevRow = null;
  for (let i = 0; i < patches.length; i++) {
    if (patches[i].label === curPatch) curRow = patches[i];
    else if (!prevRow || patches[i].total > prevRow.total) prevRow = patches[i];
  }
  if (curRow && prevRow && curRow.total >= PATCH_MIN_MATCHES && prevRow.total >= PATCH_MIN_MATCHES) {
    push(
      '版本对照',
      prevRow.label + ' 打了 ' + prevRow.total + ' 场（胜率 ' + prevRow.winRate + '%），' +
        curRow.label + ' 打了 ' + curRow.total + ' 场（胜率 ' + curRow.winRate + '%）'
    );
  }

  // 13. 连胜 / 连败：短于 STREAK_MIN 不提，否则「两连胜」这种噪音太多
  const streak = stat.streakOf(matches, STREAK_MIN);
  if (streak) {
    push('近期走势', '最近 ' + streak.n + ' 场' + (streak.isWin ? '连胜' : '连败'));
  }

  // 14. 活跃度：最近一场多久之前 + 近 N 天打了多少场
  const act = stat.activityOf(matches, ACTIVITY_DAYS);
  if (act) {
    const ago = act.agoDays <= 0 ? '24 小时内' : act.agoDays + ' 天前';
    push('活跃度', '最近一场在 ' + ago + '，近 ' + act.days + ' 天打了 ' + act.recent + ' 场');
  }

  // 页脚口径：把「哪一段是哪个窗口」写在用户看得见的地方
  let note = '口径：近 ' + total + ' 场公开对局';
  if (r20 && Number(r20.total) > 0) note += ' · GPM/伤害取近 ' + Number(r20.total) + ' 场';
  note += ' · 段位取众数 · 不含预测';

  return {
    blocks: blocks,
    items: blocks.length,
    note: note,
    summary: {
      total: total,
      wins: wins,
      losses: losses,
      winRate: winRate,
      kda: sum.kda,
      avgDuration: sum.avgDuration
    },
    empty: false,
    emptyText: ''
  };
}

module.exports = {
  buildInsight: buildInsight,
  tierOf: tierOf,
  streakOf: stat.streakOf,
  pickTier: pickTier
};
