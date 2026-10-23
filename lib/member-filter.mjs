/**
 * 群友筛选的唯一逻辑层。
 *
 * 2026-10-23 从 `pages/members/index.js` 抽出，目的只有一个：帮派的「邀请成员」选择器
 * 要用同一套搜索与筛选。不抽的话只能复制一份，而复制出来的第二份迟早和第一份漂移
 * —— `/api/players` 当年就是这么变成两套实现、最后一处改了另一处没改。
 *
 * 这里只放纯函数（不碰 React、不碰 DOM），所以可以脱离页面单测。
 *
 * ⚠ 行为已经被 `.cache/members-before.json` 的 11 步基线锁住（171 位群友的真实数据）。
 * 改这里之后必须跑一遍 `.cache/baseline-members.cjs` 对比，每一步的卡片数必须完全一致。
 * 基线覆盖：搜索单词/多词/无结果、段位、天梯分、三种排序、重置。
 */

import { TIERS, tierOf } from './tier.mjs';
import { regionShort } from './regions.js';

/**
 * 天梯分区间。min/max 为 null 表示该侧不设限；none 表示「未填写分数」。
 * 顺序即下拉顺序，不要随便重排 —— 用户靠位置找区间。
 */
export const SCORE_RANGES = [
  { value: 'all', label: '不限', min: null, max: null },
  { value: '6000+', label: '6000 分以上', min: 6000, max: null },
  { value: '5000-6000', label: '5000 - 6000', min: 5000, max: 6000 },
  { value: '4000-5000', label: '4000 - 5000', min: 4000, max: 5000 },
  { value: '3000-4000', label: '3000 - 4000', min: 3000, max: 4000 },
  { value: '2000-3000', label: '2000 - 3000', min: 2000, max: 3000 },
  { value: '0-2000', label: '2000 分以下', min: null, max: 2000 },
  { value: 'none', label: '未填写分数', min: null, max: null, none: true },
];

/**
 * 空筛选。位置与英雄是多选，用数组；地区用字符串默认「全部」以对齐下拉的 value。
 * 每次重置都返回新对象（不要共用一个会被 mutate 的字面量）。
 */
export const EMPTY_MEMBER_FILTERS = {
  keyword: '',
  tier: 'all',
  score: 'all',
  // 位置与英雄支持多选：一个人会多个位置、多个绝活，
  // 单选时只能一个个看完，多选才能问「谁会打 1 或 5」。
  // 同组内是 OR —— 命中任意一个就算。
  position: [],
  region: '全部',
  hero: [],
  sort: 'score',
};

export const emptyMemberFilters = () => ({ ...EMPTY_MEMBER_FILTERS, position: [], hero: [] });

/**
 * 搜索哈栈：一个人可能有好几个 SteamID 和群昵称，全部都要能被搜到。
 * 只拼 p.game_id 会导致「合并进来的副号搜不到人」——玩家搜自己小号
 * 却查不出档案，看起来就像是合并把号弄丢了。
 */
export function buildHaystack(p) {
  const steamIds = (p.steamIds || [])
    .map((s) => (s && typeof s === 'object' ? s.accountId : s))
    .filter(Boolean);
  const groupNicknames = (p.groupNicknames || [])
    .map((n) => (n && typeof n === 'object' ? n.nickname : n))
    .filter(Boolean);
  const parts = [
    p.nickname,
    p.group_nickname,
    p.game_id,
    ...steamIds,
    ...groupNicknames,
    p.region,
    p.self_intro,
    tierOf(Number(p.score) || 0).label,
    ...(p.positions || []),
    ...(p.heroes || []),
  ];
  return parts
    .filter((x) => x !== null && x !== undefined && String(x).trim() !== '')
    .join(' ')
    .toLowerCase();
}

