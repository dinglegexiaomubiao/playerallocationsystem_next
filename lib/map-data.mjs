/**
 * 「群友分布图」的服务端数据装配层（唯一实现）。
 *
 * 从 2026-10-22 起地图不再是「深圳 9 个区」，而是**任意一级行政区**：
 * 全国（省）→ 省（市）→ 市（区县）。`pages/map/index.js` 的 getServerSideProps 与
 * `pages/api/map/geo.js` 共用这里的 `loadMapData()`，避免两份装配逻辑各自漂移
 * （`/api/players` 当年就是这个坑）。
 *
 * 四个刻意的取舍：
 *
 * 1. **群友只到「区县」，不存也不展示任何个人精确坐标**。`players.region` 本来就只有
 *    国/省/市/区四级，地图上把同一区的人聚在区质心周围散开 —— 既能看到分布，又不构成
 *    对他人位置的采集与公开（合规硬要求）。商家地址是公开信息，可以精确到点，但当前
 *    也没有坐标，先同样按区散开，后续接地理编码即可。
 *
 * 2. **地区路径统一规范化（normalizeRegion）**：老的自由文本（`南山`、`龙华，深圳`）
 *    走 `guessRegionFromLegacy` 猜成 `中国 广东省 深圳市 南山区`，再**折叠连续重复段**
 *    （`中国 北京市 北京市 朝阳区` → `北京市 朝阳区`）。折叠是让「直辖市的区」
 *    和「省的市」共用同一套前缀匹配的关键，否则地图上北京永远是 0 人。
 *
 * 3. **计数用前缀树，不按名字直接查**。全国有多个同名区（朝阳市/朝阳区），
 *    按名字匹配会串台；前缀树按 `父路径 + 本级名` 定位，天然不串。
 *
 * 4. **`foods` 用 `SELECT *` 而不是写死列名**。`foods.region` 是按需 ALTER 加上去的，
 *    线上可能还没执行过迁移；写死列名会在迁移前直接 500。
 */
import fs from 'fs';
import path from 'path';
import { pool } from './db';
import { loadPlayerList } from './player-list';
import { parseRegion, guessRegionFromLegacy, DEFAULT_COUNTRY } from './regions';
import {
  ROOT_ADCODE,
  adcodeLevel,
  canDrill as cnCanDrill,
  getLevel,
  loadIndex,
  markNoChildren,
  resolveAdcode,
} from './cn-geo.mjs';

/** 没填地区时默认看这里（社区在深圳，绝大多数群友也在深圳） */
export const DEFAULT_ADCODE = '440300';

