// 群友多维筛选（小程序版）。
//
// ⚠ 口径必须与 `lib/member-filter.mjs` **完全一致**。那份是网页端和帮派邀请选择器
//   共用的唯一逻辑层；小程序不能直接 require 它（它是 .mjs + ESM，小程序没有构建步骤），
//   所以这里做了一次移植，而不是让服务端多一个筛选接口 —— 筛选用的是已经拉下来的
//   168 条数据，走网络反而更慢。
//
// ⚠ 改任何一条规则都要两边一起改。`scripts/check-miniprogram-members.cjs` 会拿同一批
//   真实数据把两边的筛选结果逐条比对（含空结果与排序），不一致就报错 —— 这是防止
//   移植漂移的兜底，别绕过它。
//
// 语义（与网页端一致，不要在这里发明例外）：
//   同组内是 OR（选了「优势路」「中单」，会打任一位置的都算命中）；
//   跨组是 AND；关键字按空格分词，每个词都要命中。

// 地区的展示/归组口径在 utils/regions.js（同样是从 lib/regions.js 抄的）
const { regionShort } = require('./regions');

const TIERS = [
  { key: 'immortal', label: '冠绝一世', min: 5420, max: null },
  { key: 'divine', label: '超凡入圣', min: 4620, max: 5420 },
  { key: 'ancient', label: '万古流芳', min: 3850, max: 4620 },
  { key: 'legend', label: '传奇', min: 3080, max: 3850 },
  { key: 'archon', label: '统帅', min: 2310, max: 3080 },
  { key: 'others', label: '中军以下', min: null, max: 2310 }
];

const SCORE_RANGES = [
  { value: 'all', label: '不限', min: null, max: null },
  { value: '6000+', label: '6000 分以上', min: 6000, max: null },
  { value: '5000-6000', label: '5000 - 6000', min: 5000, max: 6000 },
  { value: '4000-5000', label: '4000 - 5000', min: 4000, max: 5000 },
  { value: '3000-4000', label: '3000 - 4000', min: 3000, max: 4000 },
  { value: '2000-3000', label: '2000 - 3000', min: 2000, max: 3000 },
  { value: '0-2000', label: '2000 分以下', min: null, max: 2000 },
  { value: 'none', label: '未填写分数', min: null, max: null, none: true }
];

const SORTS = [
  { value: 'score', label: '按天梯分' },
  { value: 'champion', label: '按冠军数' },
  { value: 'name', label: '按昵称' }
];

function tierOf(score) {
  const n = Number(score);
  const s = Number.isFinite(n) ? n : 0;
  for (let i = 0; i < TIERS.length; i++) {
    const t = TIERS[i];
    if (t.min !== null && s < t.min) continue;
    if (t.max !== null && s >= t.max) continue;
    return { key: t.key, label: t.label };
  }
  return { key: 'others', label: '中军以下' };
}

function emptyFilters() {
  return {
    keyword: '',
    tier: 'all',
    score: 'all',
    position: [],
    region: '全部',
    hero: [],
    sort: 'score'
  };
}

// 地区按「市 · 区」归组 —— 由 utils/regions.js 提供，**不要**在这里再写一份简化版
// （曾经写成「取最后两段空格拼接」，结果网页筛深圳 10 人、小程序 0 人）

function buildHaystack(p) {
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
    ...(p.heroes || [])
  ];
  return parts
    .filter((x) => x !== null && x !== undefined && String(x).trim() !== '')
    .join(' ')
    .toLowerCase();
}

