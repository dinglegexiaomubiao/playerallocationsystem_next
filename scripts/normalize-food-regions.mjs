/**
 * 把美食的老「区名」补成规范的国/省/市/区路径（`中国 广东省 深圳市 南山区`）。
 *
 * 背景：`foods.area` 原来是自由文本（`南山`、`福田`、`南山 西丽`）。分布图要按区
 * 聚合，靠 `area` 模糊匹配能跑但不可靠；2026-10-22 给 `foods` 加了 `region` 列，
 * 这个脚本把历史数据补齐，之后 `lib/map-data.mjs` 的 districtOfFood 优先读 region。
 *
 * ⚠ **只写 region，绝不改 area**。`area` 同时是 Excel 导入的去重键
 * （`shopKey(name, area)`），把它从 `南山 西丽` 改成 `南山区` 会让下次导入对不上、
 * 凭空多出一份重复记录。
 *
 * 安全措施（和 normalize-regions.mjs 一致）：
 *  - 默认 dry-run，只打印；确认后加 `--apply`。
 *  - 写库前把 before/after 全量备份到 `backups/food-region-<时间戳>.json`。
 *  - 认不出的区位保留原样，绝不瞎猜。
 *
 * 用法：
 *   npm run db:tunnel                       # 另一个终端
 *   set -a; . ./.env.local; set +a
 *   node scripts/normalize-food-regions.mjs           # 预演
 *   node scripts/normalize-food-regions.mjs --apply   # 落库
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { formatRegion } from '../lib/regions.js';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');

// 9 个区从地图数据里读，别再抄一份（抄了就会和地图漂移）。
// 2026-10-22 地图扩成全国三级后，深圳的几何从 shenzhen.geo.json 换成了
// public/data/cn/440300.json（同一个数据源，只是改成按 adcode 组织）。
const GEO = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/cn/440300.json'), 'utf8'));
const SZ_DISTRICTS = GEO.features.map((d) => d.name);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SHORT = new Map(SZ_DISTRICTS.map((d) => [d.replace(/区$/u, ''), d]));

/** 从自由文本里认出深圳的区；认不出返回 null */
function sniffDistrict(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const exact = SZ_DISTRICTS.find((d) => raw.includes(d));
  if (exact) return exact;
  const short = [...SHORT.entries()].find(([s]) => raw.includes(s));
  return short ? short[1] : null;
}

const main = async () => {
  // 库可能还没跑过 API 的 ensureTable，这里的 ALTER 是幂等的，先补上
  for (const col of ['region varchar(50)', 'lat numeric(9,6)', 'lng numeric(9,6)']) {
    await pool.query(`ALTER TABLE public.foods ADD COLUMN IF NOT EXISTS ${col}`);
  }

  const { rows } = await pool.query('SELECT * FROM public.foods ORDER BY id DESC');

  const changes = [];
  const skipped = [];
  for (const f of rows) {
    const hasRegion = String(f.region || '').trim() !== '';
    if (hasRegion) {
      skipped.push({ id: f.id, name: f.name, region: f.region, reason: '已有规范地区' });
      continue;
    }
    const d = sniffDistrict(f.area);
    if (!d) {
      skipped.push({ id: f.id, name: f.name, region: f.area || '（空）', reason: '区位认不出是深圳的哪个区' });
      continue;
    }
    const after = formatRegion({ country: '中国', province: '广东省', city: '深圳市', district: d });
    changes.push({ id: String(f.id), name: f.name, before: f.area || '', after, district: d });
  }

  console.log(`扫描 ${rows.length} 条美食，需要补地区 ${changes.length} 条\n`);

  if (changes.length) {
    console.log('将要补上：');
    for (const c of changes) {
      console.log(`  ${String(c.name || '').slice(0, 18).padEnd(20)} ${JSON.stringify(c.before).padEnd(16)} → ${c.after}`);
    }
  }
  if (skipped.length) {
    console.log(`\n跳过 ${skipped.length} 条（前 10 条）：`);
    skipped.slice(0, 10).forEach((s) => {
      console.log(`  ${String(s.name || '').slice(0, 18).padEnd(20)} ${String(s.region).padEnd(16)} ${s.reason}`);
    });
  }

  if (!APPLY) {
    console.log('\n这是预演。确认无误后加 --apply 落库。');
    return;
  }
  if (!changes.length) return;

  const backupDir = path.join(ROOT, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(backupDir, `food-region-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ appliedAt: new Date().toISOString(), changes }, null, 2));
  console.log(`\n已备份到 ${backupFile}`);

  let ok = 0;
  for (const c of changes) {
    const res = await pool.query('UPDATE public.foods SET region = $1 WHERE id = $2', [c.after, c.id]);
    ok += res.rowCount;
  }
  console.log(`已更新 ${ok} 条。`);

  const chk = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE coalesce(btrim(region), '') <> '')::int AS with_region
       FROM public.foods`
  );
  console.log(`现在共 ${chk.rows[0].total} 条美食，其中 ${chk.rows[0].with_region} 条有规范地区。`);
};

main()
  .catch((e) => {
    console.error('失败:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
