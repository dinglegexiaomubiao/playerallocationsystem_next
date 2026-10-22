#!/usr/bin/env node
/**
 * 从 Valve 官方简中数据重建英雄名表。
 *
 * 背景（2026-10-22）：lib/heroMapping.js 是手工维护的，攒出了 8 处错误 ——
 *   23 昆卡被写成「冥魂大帝」、60 暗夜魔王被写成「暗影恶魔」、89 娜迦海妖被写成
 *   「巨魔战将」，还有 15/52/68/99/129 的旧译名变体。前三处会导致同译名占两个 id，
 *   `new Set(Object.values(...))` 一取就少英雄，后台下拉里也看不到真正的昆卡。
 * 所以改成从官方数据生成，杜绝手写漂移。
 *
 * 数据源：https://www.dota2.com/datafeed/herolist?language=schinese
 *   → result.data.heroes[]，每项 { id, name: 'npc_dota_hero_xxx', name_loc: 官方简中 }
 *
 * 产出：
 *   lib/heroMapping.js   官方 hero_id → 官方简中名（对局展示用）
 *   lib/heroSlugs.js     官方简中名 → Valve CDN 文件名（即 npc 后缀，头像用）
 *
 * 用法：
 *   node scripts/build-hero-names.cjs            # 用 .cache/valve-herolist.json
 *   node scripts/build-hero-names.cjs --refresh  # 重新拉官方数据（新增英雄时用）
 *   node scripts/build-hero-names.cjs --check    # 只校验不写盘，不一致时退出码 1
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, '.cache', 'valve-herolist.json');
const API = 'https://www.dota2.com/datafeed/herolist?language=schinese';

const MAP_FILE = path.join(ROOT, 'lib', 'heroMapping.js');
const SLUG_FILE = path.join(ROOT, 'lib', 'heroSlugs.js');
const HEROES_DATA_FILE = path.join(ROOT, 'lib', 'heroesData.js');

// primary_attr：0 力量 / 1 敏捷 / 2 智力 / 3 全才
const ATTR_LABEL = { 0: '力量', 1: '敏捷', 2: '智力', 3: '全才' };

// 这几个是「必须正确」的锚点，错了就是又回到 2026-10-22 那个 bug
const ANCHORS = {
  23: '昆卡', 42: '冥魂大帝', 60: '暗夜魔王', 79: '暗影恶魔', 89: '娜迦海妖', 95: '巨魔战将',
};

async function loadHeroes(refresh) {
  if (refresh || !fs.existsSync(CACHE)) {
    process.stdout.write(`拉取官方数据 ${API}\n`);
    const res = await fetch(API);
    if (!res.ok) throw new Error(`官方数据返回 ${res.status}`);
    const json = await res.json();
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(json, null, 0), 'utf8');
    process.stdout.write(`已缓存 → ${path.relative(ROOT, CACHE)}\n`);
  }
  const json = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const heroes = json && json.result && json.result.data && json.result.data.heroes;
  if (!Array.isArray(heroes) || !heroes.length) throw new Error('官方数据结构变了，解析不到 heroes[]');
  return heroes
    .filter((h) => h && h.id && h.name && h.name_loc && h.name.startsWith('npc_dota_hero_'))
    .map((h) => ({
      id: Number(h.id),
      name: h.name_loc,
      slug: h.name.replace('npc_dota_hero_', ''),
      en: h.name_english_loc || '',
      attr: ATTR_LABEL[h.primary_attr] || '',
    }))
    .sort((a, b) => a.id - b.id);
}

function renderMapping(heroes) {
  const lines = heroes.map((h) => `  ${h.id}: ${JSON.stringify(h.name)},`);
  return `/**
 * Dota 2 官方 hero_id → 官方简中译名。
 *
 * ⚠ 本文件由 scripts/build-hero-names.cjs 自动生成，**不要手改**。
 *   新增英雄后跑：node scripts/build-hero-names.cjs --refresh
 *
 * 数据源：Valve 官方 https://www.dota2.com/datafeed/herolist?language=schinese
 *
 * 2026-10-22 之前这里是手写的，攒出过 8 处错（23 昆卡写成「冥魂大帝」、
 * 60 暗夜魔王写成「暗影恶魔」、89 娜迦海妖写成「巨魔战将」等）。同一译名占两个 id
 * 会让 \`new Set(Object.values(heroIdToName))\` 少英雄，对局里则显示成别的英雄。
 * 所以必须生成、不能手写。校验：node scripts/build-hero-names.cjs --check
 */
