/**
 * 从源库导出「结构 + 数据」为两个可离线执行的 SQL 文件。
 *
 * 为什么自己写而不用 pg_dump：本机没装 PostgreSQL 客户端工具。
 * 本项目数据量极小（最大表 101 行），用 Node + pg 完全够用。
 *
 * 输出：
 *   <outDir>/schema.sql   建表、序列、索引、主键（幂等，可重复执行）
 *   <outDir>/data.sql     全部数据 INSERT + 序列复位
 *
 * 用法：
 *   node scripts/dump-data.js                        # 默认输出到 .cache/migration
 *   node scripts/dump-data.js --out ./somewhere
 *   SOURCE_DATABASE_URL=postgresql://... node scripts/dump-data.js
 *
 * 取值策略：所有列一律 ::text 取出，由 PostgreSQL 自己完成类型到文本的转换，
 * 避免 JS 时区、bigint 精度、jsonb 序列化这些坑。写回时再按列类型决定要不要加引号。
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { loadEnv } = require('./env');

loadEnv();

const SOURCE =
  process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;

if (!SOURCE) {
  console.error('缺少连接串：请设置 DATABASE_URL 或 SOURCE_DATABASE_URL（可放在 .env.local）');
  process.exit(1);
}

const argOut = (() => {
  const i = process.argv.indexOf('--out');
  return i > -1 ? process.argv[i + 1] : null;
})();
const OUT_DIR = path.resolve(argOut || path.join(__dirname, '..', '.cache', 'migration'));

// 数值类型不加引号，其余一律加引号
const NUMERIC_TYPES = new Set([
  'smallint',
  'integer',
  'bigint',
  'numeric',
  'real',
  'double precision',
]);

const quoteIdent = (s) => `"${String(s).replace(/"/g, '""')}"`;

function quoteValue(raw, dataType) {
  if (raw === null || raw === undefined) return 'NULL';
  if (dataType === 'boolean') return raw === 'true' ? 'true' : 'false';
  if (NUMERIC_TYPES.has(dataType)) {
    // 极少数情况下数值列里会有空串，退回 NULL 免得生成非法 SQL
    return String(raw).trim() === '' ? 'NULL' : String(raw);
  }
  return `'${String(raw).replace(/'/g, "''")}'`;
}

async function main() {
  const client = new Client({ connectionString: SOURCE, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // ---------- 1. 表清单 ----------
    const tablesRes = await client.query(`
      SELECT c.relname AS name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY c.relname
    `);
    const tables = tablesRes.rows.map((r) => r.name);
    console.log(`发现 ${tables.length} 张表：${tables.join(', ')}\n`);

    // ---------- 2. 序列 ----------
    const seqRes = await client.query(`
      SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename
    `);
    const sequences = seqRes.rows.map((r) => r.sequencename);

    const schemaParts = [];
    const dataParts = [];
    const summary = [];

    schemaParts.push('-- 由 scripts/dump-data.js 自动生成的结构导出');
    schemaParts.push('-- 幂等：重复执行不会报错');
    schemaParts.push('SET client_encoding = \'UTF8\';');
    schemaParts.push('SET standard_conforming_strings = on;');
    schemaParts.push('');

    for (const seq of sequences) {
      schemaParts.push(`CREATE SEQUENCE IF NOT EXISTS public.${quoteIdent(seq)};`);
    }
    if (sequences.length) schemaParts.push('');

    for (const table of tables) {
      // 列信息
      const colsRes = await client.query(
        `SELECT column_name, data_type, character_maximum_length,
                is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [table]
      );
      const cols = colsRes.rows;

      // 主键
      const pkRes = await client.query(
        `SELECT a.attname AS col
           FROM pg_index i
           JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary`,
        [`public.${quoteIdent(table)}`]
      );
      const pkCols = pkRes.rows.map((r) => r.col);

      // CREATE TABLE
      const colDefs = cols.map((c) => {
        let type = c.data_type;
        if (c.character_maximum_length) {
          type = `${type}(${c.character_maximum_length})`;
        }
        let def = `  ${quoteIdent(c.column_name)} ${type}`;
        if (c.column_default !== null && c.column_default !== undefined) {
          def += ` DEFAULT ${c.column_default}`;
        }
        if (c.is_nullable === 'NO') def += ' NOT NULL';
        return def;
      });
      if (pkCols.length) {
        colDefs.push(`  PRIMARY KEY (${pkCols.map(quoteIdent).join(', ')})`);
      }

      schemaParts.push(`CREATE TABLE IF NOT EXISTS public.${quoteIdent(table)} (`);
      schemaParts.push(colDefs.join(',\n'));
      schemaParts.push(');');

      // 索引（pg_indexes.indexdef 已是完整语句，补上 IF NOT EXISTS）
      const idxRes = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`,
        [table]
      );
      for (const r of idxRes.rows) {
        let def = r.indexdef;
        if (!/^CREATE (UNIQUE )?INDEX /i.test(def)) continue;
        // 主键索引由 PRIMARY KEY 自动创建，跳过
        if (/ CREATE (UNIQUE )?INDEX .*_pkey /i.test(' ' + def)) continue;
        def = def.replace(/^CREATE (UNIQUE )?INDEX /i, (m, u) => `CREATE ${u || ''}INDEX IF NOT EXISTS `);
        schemaParts.push(`${def};`);
      }
      schemaParts.push('');

      // ---------- 3. 数据 ----------
      // 所有列 ::text 取出，规避时区 / bigint / jsonb 的序列化差异
      const selectList = cols
        .map((c) => `${quoteIdent(c.column_name)}::text AS ${quoteIdent(c.column_name)}`)
        .join(', ');
      const rowsRes = await client.query(`SELECT ${selectList} FROM public.${quoteIdent(table)}`);

      if (rowsRes.rows.length) {
        const colNames = cols.map((c) => quoteIdent(c.column_name)).join(', ');
        dataParts.push(`-- ${table}：${rowsRes.rows.length} 行`);
        dataParts.push(`INSERT INTO public.${quoteIdent(table)} (${colNames}) VALUES`);
        const tuples = rowsRes.rows.map((row) => {
          const vals = cols.map((c) => quoteValue(row[c.column_name], c.data_type));
          return `  (${vals.join(', ')})`;
        });
        dataParts.push(tuples.join(',\n') + ';');
        dataParts.push('');
      }

      summary.push({ table, rows: rowsRes.rows.length, cols: cols.length });
    }

    // ---------- 4. 序列复位 ----------
    const setvalParts = [];
    for (const seq of sequences) {
      // 序列的「拥有表.列」关系
      const dep = await client.query(
        `SELECT c.relname AS tbl, a.attname AS col
           FROM pg_depend d
           JOIN pg_class s ON s.oid = d.objid
           JOIN pg_class c ON c.oid = d.refobjid
           JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
          WHERE s.relname = $1 AND s.relkind = 'S' AND c.relkind = 'r'
          LIMIT 1`,
        [seq]
      );
      if (dep.rows.length) {
        const { tbl, col } = dep.rows[0];
        setvalParts.push(
          `SELECT setval('public.${seq}', COALESCE((SELECT MAX(${quoteIdent(col)}) FROM public.${quoteIdent(tbl)}), 1));`
        );
      }
    }
    if (setvalParts.length) {
      dataParts.push('-- 序列复位到当前最大值，避免新插入撞主键');
      dataParts.push(...setvalParts);
      dataParts.push('');
    }

    // ---------- 5. 落盘 ----------
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const schemaPath = path.join(OUT_DIR, 'schema.sql');
    const dataPath = path.join(OUT_DIR, 'data.sql');
    fs.writeFileSync(schemaPath, schemaParts.join('\n'), 'utf8');
    fs.writeFileSync(dataPath, dataParts.join('\n'), 'utf8');

    console.log('导出完成：');
    for (const s of summary) {
      console.log(`  ${s.table.padEnd(38)} ${String(s.rows).padStart(5)} 行  ${s.cols} 列`);
    }
    const totalRows = summary.reduce((a, b) => a + b.rows, 0);
    console.log(`  ${'合计'.padEnd(38)} ${String(totalRows).padStart(5)} 行`);
    console.log(`\n  ${schemaPath}  (${(fs.statSync(schemaPath).size / 1024).toFixed(1)} KB)`);
    console.log(`  ${dataPath}    (${(fs.statSync(dataPath).size / 1024).toFixed(1)} KB)`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('导出失败：', e.message);
  process.exit(1);
});
