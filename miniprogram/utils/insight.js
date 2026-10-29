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
// 输出结构与页面 wx:for 直接对接：
//   { blocks: [{ k, type:'item', num, segs:[{k,b,t}] }], items: n }

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

// 绝活判定：累计场次够多且胜率过半，缺一不可
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

/** 从最近一场往前数，连续同结果的场次。recentMatches 约定最新在前。 */
function streakOf(matches) {
  const list = Array.isArray(matches) ? matches : [];
  if (!list.length) return null;
  const first = !!list[0].isWin;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (!!list[i].isWin !== first) break;
    n++;
  }
  if (n < STREAK_MIN) return null;
  return { isWin: first, n: n };
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
 * @param {object} stats  /api/player-stats 返回的 stats（可能为 null）
 * @param {object} player 名片区已有字段：nickname / score / positions / heroes / win_rate
 * @returns {{blocks: Array, items: number, empty: boolean, emptyText: string}}
 */
function buildInsight(stats, player) {
  const p = player || {};
  const blocks = [];
  let num = 0;
  const push = (head, body) => {
    num++;
    blocks.push(line(num, head, body));
  };

  if (!stats || !stats.recentTotal) {
    return {
      blocks: [],
      items: 0,
      empty: true,
      emptyText:
        '拉不到这位群友的公开战绩（没填 SteamID，或 OpenDota 上没有近 20 场记录），暂时没有可统计的数据。'
    };
  }

  const total = Number(stats.recentTotal) || 0;
  const winRate = Number(stats.recentWinRate) || 0;
  // 接口给了 recentWins 就用它；老版本没这个字段时才由胜率反推
  const wins = isFinite(Number(stats.recentWins)) && stats.recentWins !== undefined && stats.recentWins !== null
    ? Number(stats.recentWins)
    : Math.round((total * winRate) / 100);
  const losses = Math.max(0, total - wins);

  // 1. 样本与胜负：先说清「这堆结论是基于多少场比赛」，避免被当成全期评价
  push(
    '近期战绩',
    '近 ' + total + ' 场 ' + wins + ' 胜 ' + losses + ' 负，胜率 ' + winRate + '%' +
      (p.score ? '（当前天梯 ' + p.score + ' 分 · ' + tierOf(p.score) + '）' : '')
  );

  // 2. 自报胜率对照：只在本人填过胜率时才有意义
  const selfWin = Number(p.win_rate) || 0;
  if (selfWin > 0) {
    const gap = winRate - selfWin;
    let verdict;
    if (gap >= WINRATE_GAP) verdict = '明显高于自报值';
    else if (gap <= -WINRATE_GAP) verdict = '明显低于自报值';
    else verdict = '与自报值基本一致';
    push('自报胜率对照', '自报 ' + selfWin + '%，近期实际 ' + winRate + '%，' + verdict);
  }

  // 3. KDA：三个分项都摆出来，用户在别处能自己复核
  const kda = Number(stats.avgKda) || 0;
  if (kda > 0) {
    const k = Number(stats.avgKills) || 0;
    const d = Number(stats.avgDeaths) || 0;
    const a = Number(stats.avgAssists) || 0;
    push(
      '场均 KDA',
      kda + '（' + k + ' / ' + d + ' / ' + a + '），在常见分档里属「' + pickTier(KDA_TIERS, kda) + '」'
    );
  }

  // 4. 经济与输出：GPM 和英雄伤害一起说，单看一个容易被辅助位误伤
  const gpm = Number(stats.avgGpm) || 0;
  const dmg = Number(stats.avgHeroDamage) || 0;
  if (gpm > 0 || dmg > 0) {
    const parts = [];
    if (gpm > 0) parts.push('场均 GPM ' + gpm + '（' + pickTier(GPM_TIERS, gpm) + '）');
    if (dmg > 0) parts.push('场均英雄伤害 ' + dmg + '（' + pickTier(DMG_TIERS, dmg) + '）');
    push('经济与输出', parts.join('，'));
  }

  // 5. 常用英雄：只列前三，多了页面放不下。
  //    口径是「近 100 场」（接口统计窗口），跟第 1 条的近 20 场不同，标题里写清楚，
  //    否则用户会拿 25 场去对 20 场，觉得数字对不上。
  const top = (Array.isArray(stats.mostPlayedHeroes) ? stats.mostPlayedHeroes : []).slice(0, 3);
  if (top.length) {
    push(
      '常用英雄（近 100 场）',
      top
        .map(function (h) {
          return h.name + '(' + h.matches + ' 场 / ' + h.winRate + '% 胜率)';
        })
        .join('、')
    );
  }

  // 6. 绝活：按「累计场次 + 胜率」两个硬条件筛，不做主观判断
  const life = Array.isArray(stats.heroesLifetime) ? stats.heroesLifetime : [];
  const signature = life
    .filter(function (h) {
      return Number(h.matches) >= SIGNATURE_MIN_MATCHES && Number(h.winRate) > SIGNATURE_MIN_WINRATE;
    })
    .sort(function (a, b) {
      return Number(b.winRate) - Number(a.winRate);
    })
    .slice(0, 3);
  if (signature.length) {
    push(
      '高熟练度英雄',
      signature
        .map(function (h) {
          return h.name + '(' + h.matches + ' 场 / ' + h.winRate + '% 胜率)';
        })
        .join('、') +
        ' —— 累计 ' + SIGNATURE_MIN_MATCHES + ' 场以上且胜率过 ' + SIGNATURE_MIN_WINRATE + '%'
    );
  }

  // 7. 连胜 / 连败：短于 STREAK_MIN 不提，否则「两连胜」这种噪音太多
  const streak = streakOf(stats.recentMatches);
  if (streak) {
    push('近期走势', '最近 ' + streak.n + ' 场' + (streak.isWin ? '连胜' : '连败'));
  }

  // 8. 自报擅长与实际常用的重合：给一个可核对的事实，不评价「该练什么」
  const hit = overlapHeroes(p.heroes, top);
  if (hit.length) {
    push('自报与实操重合', '自报擅长的英雄里，' + hit.join('、') + ' 正好进了近期常用前三');
  }

  return { blocks: blocks, items: blocks.length, empty: false, emptyText: '' };
}

module.exports = {
  buildInsight: buildInsight,
  tierOf: tierOf,
  streakOf: streakOf,
  pickTier: pickTier
};
