/**
 * 中国行政区划地图的几何层 —— 构建脚本与运行时共用。
 *
 * 数据源只有一个：阿里云 DataV.GeoAtlas `areas_v3/bound/{adcode}_full.json`
 * （高德系行政区划）。合规上只作**行政区划示意**，不接任何境外地图服务。
 *
 * 三个必须知道的事实：
 *
 * 1. **每次只出一级**。`{adcode}_full.json` 里装的是 adcode 的**下级**：
 *    `100000` → 34 个省级区 + 一句 `100000_JD`（南海诸岛/断续线），
 *    `440000` → 广东 21 个市，`440300` → 深圳 10 个区。所以「全国 / 省 / 市」
 *    不是三份固定数据，而是同一条链上按 adcode 取的三次结果。
 *
 * 2. **全国图必须配南海诸岛插图**。DataV 的海南省多边形一直延伸到北纬 3.8°（三沙），
 *    如果直接按全部顶点算包围盒，全国图会被拉成 1000×920 的瘦长条，各省糊成一团。
 *    标准做法是主图只画到海南岛（`MAIN_MIN_LAT` 以上），南海诸岛与断续线放右下角
 *    独立小图（`nanhai`）。**插图不是装饰，是领土表达的一部分，不能省。**
 *
 * 3. **投影与抽稀是构建期的事**。原始全国文件 582KB / 约 25000 个顶点，抽稀后
 *    path 约 99KB；前端拿到就是一堆 `<path d="...">`，零依赖、零计算。
 *
 * 抽稀用 Douglas-Peucker，容差按 1000px 画布定；投影用等距圆柱 + 纬度余弦校正，
 * 中国范围（南北 50°）误差可忽略，且各级视图各自算自己的包围盒，所以省/市图
 * 不会出现「全国图里的广东」那种被压扁的形状。
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
/** 构建产物：随仓库一起发布，浏览器从这里读不到（走 API/SSR），但运维可离线复现 */
export const DATA_DIR = path.join(ROOT, 'public', 'data', 'cn');
/** 运行时兜底：DataV 原始响应缓存（永不发布） */
export const RAW_DIR = path.join(ROOT, '.cache', 'datav');
/** 运行时临时构建的层级（未预生成的省/市）落在磁盘，避免每次点都重算 */
export const RUNTIME_DIR = path.join(ROOT, '.cache', 'cn-geo');

export const ROOT_ADCODE = '100000';
export const CANVAS_W = 1000;
export const EPSILON = 0.5;
/** 全国主图的下边界：海南岛最南端约 18.15°N，再往南是南海诸岛，交给插图 */
export const MAIN_MIN_LAT = 17.2;

/**
 * 没有下级区县的地级市 —— DataV 对这些 adcode 直接 404（已实测）。
 * 点进去没东西比点不动更糟，所以这些在 UI 上不显示为可下钻。
 */
export const LEAF_ADCODES = new Set([
  '441900', // 东莞市（不设区县）
  '442000', // 中山市（不设区县）
  '620200', // 嘉峪关市
  '460300', // 三沙市
  '460400', // 儋州市
]);

export const SOURCE_LABEL = '阿里云 DataV.GeoAtlas（高德系行政区划，仅作示意）';

/** Douglas-Peucker 抽稀 */
export function simplify(points, eps) {
  if (points.length <= 2) return points;
  const sqDistToSeg = (p, a, b) => {
    let x = a[0];
    let y = a[1];
    let dx = b[0] - x;
    let dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = b[0];
        y = b[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    dx = p[0] - x;
    dy = p[1] - y;
    return dx * dx + dy * dy;
  };

  const sqEps = eps * eps;
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqDistToSeg(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > sqEps && idx > 0) {
      keep[idx] = true;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** 取所有环（Polygon / MultiPolygon），忽略自相交之外的复杂度 */
export function ringsOf(geometry) {
  if (!geometry || !geometry.coordinates) return [];
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  const rings = [];
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring && ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}

function ringBBox(ring) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < x0) x0 = lng;
    if (lng > x1) x1 = lng;
    if (lat < y0) y0 = lat;
    if (lat > y1) y1 = lat;
  }
  return { x0, y0, x1, y1 };
}

