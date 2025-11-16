const { Pool } = require('pg');

// 创建数据库连接池
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_Nt7YOz4wIJcT@ep-withered-recipe-a1wny5so-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: {
    rejectUnauthorized: false
  }
});

// 初始化数据库表
const initDatabase = async () => {
  const client = await pool.connect();
  try {
    // 创建用户登录统计表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.play_score (
        "name" varchar PRIMARY KEY,
        count int4 DEFAULT 1
      );
    `);
  } catch (error) {
    console.error('数据库初始化错误:', error);
  } finally {
    client.release();
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  initDatabase
};