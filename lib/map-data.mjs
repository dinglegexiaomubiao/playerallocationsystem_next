/**
 * 「群友分布图」的服务端数据装配层（唯一实现）。
 *
 * `pages/map/index.js` 的 getServerSideProps 与 `pages/api/map.js` 共用这里的
 * `loadMapData()`，避免像当年 `/api/players` 那样出现两份装配逻辑各自漂移。
 *
 * 三个刻意的取舍：
 *
 * 1. **群友只到「区」，不存也不展示任何个人精确坐标**。`players.region` 本来就只有
 *    国/省/市/区四级，地图上把同一区的人聚在区质心周围散开 —— 既能看到分布，又不构成
 *    对他人位置的采集与公开（合规硬要求）。商家地址是公开信息，可以精确到点，但当前
 *    也没有坐标，先同样按区散开，后续接地理编码即可。
 *
 * 2. **地图几何不在运行时算**。`public/data/shenzhen.geo.json` 里已经是投影好的
 *    SVG path 字符串（见 scripts/build-shenzhen-map.cjs），这里只读一次并缓存。
 *
 * 3. **`foods` 用 `SELECT *` 而不是写死列名**。`foods.region` 这一列是按需 ALTER 加上
 *    去的，线上可能还没执行过迁移；写死列名会在迁移前直接 500。和 `players` 的列漂移
 *    是同一个教训：按行里真实存在的键取值。
 */
import fs from 'fs';
import path from 'path';
import { pool } from './db';
import { loadPlayerList } from './player-list';
import { isShenzhen, parseRegion } from './regions';

/** 深圳 9 个行政区，与 public/data/china-division.json 里深圳市的下级完全一致 */
export const SZ_DISTRICTS = [
  '罗湖区',
  '福田区',
  '南山区',
  '宝安区',
  '龙岗区',
  '盐田区',
  '龙华区',
  '坪山区',
  '光明区',
];

const DISTRICT_SET = new Set(SZ_DISTRICTS);
/** 区名 → 去掉「区」的简称，用于匹配老自由文本（`南山` / `龙华，深圳`） */
const DISTRICT_SHORT = new Map(SZ_DISTRICTS.map((d) => [d.replace(/区$/u, ''), d]));

/**
 * 把一个地区字符串解析成地图需要的三档信息。
 * @returns {{empty:boolean, inShenzhen:boolean, district:string|null, label:string}}
 *   empty     —— 压根没填
 *   inShenzhen—— 在深圳（可能没选到区，district 为 null）
 *   label     —— 市外/海外时用来分组显示的文本
 */
export function districtOfRegion(text) {
  const raw = String(text || '').trim();
  if (!raw) return { empty: true, inShenzhen: false, district: null, label: '' };

  const p = parseRegion(raw);

  // 老的自由文本（`南山`、`龙华，深圳，china`）
  if (!p.structured) {
    if (!isShenzhen(raw)) {
      // 认不出是深圳的，原样归到「深圳以外」，不要瞎猜
      return { empty: false, inShenzhen: false, district: null, label: raw.slice(0, 20) };
    }
    const hit = SZ_DISTRICTS.find((d) => raw.includes(d)) ||
      [...DISTRICT_SHORT.entries()].find(([short]) => raw.includes(short));
    const district = hit ? (typeof hit === 'string' ? hit : hit[1]) : null;
    return { empty: false, inShenzhen: true, district, label: district || '深圳市' };
  }

  if (p.foreign) {
    return {
      empty: false,
      inShenzhen: false,
      district: null,
      label: [p.country, p.city].filter(Boolean).join(' ') || p.country,
    };
  }

  const district = DISTRICT_SET.has(p.district) ? p.district : null;
  const inShenzhen = p.city === '深圳市' || p.city === '深圳' || isShenzhen(raw);

  if (!inShenzhen) {
    return {
      empty: false,
      inShenzhen: false,
      district: null,
      label: [p.province, p.city].filter(Boolean).join(' ') || p.country,
    };
  }
  return { empty: false, inShenzhen: true, district, label: district || '深圳市（未到区）' };
}

