const { Pool } = require('pg');

// 创建数据库连接池
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_Nt7YOz4wIJcT@ep-withered-recipe-a1wny5so-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: {
    rejectUnauthorized: false
  }
});

// 更新数据库表结构
const updateDatabaseStructure = async () => {
  const client = await pool.connect();
  try {
    console.log('开始更新数据库表结构...');
    
    // 修改tournaments表结构
    await client.query('BEGIN');
    
    // 1. 添加缺失的序列
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'tournaments_id_seq') THEN
          CREATE SEQUENCE IF NOT EXISTS tournaments_id_seq;
        END IF;
      END
      $$;
    `);
    
    // 2. 修改id列为SERIAL类型并设置默认值
    await client.query(`
      ALTER TABLE public.tournaments 
      ALTER COLUMN id TYPE integer 
      USING CASE WHEN id IS NOT NULL THEN id::integer ELSE nextval('tournaments_id_seq') END;
    `);
    
    // 3. 设置默认值和序列
    await client.query(`
      ALTER TABLE public.tournaments 
      ALTER COLUMN id SET DEFAULT nextval('tournaments_id_seq');
    `);
    
    // 4. 更新序列的起始值为当前最大id+1
    await client.query(`
      SELECT setval('tournaments_id_seq', COALESCE((SELECT MAX(id)+1 FROM public.tournaments), 1), false);
    `);
    
    // 5. 更新字段类型和长度
    await client.query(`ALTER TABLE public.tournaments ALTER COLUMN name TYPE VARCHAR(100);`);
    await client.query(`ALTER TABLE public.tournaments ALTER COLUMN start_date TYPE TIMESTAMP USING start_date::TIMESTAMP;`);
    await client.query(`ALTER TABLE public.tournaments ALTER COLUMN end_date TYPE TIMESTAMP USING end_date::TIMESTAMP;`);
    await client.query(`ALTER TABLE public.tournaments ALTER COLUMN sponsor_info TYPE VARCHAR(200);`);
    await client.query(`ALTER TABLE public.tournaments ALTER COLUMN champion_prize TYPE VARCHAR(100);`);
    await client.query(`ALTER TABLE public.tournaments ALTER COLUMN runner_up_prize TYPE VARCHAR(100);`);
    await client.query(`ALTER TABLE public.tournaments ALTER COLUMN status TYPE VARCHAR(20);`);
    
    // 6. 设置默认值
    await client.query(`ALTER TABLE public.tournaments ALTER COLUMN status SET DEFAULT 'planned';`);
    await client.query(`ALTER TABLE public.tournaments ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;`);
    
    await client.query('COMMIT');
    
    console.log('tournaments表结构更新完成！');
    
    // 验证更新结果
    const result = await client.query(`
      SELECT 
        column_name, 
        data_type, 
        is_nullable, 
        column_default 
      FROM information_schema.columns 
      WHERE table_name = 'tournaments' 
      ORDER BY ordinal_position;
    `);
    
    console.log('更新后的tournaments表结构:');
    result.rows.forEach(row => {
      console.log(`${row.column_name}: ${row.data_type}, nullable: ${row.is_nullable}, default: ${row.column_default}`);
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('数据库结构更新失败:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  updateDatabaseStructure
};