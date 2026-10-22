#!/usr/bin/env node
/**
 * 生成深圳行政区划 SVG 地图数据：public/data/shenzhen.geo.json
 *
 * 为什么要这一步，而不是前端直接拉 GeoJSON：
 *  1. 原始文件 69KB、约 2900 个顶点，直接进页面太重；
 *  2. 投影 + 抽稀 + 拼 path 字符串是一次性工作，没必要每次渲染都算；
 *    前端拿到就能直接 <path d="..."> 渲染，零依赖、零计算。
 *  3. 抽稀用 Douglas-Peucker，容差按最终 1000 宽的画布定，肉眼几乎看不出区别。
 *
 * 数据源：阿里云 DataV.GeoAtlas `areas_v3/bound/440300_full.json`（高德系行政区划）。
 * 合规说明（按要求只用白名单内的国内地图数据）：
 *  - 只用作**行政区划示意**，不接任何境外地图服务（Google / Apple / OSM / Mapbox 一律不碰）；
 *  - 只画深圳 9 个行政区，不涉及国界/省界，不存在领土表达问题；
 *  - 输出里保留了来源与生成时间，页面图例上也会标注。
 *
 * 深圳的 9 个区与 `public/data/china-division.json` 里深圳的 9 个区**完全一致**
 * （大鹏新区属龙岗区、深汕特别合作区属汕尾，都不在行政区列表里），
 * 所以不会出现「群友选了某个区、地图上却没有这块」的情况。
 *
 * 用法：node scripts/build-shenzhen-map.cjs [本地缓存文件]
 *   给了缓存文件就用本地的（离线/复现），否则去 DataV 拉最新的。
 */
const fs = require('fs');
const path = require('path');

const SOURCE_URL = 'https://geo.datav.aliyun.com/areas_v3/bound/440300_full.json';
const OUT = path.resolve(__dirname, '..', 'public', 'data', 'shenzhen.geo.json');
const CANVAS_W = 1000;
const EPSILON = 0.55; // 投影后画布像素，越小越精细

/** Douglas-Peucker 抽稀 */
function simplify(points, eps) {
  if (points.length <= 2) return points;
  const sqDistToSeg = (p, a, b) => {
    let x = a[0];
    let y = a[1];
    let dx = b[0] - x;
    let dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
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
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (maxDist > sqEps && idx > 0) {
      keep[idx] = true;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

async function loadSource(localFile) {
  if (localFile) return JSON.parse(fs.readFileSync(localFile, 'utf8'));
  const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': 'laroja-map-builder' } });
  if (!res.ok) throw new Error(`下载行政区划失败：HTTP ${res.status}`);
  return res.json();
}

function ringsOf(geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  const rings = [];
  for (const poly of polys) {
    for (const ring of poly) {
      if (ring && ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}

(async () => {
  const local = process.argv[2];
  const geo = await loadSource(local);

  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    throw new Error('数据格式不对：不是 FeatureCollection');
  }

  // ---- 1. 全局包围盒 ----
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const f of geo.features) {
    for (const ring of ringsOf(f.geometry)) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  const midLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((midLat * Math.PI) / 180);

  // ---- 2. 投影（等距圆柱 + 纬度余弦校正，深圳范围小，误差可忽略）----
  const spanX = (maxLng - minLng) * cosLat;
  const spanY = maxLat - minLat;
  const scale = CANVAS_W / spanX;

  const project = ([lng, lat]) => [
    Math.round(((lng - minLng) * cosLat * scale) * 10) / 10,
    Math.round(((maxLat - lat) * scale) * 10) / 10,
  ];

  // ---- 3. 逐区抽稀 ----
  const raw = [];
  let rawPts = 0;
  let keptPts = 0;

  for (const f of geo.features) {
    const name = f.properties && f.properties.name;
    if (!name) continue;

    const parts = [];
    for (const ring of ringsOf(f.geometry)) {
      rawPts += ring.length;
      const projected = ring.map(project);

      // 环首尾相同，抽稀前先去掉重复的尾点，之后自己闭合
      const closed = projected.length > 1 &&
        projected[0][0] === projected[projected.length - 1][0] &&
        projected[0][1] === projected[projected.length - 1][1];
      const body = closed ? projected.slice(0, -1) : projected;

      const slim = simplify(body, EPSILON);
      keptPts += slim.length;
      if (slim.length >= 3) parts.push(slim);
    }
    if (!parts.length) continue;

    const c = f.properties.centroid || f.properties.center;
    raw.push({ name, adcode: f.properties.adcode, parts, center: c ? project(c) : null });
  }

  // ---- 4. 按实际占用裁剪画布 ----
  // 直接用经纬度包围盒会留一大片空白（深圳最南的岛子把画布拉高了），
  // 这里按投影后的真实顶点重新算边界，只留 8px 内边距。
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const d of raw) {
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

  const districts = raw.map((d) => ({
    name: d.name,
    adcode: d.adcode,
    path: d.parts
      .map(
        (part) =>
          'M' + part.map(([x, y]) => `${Math.round((x + dx) * 10) / 10} ${Math.round((y + dy) * 10) / 10}`).join('L') + 'Z'
      )
      .join(''),
    center: d.center ? [Math.round((d.center[0] + dx) * 10) / 10, Math.round((d.center[1] + dy) * 10) / 10] : null,
  }));

  // 面积大的先画，避免小区域被压在下面
  districts.sort((a, b) => b.path.length - a.path.length);

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: '阿里云 DataV.GeoAtlas 440300_full.json（高德系行政区划，仅作示意）',
    viewBox: `0 0 ${finalW} ${finalH}`,
    width: finalW,
    height: finalH,
    bbox: { minLng, maxLng, minLat, maxLat },
    districts,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out), 'utf8');

  const size = fs.statSync(OUT).size;
  console.log(`✓ 写出 ${path.relative(path.resolve(__dirname, '..'), OUT)}`);
  console.log(`  区域 ${districts.length} 个：${districts.map((d) => d.name).join('、')}`);
  console.log(`  画布 ${out.viewBox}，顶点 ${rawPts} → ${keptPts}（抽稀 ${(100 - (keptPts / rawPts) * 100).toFixed(0)}%）`);
  console.log(`  体积 ${(size / 1024).toFixed(1)}KB`);

  if (districts.length !== 9) {
    throw new Error(`深圳应为 9 个行政区，实际 ${districts.length} 个`);
  }
  const expected = ['罗湖区', '福田区', '南山区', '宝安区', '龙岗区', '盐田区', '龙华区', '坪山区', '光明区'];
  const missing = expected.filter((n) => !districts.some((d) => d.name === n));
  if (missing.length) throw new Error('缺区：' + missing.join('、'));
})().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