/**
 * 把一份 `{adcode}_full.json` 编译成可直接渲染的 SVG 数据。
 *
 * @param {object} raw FeatureCollection
 * @param {{width?:number, minLat?:number, dropBelowLat?:boolean}} opts
 *   minLat / dropBelowLat 只给全国图用：把南海诸岛那些环从主图剔掉（它们进插图）
 * @returns {{viewBox:string, width:number, height:number,
 *            features:Array<{name:string,adcode:string,path:string,center:number[]|null}>,
 *            nanhai:{viewBox:string,width:number,height:number,path:string}|null}}
 */
export function buildLevel(raw, opts = {}) {
  const width = opts.width || CANVAS_W;
  const minLat = typeof opts.minLat === 'number' ? opts.minLat : null;
  const dropBelow = !!opts.dropBelowLat;

  if (!raw || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
    throw new Error('数据格式不对：不是 FeatureCollection');
  }

  const isSea = (f) => {
    const p = f.properties || {};
    return !p.name || String(p.adcode) === '100000_JD';
  };

  const land = raw.features.filter((f) => f.geometry && !isSea(f));
  const sea = raw.features.find((f) => f.geometry && isSea(f)) || null;

  // ---- 1. 主图包围盒（只统计主图会画的顶点）----
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLatV = Infinity;
  let maxLatV = -Infinity;
  for (const f of land) {
    for (const ring of ringsOf(f.geometry)) {
      const b = ringBBox(ring);
      if (dropBelow && minLat !== null && b.y1 < minLat) continue; // 整环都在南海
      for (const [lng, lat] of ring) {
        if (dropBelow && minLat !== null && lat < minLat) continue;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLatV) minLatV = lat;
        if (lat > maxLatV) maxLatV = lat;
      }
    }
  }
  if (!Number.isFinite(minLng)) throw new Error('没有可用顶点');

  const midLat = (minLatV + maxLatV) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const scale = width / ((maxLng - minLng) * cosLat);

  const project = ([lng, lat]) => [
    Math.round((lng - minLng) * cosLat * scale * 10) / 10,
    Math.round((maxLatV - lat) * scale * 10) / 10,
  ];

  // ---- 2. 逐要素抽稀 + 拼 path ----
  const features = [];
  for (const f of land) {
    const name = f.properties.name;
    const parts = [];
    for (const ring of ringsOf(f.geometry)) {
      const b = ringBBox(ring);
      // 全国图：整个环都在南海诸岛纬度带的（三沙的礁盘）不进主图
      if (dropBelow && minLat !== null && b.y1 < minLat) continue;
      let body = ring;
      if (dropBelow && minLat !== null && b.y0 < minLat) {
        // 环跨了边界（海南省本身），只保留边界以上的顶点
        body = ring.filter(([, lat]) => lat >= minLat);
        if (body.length < 4) continue;
      }
      const projected = body.map(project);
      const closed =
        projected.length > 1 &&
        projected[0][0] === projected[projected.length - 1][0] &&
        projected[0][1] === projected[projected.length - 1][1];
      const slim = simplify(closed ? projected.slice(0, -1) : projected, EPSILON);
      if (slim.length >= 3) parts.push(slim);
    }
    if (!parts.length) continue;

    const c = f.properties.centroid || f.properties.center;
    features.push({
      name,
      adcode: String(f.properties.adcode || ''),
      parts,
      center: c && Array.isArray(c) ? project(c) : null,
    });
  }

  // ---- 3. 按实际占用裁画布（经纬度包围盒会留白）----
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const d of features) {
    for (const part of d.parts) {
      for (const [x, y] of part) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const PAD = 8;
  const dx = PAD - x0;
  const dy = PAD - y0;
  const finalW = Math.round(x1 - x0 + PAD * 2);
  const finalH = Math.round(y1 - y0 + PAD * 2);
  const round = (n) => Math.round(n * 10) / 10;

  const out = features.map((d) => ({
    name: d.name,
    adcode: d.adcode,
    path: d.parts
      .map((part) => 'M' + part.map(([x, y]) => `${round(x + dx)} ${round(y + dy)}`).join('L') + 'Z')
      .join(''),
    center: d.center ? [round(d.center[0] + dx), round(d.center[1] + dy)] : null,
  }));

  // 面积大的先画，避免小块被压在下面
  out.sort((a, b) => b.path.length - a.path.length);

  // ---- 4. 南海诸岛插图（自己的投影，独立的 viewBox）----
  let nanhai = null;
  if (sea) {
    const rings = ringsOf(sea.geometry);
    if (rings.length) {
      let sx0 = Infinity;
      let sy0 = Infinity;
      let sx1 = -Infinity;
      let sy1 = -Infinity;
      for (const r of rings) {
        for (const [lng, lat] of r) {
          if (lng < sx0) sx0 = lng;
          if (lng > sx1) sx1 = lng;
          if (lat < sy0) sy0 = lat;
          if (lat > sy1) sy1 = lat;
        }
      }
      const sMid = (sy0 + sy1) / 2;
      const sCos = Math.cos((sMid * Math.PI) / 180);
      // 插图宽度按主图宽度的 11% 定：太大会压住华东沿海，太小断续线糊成一团
      const sW = 112;
      const sScale = sW / ((sx1 - sx0) * sCos);
      const sProject = ([lng, lat]) => [
        Math.round((lng - sx0) * sCos * sScale * 10) / 10,
        Math.round((sy1 - lat) * sScale * 10) / 10,
      ];
      const pathParts = [];
      for (const r of rings) {
        const slim = simplify(r.map(sProject), 0.4);
        if (slim.length >= 3) {
          pathParts.push('M' + slim.map(([x, y]) => `${x} ${y}`).join('L') + 'Z');
        }
      }
      if (pathParts.length) {
        nanhai = {
          viewBox: `0 0 ${sW} ${Math.round((sy1 - sy0) * sScale)}`,
          width: sW,
          height: Math.round((sy1 - sy0) * sScale),
          path: pathParts.join(''),
        };
      }
    }
  }

  return {
    viewBox: `0 0 ${finalW} ${finalH}`,
    width: finalW,
    height: finalH,
    features: out,
    nanhai,
  };
}

/** adcode -> 名义层级（只用来判断能否继续下钻，不代表导航深度） */
export function adcodeLevel(adcode) {
  const a = String(adcode);
  if (a === ROOT_ADCODE) return 0;
  if (/0000$/.test(a)) return 1; // 省级
  if (/00$/.test(a)) return 2; // 市级
  return 3; // 区县级
}

/** 是否还能往下钻（没有下级的直管市、区县都是 false） */
export function hasChildren(adcode) {
  const a = String(adcode);
  if (LEAF_ADCODES.has(a)) return false;
  return adcodeLevel(a) < 3;
}

/**
 * 运行时发现的「无下级」adcode（DataV 404）。
 * 台湾省 710000 就是这种情况：DataV 不提供它的下级区划，图上照常画成省级区，
 * 但点了不该往下钻。构建期发现的会写进 index.json 的 noChildren。
 */
const runtimeNoChildren = new Set();

export function markNoChildren(adcode) {
  runtimeNoChildren.add(String(adcode));
}

/** 能不能下钻：索引明确说没有下级 -> false；索引没提到就按 adcode 层级判 */
export function canDrill(adcode) {
  const code = String(adcode);
  const idx = loadIndex();
  if (idx && Array.isArray(idx.noChildren) && idx.noChildren.includes(code)) return false;
  if (runtimeNoChildren.has(code)) return false;
  return hasChildren(code);
}

// ---------------------------------------------------------------- 取源数据

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 取某 adcode 的原始 GeoJSON：优先本地缓存，没有再打 DataV。
 * 服务器上 DataV 是通的（境内 CDN），失败就报清楚，不静默降级成空地图。
 */
export async function fetchRaw(adcode, { force = false } = {}) {
  ensureDir(RAW_DIR);
  const file = path.join(RAW_DIR, `${adcode}.json`);
  if (!force && fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* 缓存坏了就重下 */
    }
  }
  const url = `https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'laroja-map-builder' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const err = new Error(`DataV 取 ${adcode} 失败：HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`DataV 返回的不是 JSON（${adcode}）`);
  }
  fs.writeFileSync(file, text, 'utf8');
  return json;
}