/** 美食的区位：优先新列 region，退回老的 area 文本（`南山区` / `南山 西丽`） */
export function districtOfFood(row) {
  const region = row && row.region ? String(row.region).trim() : '';
  if (region) {
    const r = districtOfRegion(region);
    if (r.inShenzhen && r.district) return r.district;
    if (r.inShenzhen) return null;
  }
  const area = row && row.area ? String(row.area).trim() : '';
  if (!area) return null;
  const exact = SZ_DISTRICTS.find((d) => area === d || area.includes(d));
  if (exact) return exact;
  const short = [...DISTRICT_SHORT.entries()].find(([s]) => area.includes(s));
  return short ? short[1] : null;
}

/** 读地图几何（进程内只读一次） */
let geoCache = null;
export function loadGeo() {
  if (!geoCache) {
    const file = path.join(process.cwd(), 'public', 'data', 'shenzhen.geo.json');
    geoCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return geoCache;
}

const lite = (p) => ({ id: String(p.id), nickname: p.nickname || '（无名）', avatar: p.avatar || null });

/**
 * 装配整页数据。
 * @param {{cache?: boolean}} opts cache=false 时绕过玩家列表缓存（后台需要最新）
 */
export async function loadMapData({ cache = true } = {}) {
  const geo = loadGeo();
  // ⚠ loadPlayerList 返回的是 { players, ... }，不是裸数组
  const { players = [] } = await loadPlayerList({ cache });

  // ⚠ 用 SELECT *：foods.region 是按需 ALTER 加的，迁移前列可能不存在
  let foodRows = [];
  try {
    const r = await pool.query('SELECT * FROM foods ORDER BY id DESC');
    foodRows = r.rows;
  } catch (e) {
    // 表还没建（全新库）——地图照常渲染，只是没有美食图层
    foodRows = [];
  }

  const byDistrict = new Map(SZ_DISTRICTS.map((d) => [d, { name: d, players: [], foods: [] }]));
  const outside = new Map();
  const unplaced = []; // 在深圳但没选到区
  const missing = []; // 没填地区

  for (const p of players) {
    const info = districtOfRegion(p.region);
    if (info.empty) {
      missing.push(lite(p));
      continue;
    }
    if (!info.inShenzhen) {
      const key = info.label || '其他';
      if (!outside.has(key)) outside.set(key, { label: key, players: [] });
      outside.get(key).players.push(lite(p));
      continue;
    }
    if (!info.district) {
      unplaced.push(lite(p));
      continue;
    }
    byDistrict.get(info.district).players.push(lite(p));
  }

  let foodsUnplaced = 0;
  for (const f of foodRows) {
    const d = districtOfFood(f);
    const item = {
      id: String(f.id),
      name: f.name || '（未命名）',
      cuisine: f.cuisine || '',
      address: f.address || '',
      rating: Number(f.rating) || 0,
      district: d,
    };
    if (d && byDistrict.has(d)) byDistrict.get(d).foods.push(item);
    else foodsUnplaced++;
  }

  const districts = [...byDistrict.values()].map((d) => ({
    name: d.name,
    playerCount: d.players.length,
    foodCount: d.foods.length,
    players: d.players,
    foods: d.foods,
  }));

  const outsideList = [...outside.values()].sort((a, b) => b.players.length - a.players.length);

  const filled = players.length - missing.length;
  return {
    geo: { viewBox: geo.viewBox, width: geo.width, height: geo.height, districts: geo.districts, source: geo.source },
    districts,
    outside: outsideList,
    unplaced,
    missing,
    foodsUnplaced,
    stats: {
      players: players.length,
      filled,
      missing: missing.length,
      inShenzhen: districts.reduce((s, d) => s + d.playerCount, 0) + unplaced.length,
      outside: outsideList.reduce((s, d) => s + d.players.length, 0),
      foods: foodRows.length,
      foodsMapped: foodRows.length - foodsUnplaced,
    },
  };
}
