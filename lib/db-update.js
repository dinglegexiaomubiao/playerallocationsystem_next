const { Pool } = require('pg');

// 连接池从环境变量读取（不再硬编码连接串）
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

/**
 * 赛事系统重构的数据库迁移（P0）。
 * 全部使用 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS，幂等可重复执行。
 */
const updateDatabaseStructure = async () => {
  const client = await pool.connect();
  try {
    console.log('开始更新数据库表结构（赛事系统重构 P0）...');
    await client.query('BEGIN');

    // ============ 1. players 表：新增地区 / 自我评价 / 仇人 ============
    await client.query(`ALTER TABLE public.players ADD COLUMN IF NOT EXISTS region varchar(50) NULL;`);
    await client.query(`ALTER TABLE public.players ADD COLUMN IF NOT EXISTS self_intro text NULL;`);
    await client.query(`ALTER TABLE public.players ADD COLUMN IF NOT EXISTS enemies text NULL;`);

    // ============ 2. play_score 表：打通账号 ↔ 选手 ============
    await client.query(`ALTER TABLE public.play_score ADD COLUMN IF NOT EXISTS player_id bigint NULL;`);

    // ============ 3. teams 表：队长 ============
    await client.query(`ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS captain_id bigint NULL;`);
    // teams 表：比赛名次（1=冠军，2=亚军，3=季军，以此类推，NULL=未定）
    await client.query(`ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS rank int4 NULL;`);

    // ============ 3b. team_players 表：担任位置 ============
    await client.query(`ALTER TABLE public.team_players ADD COLUMN IF NOT EXISTS position varchar(20) NULL;`);

    // ============ 4. tournaments 表：状态枚举规范化 ============
    // 历史数据全是 'planned'，映射为新枚举 'planning'
    await client.query(`
      UPDATE public.tournaments
      SET status = 'planning'
      WHERE status = 'planned' OR status IS NULL OR status = '';
    `);

    // ============ 5. 新建赛事选手快照表 ============
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.tournament_players (
        id serial4 NOT NULL,
        player_id bigint NOT NULL,
        tournament_id bigint NOT NULL,
        score int4 NULL,
        positions text NULL,
        heroes text NULL,
        region varchar(50) NULL,
        self_intro text NULL,
        enemies text NULL,
        signup_status varchar(20) DEFAULT 'approved' NULL,
        is_captain bool DEFAULT false NULL,
        signed_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
        CONSTRAINT tournament_players_pkey PRIMARY KEY (id),
        CONSTRAINT tournament_players_player_tournament_key UNIQUE (player_id, tournament_id)
      );
    `);

    // ============ 6. 新建比赛轮次表 ============
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.tournament_rounds (
        id serial4 NOT NULL,
        tournament_id bigint NOT NULL,
        name varchar(50) NULL,
        order_no int4 DEFAULT 0 NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
        CONSTRAINT tournament_rounds_pkey PRIMARY KEY (id)
      );
    `);

    // ============ 7. 新建对阵表 ============
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.matches (
        id serial4 NOT NULL,
        tournament_id bigint NOT NULL,
        round_id int4 NULL,
        team_a_id int4 NULL,
        team_b_id int4 NULL,
        team_a_score int4 NULL,
        team_b_score int4 NULL,
        winner_team_id int4 NULL,
        status varchar(20) DEFAULT 'scheduled' NULL,
        order_no int4 DEFAULT 0 NULL,
        note varchar(200) NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
        CONSTRAINT matches_pkey PRIMARY KEY (id)
      );
    `);

    await client.query('COMMIT');
    console.log('赛事系统重构 P0 表结构更新完成');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('数据库结构更新失败:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  updateDatabaseStructure,
};
