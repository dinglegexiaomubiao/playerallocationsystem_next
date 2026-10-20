/**
 * 把 dump-data.js 导出的 schema.sql + data.sql 导入目标库。
 *
 * 目标库是阿里云 RDS 时，服务器上通常没有 psql 客户端，所以这里用 Node 直接执行，
 * 只要装了项目依赖就能跑。
 *
 * 用法：
 *   TARGET_DATABASE_URL='postgresql://user:pass@host:5432/neondb' node scripts/import-data.js
 *   DATABASE_SSL=off TARGET_DATABASE_URL='...' node scripts/import-data.js   # 内网 RDS
 *   node scripts/import-data.js --dir ./somewhere --force
 *
 * 安全：默认拒绝往「已有表的库」里导入，防止重复灌数据。确认要覆盖时加 --force。
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadEnv } = require('./env');

loadEnv();

const TARGET = process.env.TARGET_DATABASE_URL || process.env.DATABASE_URL;
if (!TARGET) {
  console.error('缺少连接串：请设置 TARGET_DATABASE_URL（或 DATABASE_URL）');
  process.exit(1);
}

const dirIdx = process.argv.indexOf('--dir');
const DIR = path.resolve(
  dirIdx > -1 ? process.argv[dirIdx + 1] : path.join(__dirname, '..', '.cache', 'migration')
);
const FORCE = process.argv.includes('--force');
const useSsl = String(process.env.DATABASE_SSL || '').toLowerCase() !== 'off';

const schemaPath = path.join(DIR, 'schema.sql');
const dataPath = path.join(DIR, 'data.sql');

for (const p of [schemaPath, dataPath]) {
  if (!fs.existsSync(p)) {
    console.error(`找不到文件：${p}\n请先运行 node scripts/dump-data.js 导出`);
    process.exit(1);
  }
}

async function main() {
  const c = new Client({
    connectionString: TARGET,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  });

  const t0 = Date.now();
  await c.connect();
  console.log(`已连接目标库（${Date.now() - t0} ms，SSL ${useSsl ? '开' : '关'}）`);

  try {
    // 目标库非空保护
    const exist = await c.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`
    );
    if (exist.rows[0].n > 0 && !FORCE) {
      console.error(
        `\n✗ 目标库 public 下已有 ${exist.rows[0].n} 张表，为防重复导入已中止。\n` +
          '  如果确认要覆盖，加 --force；如果只是想看看，先手动清库。'
      );
      process.exit(1);
    }

    // 结构
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    const s0 = Date.now();
    await c.query(schemaSql);
    console.log(`✓ 结构导入完成（${Date.now() - s0} ms）`);

    // 数据
    const dataSql = fs.readFileSync(dataPath, 'utf8');
    const d0 = Date.now();
    await c.query(dataSql);
    console.log(`✓ 数据导入完成（${Date.now() - d0} ms）`);

    // 结果
    const rows = await c.query(`
      SELECT relname AS name, n_live_tup AS rows
        FROM pg_stat_user_tables
       WHERE schemaname = 'public'
       ORDER BY relname
    `);
    console.log('\n各表行数：');
    let total = 0;
    for (const r of rows.rows) {
      total += Number(r.rows);
      console.log(`  ${String(r.name).padEnd(38)} ${r.rows}`);
    }
    console.log(`  ${'合计'.padEnd(38)} ${total}`);

    // 抽样校验：能否正常查询主键
    const sample = await c.query('SELECT count(*)::int AS n FROM public.players');
    console.log(`\n✓ 抽样查询正常，players 共 ${sample.rows[0].n} 人`);
    console.log('提示：pg_stat 的 n_live_tup 是估算值，精确值可用 SELECT count(*)。');
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error('导入失败：', e.message);
  process.exit(1);
});
