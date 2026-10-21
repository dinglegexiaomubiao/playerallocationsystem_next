/**
 * 对局数据的展示格式化（纯函数，服务端与前端共用）。
 *
 * 数据来自 OpenDota /players/{id}/matches，字段含义：
 *   lobby_type  0 普通 / 5 队长天梯 / 6 单排天梯 / 7 天梯 / 2 比赛 …
 *   game_mode   1 全阵营 / 18 技能征召(OMG) / 22 全阵营征召 / 23 加速 …
 *   version     版本号，对应 OpenDota /constants/patch 的 id
 *   average_rank 平均段位（rank_tier 原值，如 53 = 传奇 3 星），常为 null
 */

export const MODE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'ranked', label: '天梯' },
  { key: 'normal', label: '普通' },
  { key: 'turbo', label: '加速' },
  { key: 'omg', label: 'OMG' },
];

const RANK_TIERS = {
  1: '先锋',
  2: '卫士',
  3: '中军',
  4: '统帅',
  5: '传奇',
  6: '万古流芳',
  7: '超凡入圣',
  8: '冠绝一世',
};

/** 把一局归到哪个 tab */
export function modeKeyOf(match) {
  const g = Number(match.game_mode);
  if (g === 18) return 'omg';
  if (g === 23) return 'turbo';
  const l = Number(match.lobby_type);
  if (l === 5 || l === 6 || l === 7) return 'ranked';
  if (l === 0) return 'normal';
  return 'other';
}

/** 列表里显示的模式名（比 tab 更细，能区分「比赛」「活动」） */
export function modeLabelOf(match) {
  const key = modeKeyOf(match);
  if (key === 'omg') return '技能征召';
  if (key === 'turbo') return '加速';
  if (key === 'ranked') return '天梯';
  if (key === 'normal') return Number(match.game_mode) === 1 ? '全阵营' : '普通';
  const l = Number(match.lobby_type);
  if (l === 1) return '私房';
  if (l === 2) return '比赛';
  if (l === 4) return '人机';
  if (l === 9) return '勇士联赛';
  return '其他';
}

/**
 * 实际要显示的 tab。
 * 「其他」（私房 inhouse、勇士联赛这类）有数据才出现——
 * 群内训练赛正好落在这里，直接藏掉会让四分之一的对局无处可查。
 */
export function modeTabsFor(counts) {
  const tabs = MODE_TABS.slice();
  const other = (counts && counts.other) || 0;
  if (other > 0) tabs.push({ key: 'other', label: '其他' });
  return tabs;
}

/** average_rank → 「传奇 3」；拿不到就空串 */
export function rankLabelOf(averageRank) {
  const v = Number(averageRank);
  if (!v || v < 10) return '';
  const tier = Math.floor(v / 10);
  const star = v % 10;
  const name = RANK_TIERS[tier];
  if (!name) return '';
  return star > 0 ? `${name} ${star}` : name;
}

/**
 * 按开赛时间推版本：取「发布日期 ≤ 开赛时间」里最新的那个版本。
 *
 * 不能用 OpenDota 对局里的 `version` 字段——实测它在一份 2023~2026 的样本里
 * 只有 21 / 22 两个取值，跟版本号对不上（版本 id 已经排到 60）。
 *
 * @param {Array<{id:number,name:string,ts:number}>} patchList 按 ts 升序
 * @param {number} seconds 开赛时间（秒）
 */
export function patchForTime(patchList, seconds) {
  if (!Array.isArray(patchList) || patchList.length === 0) return '';
  const t = Number(seconds);
  if (!t) return '';
  let lo = 0;
  let hi = patchList.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (patchList[mid].ts <= t) {
      hit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return hit >= 0 ? patchList[hit].name : '';
}

export function kdaOf(kills, deaths, assists) {  const k = Number(kills) || 0;
  const d = Number(deaths) || 0;
  const a = Number(assists) || 0;
  if (d === 0) return (k + a).toFixed(1);
  return ((k + a) / d).toFixed(1);
}

/** 秒 → 33:12 */
export function fmtDuration(sec) {
  const s = Number(sec) || 0;
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** 时间戳（秒）→ 刚刚 / 3 小时前 / 2 天前 / 2026-03-04 */
export function fmtAgo(seconds, now = Date.now()) {
  const ts = Number(seconds);
  if (!ts) return '—';
  const diff = Math.max(0, now - ts * 1000);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 在给定对局集合里算展示用的汇总 */
export function summarize(matches) {
  const total = matches.length;
  let wins = 0;
  let kills = 0;
  let deaths = 0;
  let assists = 0;
  let duration = 0;
  for (const m of matches) {
    if (m.isWin) wins++;
    kills += m.kills || 0;
    deaths += m.deaths || 0;
    assists += m.assists || 0;
    duration += m.duration || 0;
  }
  return {
    total,
    wins,
    losses: total - wins,
    winRate: total ? Math.round((wins / total) * 100) : 0,
    kda: total ? kdaOf(kills, deaths, assists) : '0.0',
    avgDuration: total ? Math.round(duration / total) : 0,
  };
}

/** 近 N 场的最高单项（对应截图里的「近20场最高」） */
export function bestOf(matches) {
  const pool = matches.slice(0, 20);
  let maxKills = 0;
  let maxAssists = 0;
  let maxKda = 0;
  for (const m of pool) {
    maxKills = Math.max(maxKills, m.kills || 0);
    maxAssists = Math.max(maxAssists, m.assists || 0);
    maxKda = Math.max(maxKda, Number(kdaOf(m.kills, m.deaths, m.assists)));
  }
  return { kills: maxKills, assists: maxAssists, kda: maxKda.toFixed(1) };
}