function buildCountFacet(players, picker) {
  const m = {};
  players.forEach((p) => {
    picker(p).forEach((v) => {
      const key = String(v === null || v === undefined ? '' : v).trim();
      if (!key) return;
      m[key] = (m[key] || 0) + 1;
    });
  });
  return Object.keys(m)
    .map((k) => ({ value: k, count: m[k] }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

function buildRegionHeroFacets(players) {
  return {
    region: buildCountFacet(players, (p) => [regionShort(p.region)]),
    hero: buildCountFacet(players, (p) => p.heroes || [])
  };
}

function hasScore(p) {
  const raw = p.score;
  return raw !== null && raw !== undefined && Number(raw) > 0;
}

function buildTierFacets(players) {
  return TIERS.map((t) => ({
    key: t.key,
    label: t.label,
    count: players.filter((p) => {
      const s = Number(p.score) || 0;
      if (t.min !== null && s < t.min) return false;
      if (t.max !== null && s >= t.max) return false;
      return true;
    }).length
  }));
}

function buildScoreFacets(players) {
  return SCORE_RANGES.map((r) => ({
    value: r.value,
    label: r.label,
    count: players.filter((p) => {
      const ok = hasScore(p);
      if (r.none) return !ok;
      if (!ok) return false;
      const v = Number(p.score);
      if (r.min !== null && v < r.min) return false;
      if (r.max !== null && v >= r.max) return false;
      return true;
    }).length
  }));
}

function buildSearchIndex(players) {
  // 小程序支持 Map，用对象也行；这里用普通对象，setData 时不会被当成复杂类型
  const m = {};
  players.forEach((p) => {
    m[String(p.id)] = buildHaystack(p);
  });
  return m;
}

function filterMembers(players, filters, searchIndex) {
  const f = Object.assign(emptyFilters(), filters || {});
  const tier = TIERS.filter((t) => t.key === f.tier)[0];
  const score = SCORE_RANGES.filter((r) => r.value === f.score)[0];
  const kws = String(f.keyword || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const idx = searchIndex || buildSearchIndex(players);

  const list = players.filter((p) => {
    if (kws.length > 0) {
      const hay = idx[String(p.id)] || '';
      for (let i = 0; i < kws.length; i++) {
        if (hay.indexOf(kws[i]) < 0) return false;
      }
    }
    if (tier) {
      const s = Number(p.score) || 0;
      if (tier.min !== null && s < tier.min) return false;
      if (tier.max !== null && s >= tier.max) return false;
    }
    if (score && score.value !== 'all') {
      const ok = hasScore(p);
      if (score.none) {
        if (ok) return false;
      } else {
        if (!ok) return false;
        const v = Number(p.score);
        if (score.min !== null && v < score.min) return false;
        if (score.max !== null && v >= score.max) return false;
      }
    }
    if (f.position.length > 0) {
      const mine = p.positions || [];
      if (!f.position.some((x) => mine.indexOf(x) >= 0)) return false;
    }
    if (f.region !== '全部' && regionShort(p.region) !== f.region) return false;
    if (f.hero.length > 0) {
      const mine = p.heroes || [];
      if (!f.hero.some((x) => mine.indexOf(x) >= 0)) return false;
    }
    return true;
  });

  if (f.sort === 'score') list.sort((a, b) => (b.score || 0) - (a.score || 0));
  else if (f.sort === 'champion') list.sort((a, b) => (b.championships || 0) - (a.championships || 0));
  else if (f.sort === 'name') list.sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
  return list;
}

function countActiveFilters(filters) {
  const f = Object.assign(emptyFilters(), filters || {});
  return (
    (String(f.keyword || '').trim() ? 1 : 0) +
    (f.tier !== 'all' ? 1 : 0) +
    (f.score !== 'all' ? 1 : 0) +
    (f.position.length > 0 ? 1 : 0) +
    (f.region !== '全部' ? 1 : 0) +
    (f.hero.length > 0 ? 1 : 0)
  );
}

module.exports = {
  TIERS,
  SCORE_RANGES,
  SORTS,
  tierOf,
  emptyFilters,
  regionShort,
  buildHaystack,
  buildSearchIndex,
  buildRegionHeroFacets,
  buildTierFacets,
  buildScoreFacets,
  filterMembers,
  countActiveFilters
};