// 从真实数据生成「出现次数降序」的选项表。英雄池可达上百种，写死会漏。
const buildCountFacet = (players, picker) => {
  const m = new Map();
  players.forEach((p) => {
    picker(p).forEach((v) => {
      const key = String(v === null || v === undefined ? '' : v).trim();
      if (key) m.set(key, (m.get(key) || 0) + 1);
    });
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
};

/**
 * 地区与擅长英雄的可选项。
 * 地区按「市 · 区」归组：同城的归到一项，否则下拉里会出现一堆
 * 「中国 广东省 深圳市 南山区」「中国 广东省 深圳市 龙岗区」这样的长选项。
 */
export function buildRegionHeroFacets(players) {
  return {
    region: buildCountFacet(players, (p) => [regionShort(p.region)]),
    hero: buildCountFacet(players, (p) => p.heroes || []),
  };
}

/** 各段位命中数。 */
export function buildTierFacets(players) {
  return TIERS.map((t) => ({
    ...t,
    count: players.filter((p) => {
      const s = Number(p.score) || 0;
      if (t.min !== null && s < t.min) return false;
      if (t.max !== null && s >= t.max) return false;
      return true;
    }).length,
  }));
}

/** 各分数区间的命中数。未填分数单独一组。 */
export function buildScoreFacets(players) {
  return SCORE_RANGES.map((r) => ({
    ...r,
    count: players.filter((p) => {
      const raw = p.score;
      const has = raw !== null && raw !== undefined && Number(raw) > 0;
      if (r.none) return !has;
      if (!has) return false;
      const v = Number(raw);
      if (r.min !== null && v < r.min) return false;
      if (r.max !== null && v >= r.max) return false;
      return true;
    }).length,
  }));
}

/** 搜索索引：id -> 全字段小写文本，避免每次筛选重复拼接。 */
export function buildSearchIndex(players) {
  const m = new Map();
  players.forEach((p) => m.set(p.id, buildHaystack(p)));
  return m;
}

/**
 * 筛选 + 排序。同组内 OR、跨组 AND —— 这是全站统一的筛选语义，不要在这里发明例外。
 *
 * searchIndex 可由调用方缓存（列表页用 useMemo 建一次），不传就现场建（少量数据时无所谓）。
 */
export function filterMembers(players, filters, searchIndex) {
  const f = { ...emptyMemberFilters(), ...(filters || {}) };
  const tier = TIERS.find((t) => t.key === f.tier);
  const score = SCORE_RANGES.find((r) => r.value === f.score);
  // 空格分词，每个词都要命中（如「南山 中单」）
  const kws = String(f.keyword || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const idx = searchIndex || buildSearchIndex(players);

  const list = players.filter((p) => {
    if (kws.length > 0) {
      const hay = idx.get(p.id) || '';
      if (!kws.every((k) => hay.includes(k))) return false;
    }
    // 段位
    if (tier) {
      const s = Number(p.score) || 0;
      if (tier.min !== null && s < tier.min) return false;
      if (tier.max !== null && s >= tier.max) return false;
    }
    // 分数区间
    if (score && score.value !== 'all') {
      const raw = p.score;
      const has = raw !== null && raw !== undefined && Number(raw) > 0;
      if (score.none) {
        if (has) return false;
      } else {
        if (!has) return false;
        const v = Number(raw);
        if (score.min !== null && v < score.min) return false;
        if (score.max !== null && v >= score.max) return false;
      }
    }
    // 擅长位置（多选，OR）
    if (f.position.length > 0) {
      const mine = p.positions || [];
      if (!f.position.some((x) => mine.includes(x))) return false;
    }
    // 地区（按「市 · 区」归组，与 facets 口径一致）
    if (f.region !== '全部' && regionShort(p.region) !== f.region) return false;
    // 擅长英雄（多选，OR）
    if (f.hero.length > 0) {
      const mine = p.heroes || [];
      if (!f.hero.some((x) => mine.includes(x))) return false;
    }
    return true;
  });

  if (f.sort === 'score') list.sort((a, b) => (b.score || 0) - (a.score || 0));
  else if (f.sort === 'champion') list.sort((a, b) => (b.championships || 0) - (a.championships || 0));
  else if (f.sort === 'name') list.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
  return list;
}

/** 生效的筛选条件数量（用于显示「重置」按钮与空结果的文案分支）。搜索算 1 项。 */
export function countActiveFilters(filters) {
  const f = { ...emptyMemberFilters(), ...(filters || {}) };
  return (
    (String(f.keyword || '').trim() ? 1 : 0) +
    (f.tier !== 'all' ? 1 : 0) +
    (f.score !== 'all' ? 1 : 0) +
    (f.position.length > 0 ? 1 : 0) +
    (f.region !== '全部' ? 1 : 0) +
    (f.hero.length > 0 ? 1 : 0)
  );
}