let divisionCache = null;
function loadDivision() {
  if (!divisionCache) {
    const file = path.join(process.cwd(), 'public', 'data', 'china-division.json');
    divisionCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return divisionCache;
}

/**
 * 把地区文本规范化成「从省开始」的路径数组。
 *
 * @returns {{empty:boolean, foreign:boolean, unknown:boolean, path:string[],
 *            country:string, label:string}}
 *   empty   —— 压根没填
 *   foreign —— 境外（`日本 东京都`），不进地图，单独列
 *   unknown —— 认不出是什么地方（`家里`、`深圳旁边`），也不要瞎猜
 *   path    —— `['广东省','深圳市','南山区']`，直辖市的重复段已折叠
 */
export function normalizeRegion(text) {
  const raw = String(text || '').trim();
  const base = { empty: false, foreign: false, unknown: false, path: [], country: '', label: '' };
  if (!raw) return { ...base, empty: true };

  let p = parseRegion(raw);
  if (!p.structured) {
    const guess = guessRegionFromLegacy(raw, loadDivision());
    if (!guess) return { ...base, unknown: true, label: raw.slice(0, 24) };
    p = parseRegion(guess);
    if (!p.structured) return { ...base, unknown: true, label: raw.slice(0, 24) };
  }

  if (p.country && p.country !== DEFAULT_COUNTRY) {
    return {
      ...base,
      foreign: true,
      country: p.country,
      path: [p.city || p.province].filter(Boolean),
      label: [p.country, p.city].filter(Boolean).join(' '),
    };
  }

  const parts = [p.province, p.city, p.district]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    // 折叠连续重复（`北京市 北京市 朝阳区` → `北京市 朝阳区`）
    .filter((v, i, arr) => v !== arr[i - 1]);

  if (!parts.length) return { ...base, unknown: true, label: raw.slice(0, 24) };
  return { ...base, path: parts, country: DEFAULT_COUNTRY, label: parts.join(' ') };
}

/**
 * 前缀树：key = 路径前 N 段用 `|` 连接。
 * 例：`广东省` / `广东省|深圳市` / `广东省|深圳市|南山区`
 *
 * 每个节点同时记两份：
 *  - `players/foods`：**落在该节点或更深**的全部条目（用于区块热力计数）
 *  - `exact`：路径**正好停在这一级**的条目（用于「只填到市、没选到区」名单）
 * 两者不能混用，否则「深圳市 3 人」会把下面各区的人也算进去。
 */
function makeNode() {
  return { players: [], foods: [], exactP: [], exactF: [] };
}

function addToTree(tree, pathParts, item, kind) {
  for (let i = 1; i <= pathParts.length; i++) {
    const key = pathParts.slice(0, i).join('|');
    let node = tree.get(key);
    if (!node) {
      node = makeNode();
      tree.set(key, node);
    }
    node[kind].push(item);
    if (i === pathParts.length) (kind === 'players' ? node.exactP : node.exactF).push(item);
  }
}

const lite = (p) => ({ id: String(p.id), nickname: p.nickname || '（无名）', avatar: p.avatar || null });

/** 美食的区位：优先新列 region，退回老的 area 文本（`南山区` / `南山 西丽`） */
function foodPath(row) {
  const region = row && row.region ? String(row.region).trim() : '';
  if (region) {
    const n = normalizeRegion(region);
    if (!n.foreign && !n.unknown && n.path.length) return n.path;
  }
  const area = row && row.area ? String(row.area).trim() : '';
  if (!area) return [];
  const n = normalizeRegion(area);
  return n.foreign || n.unknown ? [] : n.path;
}

/** 把一份 players + foods 摊成前缀树，并分出「境外 / 认不出 / 没填」 */
async function collect() {
  const { players = [] } = await loadPlayerList({ cache: true });

  let foodRows = [];
  try {
    // ⚠ SELECT *：foods.region 是按需 ALTER 加的，迁移前列可能不存在
    const r = await pool.query('SELECT * FROM foods ORDER BY id DESC');
    foodRows = r.rows;
  } catch {
    foodRows = []; // 表还没建（全新库）——地图照常渲染，只是没有美食图层
  }

  // 群友评价：右栏要显示「几星 / 几条评价 / 最新一条说了什么」。
  // 一次全捞（总量几百条），不要在每个区里再查一遍。
  let reviewRows = [];
  try {
    const r = await pool.query(
      'SELECT food_id, reviewer, content, rating, created_at FROM public.food_reviews ORDER BY created_at DESC'
    );
    reviewRows = r.rows;
  } catch (e) {
    reviewRows = [];
  }
  const reviewsByFood = new Map();
  for (const r of reviewRows) {
    const key = String(r.food_id);
    if (!reviewsByFood.has(key)) reviewsByFood.set(key, []);
    reviewsByFood.get(key).push({
      reviewer: r.reviewer || '',
      content: String(r.content || '').slice(0, 120),
      rating: Number(r.rating) || 0,
    });
  }

  const tree = new Map();
  const missing = [];
  const foreign = new Map();
  const unknown = [];
  let foodsUnplaced = 0;
  let foodsMapped = 0;

  for (const p of players) {
    const n = normalizeRegion(p.region);
    if (n.empty) {
      missing.push(lite(p));
      continue;
    }
    if (n.foreign) {
      const key = n.label || n.country || '境外';
      if (!foreign.has(key)) foreign.set(key, { label: key, players: [] });
      foreign.get(key).players.push(lite(p));
      continue;
    }
    if (n.unknown || !n.path.length) {
      unknown.push({ ...lite(p), region: String(p.region || '') });
      continue;
    }
    addToTree(tree, n.path, lite(p), 'players');
  }

  for (const f of foodRows) {
    const reviews = reviewsByFood.get(String(f.id)) || [];
    const item = {
      id: String(f.id),
      name: f.name || '（未命名）',
      cuisine: f.cuisine || '',
      address: f.address || '',
      rating: Number(f.rating) || 0,
      // 右栏用：评价条数 + 最新两条（再多也塞不下）
      reviewCount: reviews.length,
      reviews: reviews.slice(0, 2),
    };
    const p = foodPath(f);
    if (!p.length) {
      foodsUnplaced++;
      continue;
    }
    foodsMapped++;
    addToTree(tree, p, item, 'foods');
  }

  return {
    tree,
    players,
    missing,
    foreign: [...foreign.values()].sort((a, b) => b.players.length - a.players.length),
    unknown,
    stats: {
      players: players.length,
      filled: players.length - missing.length,
      missing: missing.length,
      placeable: players.length - missing.length - unknown.length - [...foreign.values()].reduce((s, g) => s + g.players.length, 0),
      foods: foodRows.length,
      foodsMapped,
      foodsUnplaced,
    },
  };
}

/**
 * 本级的路径前缀 = 上级链（去掉「全国」它不是路径的一段）+ 本级自己。
 * 例：scope=深圳市 且 ancestors=[全国,广东省] → ['广东省','深圳市']，
 *     于是「南山区」的 key 是 `广东省|深圳市|南山区`，和 normalizeRegion 出来的路径对得上。
 *      漏掉本级会算成 `广东省|南山区`，全图 0 人（这个坑踩过一次）。
 */
function scopePath(scope) {
  const anc = (scope.ancestors || [])
    .filter((a) => String(a.adcode) !== ROOT_ADCODE && a.name && a.name !== '全国')
    .map((a) => a.name);
  const self = String(scope.adcode) === ROOT_ADCODE ? [] : [scope.name];
  return [...anc, ...self];
}

/**
 * 装配某一级地图。
 *
 * @param {{adcode?:string, sessionName?:string, cache?:boolean}} opts
 * @returns 页面与 API 共用的完整数据
 */
export async function loadMapData({ adcode, sessionName, cache = true } = {}) {
  const data = await collect(cache);
  const { tree, stats } = data;

  const idx = loadIndex();
  const wanted = adcode && /^\d{6}$/.test(String(adcode)) ? String(adcode) : null;

  // 1) 先定位本级：URL 给的 adcode 优先，其次「我所在的市」，最后默认深圳
  //
  // ⚠ 「我是谁」不能按 players.account_name 找 —— players 表根本没有这一列。
  //   登录账号在 play_score（name 是登录名），靠 play_score.player_id 挂到 players.id。
  let me = null;
  if (sessionName) {
    let myId = null;
    try {
      const r = await pool.query('SELECT player_id FROM public.play_score WHERE name = $1', [
        String(sessionName),
      ]);
      myId = r.rows[0] ? r.rows[0].player_id : null;
    } catch {
      myId = null; // play_score 异常不能拖垮整页地图
    }
    const mine = myId ? data.players.find((p) => String(p.id) === String(myId)) : null;
    if (mine) {
      const n = normalizeRegion(mine.region);
      if (!n.empty && !n.foreign && !n.unknown && n.path.length) {
        // 用规范化后的路径展示：`中国 广东省 广州市 白云区` → `广东省 广州市 白云区`
        me = { path: n.path, label: n.path.join(' ') };
      }
    }
  }

  const myAdcodeRaw = me ? adcodeOfPath(me.path) : null;
  // 「我所在的市」如果本身没有下级（东莞/中山），就停到它所属的省：
  // 默认落点不该每次进来都弹一句「这里不设下级」的提示，那是点错时才该说的话
  const myAdcode =
    myAdcodeRaw && cnCanDrill(myAdcodeRaw)
      ? myAdcodeRaw
      : me && me.path[0]
        ? adcodeOfPath([me.path[0]])
        : myAdcodeRaw;
  const target = wanted || myAdcode || DEFAULT_ADCODE;

  let scope = resolveAdcode(target);
  if (!scope && myAdcode && target === myAdcode) {
    // 索引里没有（极少见），退到默认
    scope = resolveAdcode(DEFAULT_ADCODE);
  }
  if (!scope) scope = resolveAdcode(DEFAULT_ADCODE);
  if (!scope) throw new Error('地图索引缺失，请先运行 node scripts/build-china-map.cjs');

  // 2) 取几何（未预生成的层级会现场构建并落 .cache/cn-geo）
  //
  // 东莞 / 中山 这类不设区县的城市，它的 adcode 是「没有下级」的：直接访问
  // /map?adcode=441900 不该报错，应该退回上一级并说明原因（否则用户看到一片空白，
  // 以为站坏了）。台湾省同理 —— DataV 不提供它的下级区划。
  let geo = null;
  let builtAtRequest = false;
  let notice = null;
  try {
    const r = await getLevel(scope.adcode);
    geo = r.geo;
    builtAtRequest = r.builtAtRequest;
  } catch (e) {
    if (!e || e.status !== 404) throw e;
    markNoChildren(scope.adcode);
    const parent = (scope.ancestors || [])[(scope.ancestors || []).length - 1];
    const up = parent ? resolveAdcode(parent.adcode) : null;
    if (!up) throw new Error(`「${scope.name}」没有下级行政区数据`);
    notice = `「${scope.name}」不设下级行政区，已显示它所属的「${up.name}」。`;
    scope = up;
    const r2 = await getLevel(scope.adcode);
    geo = r2.geo;
    builtAtRequest = r2.builtAtRequest;
  }

  // 3) 几何 + 计数合并成一份 areas（组件只认 areas，不再分两层找数据）
  const names = scopePath(scope);
  const areas = geo.features.map((f) => {
    const key = [...names, f.name].join('|');
    const node = tree.get(key) || { players: [], foods: [] };
    return {
      name: f.name,
      adcode: f.adcode,
      path: f.path,
      center: f.center,
      playerCount: node.players.length,
      foodCount: node.foods.length,
      canDrill: cnCanDrill(f.adcode),
      players: node.players,
      foods: node.foods,
      // 该区块是否就是「我」所在的那个
      isMine: !!(me && prefixMatch(me.path, names) && me.path[names.length] === f.name),
    };
  });

  // 4) 落在本级但没填到更细一级的人（「只填到市、没选到区」）
  const ownKey = names.join('|');
  const ownNode = ownKey ? tree.get(ownKey) : null;
  const here = ownNode
    ? { players: ownNode.exactP, foods: ownNode.exactF }
    : { players: [], foods: [] };

  // 5) 不在本级范围内的人有多少 —— 让人知道这张图不是全世界
  const inScope = areas.reduce((s, a) => s + a.playerCount, 0);
  const elsewhere = Math.max(0, stats.placeable - inScope - here.players.length);

  return {
    scope: {
      adcode: scope.adcode,
      name: scope.name,
      ancestors: scope.ancestors || [],
      depth: names.length,
      isRoot: String(scope.adcode) === ROOT_ADCODE,
      builtAtRequest,
    },
    notice,
    geo: {
      viewBox: geo.viewBox,
      width: geo.width,
      height: geo.height,
      nanhai: geo.nanhai || null,
      source: geo.source,
    },
    areas,
    here,
    me,
    elsewhere,
    outside: data.foreign,
    unknown: data.unknown,
    missing: data.missing,
    stats,
    generatedAt: geo.generatedAt,
  };
}

function prefixMatch(pathParts, prefix) {
  if (prefix.length > pathParts.length) return false;
  return prefix.every((v, i) => pathParts[i] === v);
}

/**
 * 地区路径 → 该去哪个 adcode 看。
 * `['广东省','广州市','白云区']` → 440100（看广州的区）
 * `['北京市','朝阳区']`         → 110000（北京的下级就是区）
 * `['广东省']`                  → 440000
 * 直辖市 / 港澳的第二段就是区（adcode 是区县级），这时候看的是**省本身**。
 * 找不到就返回 null。
 */
export function adcodeOfPath(pathParts) {
  const idx = loadIndex();
  if (!idx || !pathParts || !pathParts.length) return null;
  const province = (idx.provinces || []).find((p) => p.name === pathParts[0]);
  if (!province) return null;
  const cityName = pathParts[1];
  if (!cityName) return province.adcode;
  const city = (province.cities || []).find((c) => c.name === cityName);
  // 重庆的「江北区」、香港的「东区」也在 cities 列表里，但它们是区县级：
  // 拿它们当 scope 会立刻 404，正确目标是它们所属的省级区
  if (city && adcodeLevel(city.adcode) < 3) return city.adcode;
  return province.adcode;
}
