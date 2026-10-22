/**
 * 把「擅长英雄」文本里残留的旧译名改成官方译名。
 *
 * 背景：`players.heroes` / `tournament_players.heroes` 存的是**英雄名文本**
 * （逗号分隔），不是 id。2026-10-22 之前 `lib/heroesData.js` 里有几个非官方译名
 * （水晶侍女、剃刀、拉希克、远古冰魂、刚背兽、马尔斯），群友当时选中的就是这些字符串，
 * 现在英雄表换成官方译名（水晶室女、雷泽、拉席克、远古冰魄、钢背兽、玛尔斯），
 * 老数据不改就会：卡片上显示旧名 + 按英雄筛选时匹配不上。
 *
 * 只做**名字替换**，按 token 精确匹配（不做模糊包含），并顺手去重。
 * 替换完还会把不认识的 token 列出来 —— 那是人工录入的别称，脚本不碰，只提示。
 *
 * 用法：
 *   npm run db:tunnel                          # 另一个终端
 *   node scripts/normalize-hero-names.mjs            # 预演（只打印）
 *   node scripts/normalize-hero-names.mjs --apply    # 落库（先写备份）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import heroIdToName from '../lib/heroMapping.js';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');

/**
 * 旧名 → 官方名。键是 2026-10-22 之前 heroesData/heroMapping 里出现过的非官方译名，
 * 值取自 Valve 官方简中。新增映射前先确认官方名，别把官方名改成别称。
 */
const ALIASES = {
  水晶侍女: '水晶室女',
  剃刀: '雷泽',
  拉希克: '拉席克',
  远古冰魂: '远古冰魄',
  刚背兽: '钢背兽',
  马尔斯: '玛尔斯',
};

const OFFICIAL = new Set(Object.values(heroIdToName));

const TABLES = ['players', 'tournament_players'];

/** 按逗号切分（中英文逗号都认），去空白、去空项、按旧名替换、保序去重 */
function normalizeHeroes(text, stats) {
  const tokens = String(text || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const t of tokens) {
    const next = ALIASES[t] || t;
    if (ALIASES[t]) stats.renamed.set(t, (stats.renamed.get(t) || 0) + 1);
    if (seen.has(next)) {
      stats.deduped += 1;
      continue;
    }
    seen.add(next);
    out.push(next);
    if (!OFFICIAL.has(next)) stats.unknown.add(next);
  }
  return out.join(',');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const stats = { renamed: new Map(), deduped: 0, unknown: new Set() };
  const changes = [];

  for (const table of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM public.${table} WHERE heroes IS NOT NULL AND heroes <> ''`);
    for (const row of rows) {
      const after = normalizeHeroes(row.heroes, stats);
      if (after !== row.heroes) {
        changes.push({ table, id: row.id ?? `${row.tournament_id}/${row.player_id}`, key: row, before: row.heroes, after });
      }
    }
  }

  if (!changes.length) {
    console.log('✓ 没有需要改的记录');
  } else {
    console.log(`待修改 ${changes.length} 条：`);
    for (const c of changes) {
      console.log(`  ${c.table} ${c.id}`);
      console.log(`    ${c.before}`);
      console.log(` →  ${c.after}`);
    }
  }

  if (stats.renamed.size) {
    console.log('\n改名统计：');
    for (const [from, n] of stats.renamed) console.log(`  ${from} → ${ALIASES[from]}  ${n} 处`);
  }
  if (stats.deduped) console.log(`\n去重 ${stats.deduped} 个重复英雄`);
  if (stats.unknown.size) {
    console.log('\n⚠ 认不出的名字（人工别称，脚本不动，只提示）：');
    console.log('  ' + [...stats.unknown].join(', '));
  }

  if (!changes.length) return pool.end();

  if (!APPLY) {
    console.log('\n（预演）加 --apply 落库');
    return pool.end();
  }

  const dir = path.join(ROOT, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `hero-names-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(changes.map((c) => ({ table: c.table, id: c.id, before: c.before, after: c.after })), null, 2), 'utf8');
  console.log(`\n已备份 → ${path.relative(ROOT, file)}`);

  for (const c of changes) {
    if (c.table === 'players') {
      await pool.query('UPDATE public.players SET heroes = $1 WHERE id = $2', [c.after, c.key.id]);
    } else {
      await pool.query('UPDATE public.tournament_players SET heroes = $1 WHERE tournament_id = $2 AND player_id = $3', [
        c.after,
        c.key.tournament_id,
        c.key.player_id,
      ]);
    }
  }
  console.log(`✓ 已更新 ${changes.length} 条`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e && e.stack ? e.stack : e);
  await pool.end().catch(() => {});
  process.exit(1);
});