/** 从原始文件构建一级并落盘（构建脚本与运行时共用的唯一实现） */
export async function buildAdcode(adcode, { toPublic = false, force = false } = {}) {
  const code = String(adcode);
  const raw = await fetchRaw(code, { force });
  const isRoot = code === ROOT_ADCODE;
  const built = buildLevel(raw, isRoot ? { dropBelowLat: true, minLat: MAIN_MIN_LAT } : {});
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: SOURCE_LABEL,
    adcode: code,
    ...built,
  };
  const dir = toPublic ? DATA_DIR : RUNTIME_DIR;
  ensureDir(dir);
  const file = path.join(dir, `${code}.json`);
  fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  return payload;
}

// ---------------------------------------------------------------- 读索引

let indexCache = null;
/** `public/data/cn/index.json`：adcode ↔ 名称 ↔ 上级，服务端解析路径用 */
export function loadIndex({ reload = false } = {}) {
  if (indexCache && !reload) return indexCache;
  const file = path.join(DATA_DIR, 'index.json');
  if (!fs.existsSync(file)) return null;
  indexCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  return indexCache;
}

/**
 * adcode -> { name, adcode, ancestors: [{name,adcode}], children?: [] }
 * 索引里没有的（运行时新抓的）返回 null，调用方自己兜底。
 */
