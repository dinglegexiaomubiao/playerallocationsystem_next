const { Pool } = require('pg');

// 创建数据库连接池
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_Nt7YOz4wIJcT@ep-withered-recipe-a1wny5so-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
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