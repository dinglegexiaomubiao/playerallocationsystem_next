#!/usr/bin/env node
/**
 * 生成中国行政区划三级地图数据：public/data/cn/{adcode}.json + index.json
 *
 * 为什么预生成而不是运行时拉：
 *  - 全国图 582KB 原始 JSON / 约 25000 顶点，抽稀投影是纯计算，没必要每次开页都做；
 *  - 预生成后前端拿到的就是 `<path d="...">`，零依赖零计算；
 *  - 服务器访问 DataV 虽然通，但把「点一下省」的延迟押在外部 CDN 上不划算。
 * 运行时仍保留兜底（`lib/cn-geo.mjs#getLevel`）：没预生成的市点进去现抓 + 落
 * `.cache/cn-geo/`，所以任何一个市都能点，只是第一次慢一点。
 *
 * 预生成范围（默认）：
 *   1. 全国（100000）—— 34 个省级区 + 右下角南海诸岛插图
 *   2. 全部 34 个省（440000 等）—— 拿到各市的 adcode，同时省级地图直接可用
 *   3. 广东省 21 个市 + 台州临海那一带用到的市 —— 区县级地图
 *   其余市点进去时现构建。
 *
 * 用法：
 *   node scripts/build-china-map.cjs                 # 默认范围
 *   node scripts/build-china-map.cjs --all-cities    # 全国所有市（约 340 个，慢）
 *   node scripts/build-china-map.cjs --adcode 440300 # 只重建某一级
 *   node scripts/build-china-map.cjs --force         # 忽略 .cache/datav 重新下载
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'data', 'cn');

/** 直辖市与特别行政区：它们的下级直接是区，不需要再钻一层市 */
const MUNICIPALITIES = ['110000', '120000', '310000', '500000', '810000', '820000'];
/** 群里有人填了地区的非广东省份城市（台州），预生成免得第一次点卡一下 */
const EXTRA_CITIES = ['331000'];

async function main() {
  // Windows 上动态 import 绝对路径必须转成 file:// URL，否则报 "protocol 'e:'"
  const { pathToFileURL } = require('url');
  const geo = await import(pathToFileURL(path.join(ROOT, 'lib', 'cn-geo.mjs')).href);
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const allCities = args.includes('--all-cities');
  const onlyIdx = args.indexOf('--adcode');
  const only = onlyIdx >= 0 ? String(args[onlyIdx + 1]) : null;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = [];
  const build = async (adcode, label) => {
    const t = Date.now();
    const payload = await geo.buildAdcode(adcode, { toPublic: true, force });
    const size = fs.statSync(path.join(OUT_DIR, `${adcode}.json`)).size;
    const line = {
      adcode: String(adcode),
      name: label || '',
      features: payload.features.length,
      kb: +(size / 1024).toFixed(1),
      ms: Date.now() - t,
      nanhai: !!payload.nanhai,
    };
    manifest.push(line);
    console.log(
      `  ✓ ${String(adcode).padEnd(7)} ${String(line.name || '?').padEnd(10)} ` +
        `下级 ${String(line.features).padStart(3)} 个  ${String(line.kb).padStart(6)}KB  ${line.ms}ms` +
        (line.nanhai ? '  +南海插图' : '')
    );
    return payload;
  };

  if (only) {
    await build(only);
    return;
  }

  console.log('[1/3] 全国（省级）');
  const root = await build(geo.ROOT_ADCODE, '全国');
  if (!root.nanhai) throw new Error('全国图没有生成南海诸岛插图，领土表达不完整，中止');

  console.log('\n[2/3] 34 个省级区');
  const provinces = root.features.map((f) => ({ name: f.name, adcode: f.adcode }));
  if (provinces.length < 34) throw new Error(`省级区只有 ${provinces.length} 个，应为 34`);

  const provinceIndex = [];
  const noChildren = new Set(geo.LEAF_ADCODES);
  for (const p of provinces) {
    let payload = null;
    try {
      payload = await build(p.adcode, p.name);
    } catch (e) {
      // 台湾省 710000 这类：DataV 不提供下级区划。图上仍画成省级区，只是不可下钻。
      noChildren.add(String(p.adcode));
      console.log(`  · ${p.adcode} ${p.name} 无下级数据（${e.message}），按不可下钻处理`);
    }
    provinceIndex.push({
      name: p.name,
      adcode: p.adcode,
      cities: payload ? payload.features.map((f) => ({ name: f.name, adcode: f.adcode })) : [],
    });
  }

  console.log('\n[3/3] 区县（市一级）');
  const targets = new Set(EXTRA_CITIES);
  for (const p of provinceIndex) {
    if (allCities || p.name === '广东省') {
      for (const c of p.cities) {
        if (geo.hasChildren(c.adcode)) targets.add(String(c.adcode));
      }
    }
  }
  // 直辖市/港澳的「下级」在第二步就建完了（它们下面直接是区），跳过
  for (const m of MUNICIPALITIES) targets.delete(m);

  let ok = 0;
  let skipped = 0;
  for (const adcode of targets) {
    try {
      await build(adcode);
      ok++;
    } catch (e) {
      // 有的市确实没有下级（DataV 404），这不是错误
      skipped++;
      noChildren.add(String(adcode));
      console.log(`  · ${adcode} 无下级区县（${e.message}），跳过`);
    }
  }

  // ---- 索引：adcode ↔ 名称 ↔ 上级。服务端解析 URL 里的 adcode 靠它 ----
  const index = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: geo.SOURCE_LABEL,
    rootAdcode: geo.ROOT_ADCODE,
    provinces: provinceIndex,
    built: manifest.map((m) => m.adcode),
    noChildren: [...noChildren].sort(),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index), 'utf8');
  const indexSize = fs.statSync(path.join(OUT_DIR, 'index.json')).size;

  const totalKb = manifest.reduce((s, m) => s + m.kb, 0) + indexSize / 1024;
  console.log(`\n完成：${manifest.length} 个层级文件，合计 ${(totalKb / 1024).toFixed(2)}MB`);
  console.log(`索引 index.json ${(indexSize / 1024).toFixed(1)}KB，覆盖 ${provinceIndex.length} 个省`);
  console.log(`区县层：成功 ${ok} 个，跳过 ${skipped} 个`);
}

main().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
