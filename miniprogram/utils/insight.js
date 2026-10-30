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
  const totals = stat.totalsOf(matches);
  const per = (n) => (total ? (n / total).toFixed(1) : '0.0');

  // 1. 样本与胜负：先说清「这堆结论是基于多少场比赛」，避免被当成全期评价
  let first = '近 ' + total + ' 场 ' + wins + ' 胜 ' + losses + ' 负，胜率 ' + winRate + '%';
  if (p.score) first += '（当前天梯 ' + p.score + ' 分 · ' + tierOf(p.score) + '）';
  push('近期战绩', first);

  // 2. 生涯对照：网页上也有这一行，两边数字同源（都来自 /wl）
  const life = d.lifetime;
  if (life && Number(life.total) > 0) {
    push(
      '生涯对照',
      '生涯 ' + Number(life.win) + ' 胜 ' + Number(life.lose) + ' 负，胜率 ' + Number(life.winRate) + '%' +
        '；近 ' + total + ' 场' + (winRate > Number(life.winRate) ? '高于' : winRate < Number(life.winRate) ? '低于' : '持平于') + '生涯水平'
    );
  }

  // 3. 自报胜率对照：只在本人填过胜率时才有意义
  const selfWin = Number(p.win_rate) || 0;
  if (selfWin > 0) {
    const gap = winRate - selfWin;
    let verdict;
    if (gap >= WINRATE_GAP) verdict = '明显高于自报值';
    else if (gap <= -WINRATE_GAP) verdict = '明显低于自报值';
    else verdict = '与自报值基本一致';
    push('自报胜率对照', '自报 ' + selfWin + '%，近 ' + total + ' 场实际 ' + winRate + '%，' + verdict);
  }

  // 4. KDA：三个分项都摆出来，用户在别处能自己复核
  const kda = Number(sum.kda) || 0;
  if (kda > 0) {
    push(
      '场均 KDA',
      sum.kda + '（' + per(totals.kills) + ' / ' + per(totals.deaths) + ' / ' + per(totals.assists) + '）' +
        '，在常见分档里属「' + pickTier(KDA_TIERS, kda) + '」'
    );
  }

  // 5. 经济与输出：只有近 20 场那个窗口有 GPM / 伤害，标题和句子里都写明，
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

  // 6. 常用英雄：只列前三，多了页面放不下。窗口与上面几条一致（近 N 场）。
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

  // 7. 绝活：按「生涯场次 + 胜率」两个硬条件筛，不做主观判断
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

  // 8. 连胜 / 连败：短于 STREAK_MIN 不提，否则「两连胜」这种噪音太多
  const streak = stat.streakOf(matches, STREAK_MIN);
  if (streak) {
    push('近期走势', '最近 ' + streak.n + ' 场' + (streak.isWin ? '连胜' : '连败'));
  }

  // 9. 自报擅长与实际常用的重合：给一个可核对的事实，不评价「该练什么」
  const hit = overlapHeroes(p.heroes, top);
  if (hit.length) {
    push('自报与实操重合', '自报擅长项里，' + hit.join('、') + ' 正好进了近期常用前三');
  }

  // 页脚口径：把「哪一段是哪个窗口」写在用户看得见的地方
  let note = '口径：近 ' + total + ' 场公开对局';
  if (r20 && Number(r20.total) > 0) note += ' · GPM/伤害取近 ' + Number(r20.total) + ' 场';
  note += ' · 不含预测';

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
