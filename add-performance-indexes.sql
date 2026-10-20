-- ============================================================
-- 性能索引：补齐高频查询路径上缺失的索引
--
-- 怎么执行：
--   方式一  Neon 控制台 → SQL Editor → 整段粘贴执行（推荐，最省事）
--   方式二  psql "$DATABASE_URL" -f add-performance-indexes.sql
--
-- 说明：
--   * 全部 IF NOT EXISTS，可重复执行，不会报错也不会重建。
--   * 这几张表是「读多写极少」（写入只发生在管理后台操作时），
--     所以索引带来的写开销可以忽略。
--   * 诚实提示：当前 players 只有 66 行、teams 十几行，
--     这些索引本身不会让你「感觉变快」—— 全表扫描本来也就是几毫秒。
--     真正的大头是函数与数据库的跨区域往返，见项目根目录 vercel.json。
--     索引的意义是把「数据量长大以后」的退化提前按住。
-- ============================================================

-- ---------- team_players：选手 ↔ 队伍关联，几乎每个页面都要 JOIN ----------
-- /api/players 用 player_id 反查某人参加过哪些队
CREATE INDEX IF NOT EXISTS team_players_player_idx
  ON public.team_players (player_id);

-- 查某队成员（队伍卡片、队内管理）
CREATE INDEX IF NOT EXISTS team_players_team_idx
  ON public.team_players (team_id);

-- 按赛事过滤成员（赛事详情页）
CREATE INDEX IF NOT EXISTS team_players_tournament_idx
  ON public.team_players (tournament_id);

-- ---------- teams ----------
-- 列某届赛事的全部队伍（赛事详情、后台、导入脚本）
CREATE INDEX IF NOT EXISTS teams_tournament_idx
  ON public.teams (tournament_id);

-- 队长查询只扫有队长的行：用部分索引，比全列索引更小更快
CREATE INDEX IF NOT EXISTS teams_captain_idx
  ON public.teams (captain_id)
  WHERE captain_id IS NOT NULL;

-- ---------- tournaments ----------
-- 首页要挑「进行中」的那届
CREATE INDEX IF NOT EXISTS tournaments_status_idx
  ON public.tournaments (status);

-- 赛事列表按开赛时间展示
CREATE INDEX IF NOT EXISTS tournaments_start_date_idx
  ON public.tournaments (start_date DESC NULLS LAST);

-- ---------- player_tournament_participations ----------
-- getAllPlayers(tournament_id) 走的就是这条
CREATE INDEX IF NOT EXISTS ptp_tournament_idx
  ON public.player_tournament_participations (tournament_id);

CREATE INDEX IF NOT EXISTS ptp_player_idx
  ON public.player_tournament_participations (player_id);

-- ---------- players ----------
-- 按 SteamID 查人（注册查重、绑定、导入脚本）
CREATE INDEX IF NOT EXISTS players_game_id_idx
  ON public.players (game_id);

-- 首页天梯榜、群友页默认排序
CREATE INDEX IF NOT EXISTS players_score_idx
  ON public.players (score DESC NULLS LAST);

-- ---------- 开黑组队 ----------
-- 列表按「招募中优先 + 时间倒序」
CREATE INDEX IF NOT EXISTS party_posts_status_created_idx
  ON public.party_posts (status, created_at DESC);

-- 「我发的卡片」计数
CREATE INDEX IF NOT EXISTS party_posts_player_idx
  ON public.party_posts (player_id);

-- party_signups 已有唯一索引 (post_id, account_name)，其最左前缀 post_id
-- 足以支撑「按卡片查报名」，这里不再重复建。

-- ---------- 美食 ----------
-- 删除某店时连带删评价 / 按店查评价
CREATE INDEX IF NOT EXISTS food_reviews_food_idx
  ON public.food_reviews (food_id);

-- ---------- 留言板 ----------
CREATE INDEX IF NOT EXISTS messages_created_idx
  ON public.messages (created_at DESC);

-- ============================================================
-- 执行完可以用这句确认索引已生效（可选）：
--   SELECT tablename, indexname FROM pg_indexes
--    WHERE schemaname = 'public'
--    ORDER BY tablename, indexname;
-- ============================================================