export function resolveAdcode(adcode) {
  const idx = loadIndex();
  if (!idx) return null;
  const code = String(adcode);
  if (code === ROOT_ADCODE) return { adcode: code, name: '全国', ancestors: [], children: idx.provinces };
  const province = (idx.provinces || []).find((p) => String(p.adcode) === code);
  if (province) {
    return {
      adcode: code,
      name: province.name,
      ancestors: [{ adcode: ROOT_ADCODE, name: '全国' }],
      children: province.cities || [],
    };
  }
  for (const p of idx.provinces || []) {
    const city = (p.cities || []).find((c) => String(c.adcode) === code);
    if (city) {
      return {
        adcode: code,
        name: city.name,
        ancestors: [
          { adcode: ROOT_ADCODE, name: '全国' },
          { adcode: String(p.adcode), name: p.name },
        ],
        children: city.districts || [],
      };
    }
  }
  return null;
}

/** 从层级缓存里读已构建的图（public 优先，其次运行时缓存） */
export function readBuilt(adcode) {
  const code = String(adcode);
  for (const dir of [DATA_DIR, RUNTIME_DIR]) {
    const file = path.join(dir, `${code}.json`);
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        /* 坏文件当没有 */
      }
    }
  }
  return null;
}

/** 拿一级地图：已构建直接用，否则现场构建并落运行时缓存 */
export async function getLevel(adcode) {
  const built = readBuilt(adcode);
  if (built) return { geo: built, builtAtRequest: false };
  const geo = await buildAdcode(adcode, { toPublic: false });
  return { geo, builtAtRequest: true };
}