const heroIdToName = {
${lines.join('\n')}
};

export default heroIdToName;
`;
}

function renderSlugs(heroes) {
  const sorted = [...heroes].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  const lines = sorted.map((h) => `  ${JSON.stringify(h.name)}: ${JSON.stringify(h.slug)},`);
  return `/**
 * 英雄官方简中名 → Valve CDN 文件名（slug）。
 *
 * ⚠ 本文件由 scripts/build-hero-names.cjs 自动生成，**不要手改**。
 *   新增英雄后跑：node scripts/build-hero-names.cjs --refresh
 *
 * 用途：拼 https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/{slug}.png
 * slug 就是 npc_dota_hero_xxx 去掉前缀，和官方数据源同源，不会再和 heroMapping 的译名打架。
 *
 * 为什么不能直接用 heroesData 里的 id：那是本项目按中文名排序后重新编的序号（178~303），
 * 与官方 hero_id 无关。
 */
const heroSlugByName = {
${lines.join('\n')}
};

export default heroSlugByName;
`;
}

function parseMapping(src) {
  const out = {};
  for (const m of src.matchAll(/^\s*(\d+):\s*"([^"]+)"/gm)) out[+m[1]] = m[2];
  return out;
}

function parseSlugs(src) {
  const out = {};
  for (const m of src.matchAll(/^\s*"([^"]+)":\s*"([^"]+)"/gm)) out[m[1]] = m[2];
  return out;
}

/**
 * heroesData.js 是手工维护的（id 是本项目按中文名重编的序号，178~304，与官方 hero_id
 * 无关），没法整份生成，但可以校验：名字必须是官方译名、nickname 末位必须是官方主属性、
 * 不能缺英雄。2026-10-22 用它查出 8 个英雄属性不对 + 漏了朗戈。
 */
function checkHeroesData(heroes) {
  const out = [];
  if (!fs.existsSync(HEROES_DATA_FILE)) return out;

  const attrBy = {};
  for (const h of heroes) attrBy[h.name] = h.attr;

  const src = fs.readFileSync(HEROES_DATA_FILE, 'utf8');
  const rows = [...src.matchAll(/\{\s*"id":\s*(\d+),\s*"name":\s*"([^"]+)",\s*"nickname":\s*"([^"]*)"\s*\}/g)];
  const seen = new Set();

  for (const r of rows) {
    const [, id, name, nick] = r;
    seen.add(name);
    if (!attrBy[name]) {
      out.push(`heroesData.js  ${name}（id ${id}）官方已无此英雄名`);
      continue;
    }
    const tokens = String(nick).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const last = tokens[tokens.length - 1];
    if (last !== attrBy[name]) {
      out.push(`heroesData.js  ${name}（id ${id}）属性「${last}」→ 官方「${attrBy[name]}」`);
    }
  }

  for (const h of heroes) {
    if (!seen.has(h.name)) out.push(`heroesData.js  缺少英雄「${h.name}」（id ${h.id}）`);
  }

  return out;
}

function verify(heroes) {
  const problems = [];

  // 1. 同一译名不能占两个 id（2026-10-22 bug 的典型症状）
  const byName = new Map();
  for (const h of heroes) {
    if (!byName.has(h.name)) byName.set(h.name, []);
    byName.get(h.name).push(h.id);
  }
  for (const [name, ids] of byName) {
    if (ids.length > 1) problems.push(`译名「${name}」占了多个 id：${ids.join(', ')}`);
  }

  // 2. 锚点必须对
  const map = Object.fromEntries(heroes.map((h) => [h.id, h.name]));
  for (const [id, name] of Object.entries(ANCHORS)) {
    if (map[id] !== name) problems.push(`hero_id ${id} 应为「${name}」，实际「${map[id] || '缺失'}」`);
  }

  // 3. slug 不能有重复，且必须是合法文件名
  const slugSeen = new Map();
  for (const h of heroes) {
    if (!/^[a-z0-9_]+$/.test(h.slug)) problems.push(`slug 非法：${h.name} → ${h.slug}`);
    if (slugSeen.has(h.slug)) problems.push(`slug 重复：${h.slug}（${slugSeen.get(h.slug)} / ${h.name}）`);
    slugSeen.set(h.slug, h.name);
  }

  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const heroes = await loadHeroes(args.includes('--refresh'));

  const problems = verify(heroes);
  if (problems.length) {
    console.error('官方数据自检失败：');
    for (const p of problems) console.error('  ✗ ' + p);
    process.exit(1);
  }

  const nextMapSrc = renderMapping(heroes);
  const nextSlugSrc = renderSlugs(heroes);

  if (args.includes('--check')) {
    const curMap = fs.existsSync(MAP_FILE) ? fs.readFileSync(MAP_FILE, 'utf8') : '';
    const curSlug = fs.existsSync(SLUG_FILE) ? fs.readFileSync(SLUG_FILE, 'utf8') : '';
    const stale = [];

    const curMapObj = parseMapping(curMap);
    const nextMapObj = parseMapping(nextMapSrc);
    for (const h of heroes) {
      if (curMapObj[h.id] !== h.name) {
        stale.push(`heroMapping.js  ${h.id}  ${curMapObj[h.id] || '(缺失)'} → 应为 ${h.name}`);
      }
    }
    for (const id of Object.keys(curMapObj)) {
      if (!nextMapObj[id]) stale.push(`heroMapping.js  ${id}  ${curMapObj[id]} 官方已无此 id`);
    }

    const curSlugObj = parseSlugs(curSlug);
    const nextSlugObj = parseSlugs(nextSlugSrc);
    for (const h of heroes) {
      if (curSlugObj[h.name] !== h.slug) {
        stale.push(`heroSlugs.js  ${h.name}  ${curSlugObj[h.name] || '(缺失)'} → 应为 ${h.slug}`);
      }
    }
    for (const name of Object.keys(curSlugObj)) {
      if (!nextSlugObj[name]) stale.push(`heroSlugs.js  ${name} 官方已无此英雄名`);
    }

    stale.push(...checkHeroesData(heroes));

    if (stale.length) {
      console.error(`英雄名表与官方数据不一致（${stale.length} 处）：`);
      for (const s of stale) console.error('  ✗ ' + s);
      console.error('\n修：node scripts/build-hero-names.cjs');
      process.exit(1);
    }
    console.log(`✓ 英雄名表与官方数据一致（${heroes.length} 个英雄）`);
    return;
  }

  fs.writeFileSync(MAP_FILE, nextMapSrc, 'utf8');
  fs.writeFileSync(SLUG_FILE, nextSlugSrc, 'utf8');
  console.log(`✓ 已写入 lib/heroMapping.js（${heroes.length} 条）`);
  console.log(`✓ 已写入 lib/heroSlugs.js（${heroes.length} 条）`);
  console.log(`  锚点抽检：60=${heroes.find((h) => h.id === 60).name} · ` +
    `79=${heroes.find((h) => h.id === 79).name} · ` +
    `89=${heroes.find((h) => h.id === 89).name} · ` +
    `23=${heroes.find((h) => h.id === 23).name}`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
