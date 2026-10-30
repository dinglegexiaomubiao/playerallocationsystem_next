// 对局统计：`lib/match-format.mjs` 的手工移植（只搬统计相关的几个纯函数）。
//
// 为什么是「手工移植」而不是 require 过来：小程序没有构建步骤，包只打包
// `miniprogram/` 目录，`require('../../lib/match-format.mjs')` 在小程序里是
// 不存在的路径，而且那份是 ESM。同一个理由见 `utils/member-filter.js`。
//
// ⚠ 移植逻辑不会报错，只会慢慢漂移——所以两边必须对拍：
//   node scripts/check-mp-insight.cjs
// 里面会用同一批对局同时跑本文件和 lib/match-format.mjs，逐字段断言一致。
// **改这里就必须同步改 lib/match-format.mjs，反之亦然**，否则自检会红。
//
// 口径说明（这是这次「小程序和网页数字对不上」的根因，别改回去）：
//   - 统计样本 = /api/player-matches 返回的最多 200 场，与网页「最近比赛」同一份
//   - 模式不预过滤，与网页默认的「全部」tab 一致
//   - 对局必须按开赛时间倒序传入（接口已经排好了）

/** KDA = (击杀 + 助攻) / 死亡；0 死亡时直接给总和，与网页端一致 */
function kdaOf(kills, deaths, assists) {
  const k = Number(kills) || 0;
  const d = Number(deaths) || 0;
  const a = Number(assists) || 0;
  if (d === 0) return (k + a).toFixed(1);
  return ((k + a) / d).toFixed(1);
}

/** 在给定对局集合里算展示用的汇总 */
function summarize(matches) {
  const list = Array.isArray(matches) ? matches : [];
  const total = list.length;
  let wins = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let duration = 0;
  for (let i = 0; i < list.length; i++) {
    const m = list[i] || {};
    if (m.isWin) wins++;
    kills += m.kills || 0;
    deaths += m.deaths || 0;
    assists += m.assists || 0;
    duration += m.duration || 0;
  }
  return {
    total: total,
    wins: wins,
    losses: total - wins,
    winRate: total ? Math.round((wins / total) * 100) : 0,
    kda: total ? kdaOf(kills, deaths, assists) : '0.0',
    avgDuration: total ? Math.round(duration / total) : 0
  };
}

/** 近 N 场的最高单项（对应网页的「近 20 场最高」） */
function bestOf(matches) {
  const list = Array.isArray(matches) ? matches : [];
  let maxKills = 0;
  let maxAssists = 0;
  let maxKda = 0;
  for (let i = 0; i < Math.min(list.length, 20); i++) {
    const m = list[i] || {};
    maxKills = Math.max(maxKills, m.kills || 0);
    maxAssists = Math.max(maxAssists, m.assists || 0);
    maxKda = Math.max(maxKda, Number(kdaOf(m.kills, m.deaths, m.assists)));
  }
  return { kills: maxKills, assists: maxAssists, kda: maxKda.toFixed(1) };
}

/** 整段的击杀 / 死亡 / 助攻总和，用来算「场均 K / D / A」 */
function totalsOf(matches) {
  const list = Array.isArray(matches) ? matches : [];
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  for (let i = 0; i < list.length; i++) {
    const m = list[i] || {};
    kills += m.kills || 0;
    deaths += m.deaths || 0;
    assists += m.assists || 0;
  }
  return { kills: kills, deaths: deaths, assists: assists };
}

/**
 * 常用英雄：按使用场次从多到少。
 *
 * 网页的「近 20 场英雄格」是按时间取前 20 场，这里是按次数聚合整个样本窗口，
 * 两者用途不同——解读里要说「他常玩什么」，得用整个窗口而不是恰好最近 20 场。
 */
function heroStatsOf(matches) {
  const list = Array.isArray(matches) ? matches : [];
  const map = {};
  const order = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i] || {};
    const name = String(m.hero || '').trim();
    if (!name) continue;
    if (!map[name]) {
      map[name] = { name: name, matches: 0, wins: 0 };
      order.push(name);
    }
    map[name].matches++;
    if (m.isWin) map[name].wins++;
  }
  const out = [];
  for (let i = 0; i < order.length; i++) {
    const h = map[order[i]];
    out.push({
      name: h.name,
      matches: h.matches,
      winRate: h.matches > 0 ? Math.round((h.wins / h.matches) * 100) : 0
    });
  }
  // 场次相同的按名字排，保证同一份数据每次输出一致（否则解读顺序会跳）
  out.sort(function (a, b) {
    if (b.matches !== a.matches) return b.matches - a.matches;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return out;
}

/**
 * 从最近一场往前数，连续同结果的场次。对局约定最新在前。
 * 短于 min 的连败连胜没有意义，返回 null。
 */
function streakOf(matches, min) {
  const list = Array.isArray(matches) ? matches : [];
  const floor = Number(min) > 0 ? Number(min) : 3;
  if (!list.length) return null;
  const first = !!list[0].isWin;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (!!list[i].isWin !== first) break;
    n++;
  }
  if (n < floor) return null;
  return { isWin: first, n: n };
}

/** 秒 → 33:12 */
function fmtDuration(sec) {
  const s = Number(sec) || 0;
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' + r : String(r));
}

module.exports = {
  kdaOf: kdaOf,
  summarize: summarize,
  bestOf: bestOf,
  totalsOf: totalsOf,
  heroStatsOf: heroStatsOf,
  streakOf: streakOf,
  fmtDuration: fmtDuration
};
