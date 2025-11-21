-- 标准SQL数据库结构检查脚本
-- 用于验证多届比赛数据管理系统的表结构和关联性

-- 1. 检查所有表是否存在及其列信息
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name IN ('tournaments', 'players', 'teams', 'team_players', 'player_tournament_participations')
ORDER BY table_name, ordinal_position;

-- 2. 检查所有表的主键约束
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
ORDER BY tc.table_name;

-- 3. 检查所有表的外键约束关系
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
ORDER BY tc.table_name;

-- 4. 检查索引信息
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public'
  AND tablename IN ('tournaments', 'players', 'teams', 'team_players', 'player_tournament_participations')
ORDER BY tablename, indexname;

-- 5. 检查特定表的数据量
SELECT 'tournaments' AS table_name, COUNT(*) AS row_count FROM tournaments
UNION ALL
SELECT 'players' AS table_name, COUNT(*) AS row_count FROM players
UNION ALL
SELECT 'teams' AS table_name, COUNT(*) AS row_count FROM teams
UNION ALL
SELECT 'team_players' AS table_name, COUNT(*) AS row_count FROM team_players
UNION ALL
SELECT 'player_tournament_participations' AS table_name, COUNT(*) AS row_count FROM player_tournament_participations;

-- 6. 检查 tournament_id 关联完整性
-- 检查 teams 表 tournament_id 关联完整性
SELECT 
    t.id AS team_id,
    t.name AS team_name,
    t.tournament_id,
    tour.name AS tournament_name
FROM teams t
LEFT JOIN tournaments tour ON t.tournament_id = tour.id
ORDER BY t.tournament_id, t.id
LIMIT 10;

-- 检查 team_players 表 tournament_id 关联完整性
SELECT 
    tp.id AS relation_id,
    tp.team_id,
    tp.player_id,
    tp.tournament_id,
    tour.name AS tournament_name
FROM team_players tp
LEFT JOIN tournaments tour ON tp.tournament_id = tour.id
ORDER BY tp.tournament_id, tp.team_id
LIMIT 10;

-- 检查 player_tournament_participations 表关联完整性
SELECT 
    ptp.id AS participation_id,
    ptp.player_id,
    ptp.tournament_id,
    ptp.team_id,
    ptp.final_rank,
    tour.name AS tournament_name,
    p.nickname AS player_name
FROM player_tournament_participations ptp
LEFT JOIN tournaments tour ON ptp.tournament_id = tour.id
LEFT JOIN players p ON ptp.player_id = p.id
ORDER BY ptp.tournament_id, ptp.final_rank
LIMIT 10;