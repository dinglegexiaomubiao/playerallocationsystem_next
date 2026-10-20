const { Pool } = require('pg');
const { requireDatabaseUrl } = require('./scripts/env');

// 连接串从 .env.local / 环境变量读取，不写死在代码里（历史泄漏点，勿回退）
const pool = new Pool({
  connectionString: requireDatabaseUrl(),
  ssl: {
    rejectUnauthorized: false
  }
});

async function migrateTeamsTable() {
  const client = await pool.connect();
  try {
    // 为队伍表添加主键约束
    await client.query('ALTER TABLE public.teams ADD PRIMARY KEY (id)');
    console.log('成功为队伍表添加主键约束');
  } catch (error) {
    console.error('为队伍表添加主键约束时出错:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateTeamsTable();