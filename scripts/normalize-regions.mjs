/**
 * 把老的自由文本地区归一化成规范路径（`中国 广东省 深圳市 南山区`）。
 *
 * 背景：地区字段原来是「随便填」，线上 158 人里 9 个填了，写法五花八门
 * （`南山`、`南山区`、`龙华，深圳，china`）。改成级联选择后，这些值在新界面里
 * 认不出来，也就没法判断「是否在深圳」。这里一次性收敛掉。
 *
 * 安全措施：
 *  - **默认 dry-run**，只打印不写库；确认无误再加 `--apply`。
 *  - 写之前把 before/after 全量落到 `backups/region-normalize-<时间戳>.json`，
 *    出问题可以照着改回去。
 *  - 猜不出来的**保留原值**，绝不硬改。
 *
 * 用法：
 *   set -a; . ./.env.local; set +a
 *   node scripts/normalize-regions.mjs            # 预演
 *   node scripts/normalize-regions.mjs --apply    # 落库
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { guessRegionFromLegacy, isShenzhen, regionFull } from '../lib/regions.js';

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const main = async () => {
  const division = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/china-division.json'), 'utf8'));
  const { rows } = await pool.query(
    `SELECT id::text AS id, nickname, region
       FROM public.players
      WHERE coalesce(btrim(region), '') <> ''
      ORDER BY id DESC`
  );

  const changes = [];
  const skipped = [];

  for (const r of rows) {
    const before = String(r.region || '').trim();
    const after = guessRegionFromLegacy(before, division);
    if (!after || after === before) {
      skipped.push({ id: r.id, nickname: r.nickname, region: before, reason: after ? '已是规范格式' : '无法识别' });
      continue;
    }
    changes.push({ id: r.id, nickname: r.nickname, before, after, shenzhen: isShenzhen(after) });
  }

  console.log(`扫描 ${rows.length} 条有地区的记录\n`);

  if (changes.length === 0) {
    console.log('没有需要改的记录。');
  } else {
    console.log('将要修改：');
    for (const c of changes) {
      console.log(
        `  ${String(c.nickname || '').padEnd(12)} ${JSON.stringify(c.before).padEnd(24)} → ${c.after}` +
          (c.shenzhen ? '  [深圳]' : '')
      );
    }
  }

  if (skipped.length) {
    console.log('\n跳过：');
    for (const s of skipped) {
      console.log(`  ${String(s.nickname || '').padEnd(12)} ${JSON.stringify(s.region).padEnd(24)} ${s.reason}`);
    }
  }

  if (!APPLY) {
    console.log('\n这是预演。确认无误后加 --apply 落库。');
    return;
  }
  if (changes.length === 0) return;

  // 备份：改之前先把 before/after 全量写盘
  const backupDir = path.join(ROOT, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(backupDir, `region-normalize-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ appliedAt: new Date().toISOString(), changes }, null, 2));
  console.log(`\n已备份到 ${backupFile}`);

  let ok = 0;
  for (const c of changes) {
    const res = await pool.query('UPDATE public.players SET region = $1 WHERE id = $2', [c.after, c.id]);
    ok += res.rowCount;
  }
  console.log(`已更新 ${ok} 条。`);

  const check = await pool.query(
    `SELECT count(*)::int AS n FROM public.players WHERE coalesce(btrim(region), '') <> ''`
  );
  const sample = await pool.query(
    `SELECT nickname, region FROM public.players WHERE coalesce(btrim(region), '') <> '' ORDER BY id DESC LIMIT 12`
  );
  console.log(`现在共 ${check.rows[0].n} 条有地区，抽样：`);
  sample.rows.forEach((r) => console.log(`  ${r.nickname} · ${regionFull(r.region)}`));
};

main()
  .catch((e) => {
    console.error('失败:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
