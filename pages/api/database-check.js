// Next.js API route for database structure checking
import { Pool } from 'pg';

// 创建数据库连接池
const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_Nt7YOz4wIJcT@ep-withered-recipe-a1wny5so-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const client = await pool.connect();
  
  try {
    // 用于存储所有检查结果的对象
    const checkResults = {};

    // 1. 检查所有表的列信息
    const columnsQuery = `
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND table_name IN ('tournaments', 'players', 'teams', 'team_players', 'player_tournament_participations')
      ORDER BY table_name, ordinal_position
    `;
    const columnsResult = await client.query(columnsQuery);
    checkResults.columns = columnsResult.rows;

    // 2. 检查所有表的主键约束
    const primaryKeyQuery = `
      SELECT 
        tc.table_name,
        tc.constraint_name,
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name IN ('tournaments', 'players', 'teams', 'team_players', 'player_tournament_participations')
      ORDER BY tc.table_name
    `;
    const primaryKeyResult = await client.query(primaryKeyQuery);
    checkResults.primaryKeys = primaryKeyResult.rows;

    // 3. 检查所有表的外键约束关系
    const foreignKeyQuery = `
      SELECT 
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu 
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name IN ('tournaments', 'players', 'teams', 'team_players', 'player_tournament_participations')
      ORDER BY tc.table_name
    `;
    const foreignKeyResult = await client.query(foreignKeyQuery);
    checkResults.foreignKeys = foreignKeyResult.rows;

    // 4. 检查索引信息
    const indexQuery = `
      SELECT 
        tablename,
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE schemaname = 'public'
        AND tablename IN ('tournaments', 'players', 'teams', 'team_players', 'player_tournament_participations')
      ORDER BY tablename, indexname
    `;
    const indexResult = await client.query(indexQuery);
    checkResults.indexes = indexResult.rows;

    // 5. 检查特定表的数据量
    const dataCountQuery = `
      SELECT 'tournaments' AS table_name, COUNT(*) AS row_count FROM tournaments
      UNION ALL
      SELECT 'players' AS table_name, COUNT(*) AS row_count FROM players
      UNION ALL
      SELECT 'teams' AS table_name, COUNT(*) AS row_count FROM teams
      UNION ALL
      SELECT 'team_players' AS table_name, COUNT(*) AS row_count FROM team_players
      UNION ALL
      SELECT 'player_tournament_participations' AS table_name, COUNT(*) AS row_count FROM player_tournament_participations
    `;
    const dataCountResult = await client.query(dataCountQuery);
    checkResults.dataCounts = dataCountResult.rows;

    // 6. 检查 tournament_id 关联完整性 - teams 表
    const teamsTournamentCheckQuery = `
      SELECT 
        t.id AS team_id,
        t.name AS team_name,
        t.tournament_id,
        tour.name AS tournament_name
      FROM teams t
      LEFT JOIN tournaments tour ON t.tournament_id::integer = tour.id
      ORDER BY t.tournament_id, t.id
      LIMIT 10
    `;
    const teamsTournamentCheckResult = await client.query(teamsTournamentCheckQuery);
    checkResults.teamsTournamentCheck = teamsTournamentCheckResult.rows;

    // 7. 检查 tournament_id 关联完整性 - team_players 表
    const teamPlayersTournamentCheckQuery = `
      SELECT 
        tp.id AS relation_id,
        tp.team_id,
        tp.player_id,
        tp.tournament_id,
        tour.name AS tournament_name
      FROM team_players tp
      LEFT JOIN tournaments tour ON tp.tournament_id::integer = tour.id
      ORDER BY tp.tournament_id, tp.team_id
      LIMIT 10
    `;
    const teamPlayersTournamentCheckResult = await client.query(teamPlayersTournamentCheckQuery);
    checkResults.teamPlayersTournamentCheck = teamPlayersTournamentCheckResult.rows;

    // 8. 检查 player_tournament_participations 表关联完整性
    const participationsCheckQuery = `
      SELECT 
        ptp.id AS participation_id,
        ptp.player_id,
        ptp.tournament_id,
        ptp.team_id,
        ptp.final_rank,
        tour.name AS tournament_name,
        p.nickname AS player_name
      FROM player_tournament_participations ptp
      LEFT JOIN tournaments tour ON ptp.tournament_id::integer = tour.id
      LEFT JOIN players p ON ptp.player_id::integer = p.id
      ORDER BY ptp.tournament_id, ptp.final_rank
      LIMIT 10
    `;
    const participationsCheckResult = await client.query(participationsCheckQuery);
    checkResults.participationsCheck = participationsCheckResult.rows;

    // 返回检查结果
    res.status(200).json({
      success: true,
      message: 'Database structure check completed',
      data: checkResults
    });
  } catch (error) {
    console.error('Database structure check error:', error);
    res.status(500).json({
      success: false,
      error: 'Database structure check failed',
      message: error.message
    });
  } finally {
    client.release();
  }
}