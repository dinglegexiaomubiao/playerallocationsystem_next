const { Pool } = require('pg');

// 创建数据库连接池
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 环境变量未设置，请检查 .env.local 文件');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
        "name" varchar NOT NULL,
        count int4 DEFAULT 1 NULL,
        password varchar(100) NULL,
        CONSTRAINT play_score_pkey PRIMARY KEY (name)
      );
    `);

    // 兼容旧表：如果 password 列不存在则添加
    await client.query(`
      ALTER TABLE public.play_score ADD COLUMN IF NOT EXISTS password varchar(100) NULL;
    `);
    
    // 创建赛季表 - 确保id列为SERIAL主键
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS tournaments_id_seq;
      
      CREATE TABLE IF NOT EXISTS public.tournaments (
        id integer NOT NULL DEFAULT nextval('tournaments_id_seq') PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        champion_team_id INTEGER,
        runner_up_team_id INTEGER,
        third_place_team_id INTEGER,
        sponsor_info VARCHAR(200),
        champion_prize VARCHAR(100),
        runner_up_prize VARCHAR(100),
        status VARCHAR(20) DEFAULT 'planned',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      ALTER SEQUENCE tournaments_id_seq OWNED BY public.tournaments.id;
    `);
    
    // 创建选手表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.players (
        id bigint NOT NULL,
        nickname varchar(50) NULL,
        game_id int4 NULL,
        group_nickname varchar(50) NULL,
        score int4 NULL,
        positions varchar(50) NULL,
        heroes varchar(50) NULL,
        win_rate int4 NULL,
        championships int4 NULL,
        synergy_players varchar(50) NULL,
        created_at varchar(50) NULL,
        updated_at varchar(50) NULL,
        recent_win_rate int4 NULL,
        most_played_heroes jsonb NULL,
        highest_win_rate_heroes jsonb NULL,
        CONSTRAINT players_pk PRIMARY KEY (id)
      );
    `);
    
    // 创建队伍表（使用SERIAL自增主键）
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS teams_id_seq;
      CREATE TABLE IF NOT EXISTS public.teams (
        id int4 NOT NULL DEFAULT nextval('teams_id_seq') PRIMARY KEY,
        "name" varchar(50) NULL,
        tournament_id int8 NULL,
        created_at varchar(50) NULL,
        updated_at varchar(50) NULL
      );
      ALTER SEQUENCE teams_id_seq OWNED BY public.teams.id;
    `);

    // 迁移旧表：确保 id 列有自增默认值（旧表没有 DEFAULT）
    try {
      await client.query(`
        ALTER TABLE public.teams ALTER COLUMN id SET DEFAULT nextval('teams_id_seq');
      `);
      console.log('teams表id列自增默认值迁移成功');
    } catch (err) {
      console.warn('teams表id列迁移（可能已完成）:', err.message);
    }

    // 同步序列到当前最大 id，避免自增与历史手动插入的 id 冲突
    await client.query(`
      SELECT setval('teams_id_seq', COALESCE((SELECT MAX(id) FROM public.teams), 0), true);
    `);
    
    // 创建队伍选手关系表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.team_players (
        id serial4 NOT NULL,
        team_id int4 NULL,
        player_id int8 NULL,
        tournament_id int8 NULL,
        created_at varchar(50) NULL,
        CONSTRAINT team_players_pkey PRIMARY KEY (id)
      );
    `);
    
    // 创建选手参赛记录表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.player_tournament_participations (
        id serial4 NOT NULL,
        player_id int8 NOT NULL,
        tournament_id int8 NOT NULL,
        team_id int4 NULL,
        final_rank int4 NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
        CONSTRAINT player_tournament_participations_pkey PRIMARY KEY (id)
      );
    `);
    
    // 创建赛季队伍关联表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.tournament_teams (
        id serial4 NOT NULL,
        tournament_id int8 NOT NULL,
        team_id int4 NOT NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
        CONSTRAINT tournament_teams_pkey PRIMARY KEY (id)
      );
    `);

    // 创建留言板表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.messages (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        content VARCHAR(500) NOT NULL,
        likes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('数据库表结构初始化完成');
  } catch (error) {
    console.error('数据库初始化错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 获取所有选手（支持tournament_id过滤）
const getAllPlayers = async (tournamentId = null) => {
  try {
    if (tournamentId) {
      // 如果指定了tournament_id，则获取该赛季的所有选手（包括已分配和未分配的）
      // 使用player_tournament_participations表来获取所有参与该赛季的选手
      const result = await pool.query(
        `SELECT DISTINCT p.* 
         FROM public.players p 
         JOIN public.player_tournament_participations ptp ON p.id = ptp.player_id 
         WHERE ptp.tournament_id = $1`,
        [tournamentId]
      );
      return result.rows;
    } else {
      // 否则获取所有选手
      const result = await pool.query('SELECT * FROM public.players');
      return result.rows;
    }
  } catch (error) {
    console.error('获取选手列表错误:', error);
    throw error;
  }
};

// 获取所有队伍（支持tournament_id过滤）
const getAllTeams = async (tournamentId = null) => {
  try {
    let query = 'SELECT * FROM public.teams';
    let params = [];
    
    if (tournamentId) {
      query += ' WHERE tournament_id = $1';
      params = [tournamentId];
    }
    
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('获取队伍列表错误:', error);
    throw error;
  }
};

// 获取队伍中的选手（支持tournament_id过滤）
const getPlayersInTeam = async (teamId, tournamentId = null) => {
  try {
    let query = `
      SELECT p.*, tp.team_id, tp.tournament_id, tp.position AS team_position 
      FROM public.players p 
      JOIN public.team_players tp ON p.id = tp.player_id 
      WHERE tp.team_id = $1`;
    
    let params = [teamId];
    
    // 如果提供了tournament_id，则添加到查询条件中
    if (tournamentId) {
      query += ' AND tp.tournament_id = $2';
      params.push(tournamentId);
    }
    
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('获取队伍中的选手错误:', error);
    throw error;
  }
};

// 添加选手
const addPlayer = async (player, tournamentId = null) => {
  const client = await pool.connect();
  try {
    // 生成唯一ID - 使用时间戳+随机数确保唯一性
    const playerId = player.id || Date.now().toString() + Math.floor(Math.random() * 10000).toString();
    
    // 插入选手数据
    console.log('尝试插入选手数据:', {...player, id: playerId});
    const playerResult = await client.query(
      `INSERT INTO public.players (id, nickname, game_id, group_nickname, score, positions, heroes, win_rate, championships, synergy_players, region, self_intro, enemies, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        playerId,
        player.nickname,
        player.game_id,
        player.group_nickname,
        player.score,
        Array.isArray(player.positions) ? player.positions.join(',') : 
        typeof player.positions === 'string' ? player.positions : '',
        Array.isArray(player.heroes) ? player.heroes.join(',') : 
        typeof player.heroes === 'string' ? player.heroes : '',
        player.win_rate,
        player.championships,
        Array.isArray(player.synergy_players) ? player.synergy_players.join(',') : 
        typeof player.synergy_players === 'string' ? player.synergy_players : '',
        player.region || null,
        player.self_intro || null,
        Array.isArray(player.enemies) ? player.enemies.join(',') : 
        typeof player.enemies === 'string' ? player.enemies : (player.enemies || null),
        player.created_at || new Date().toISOString().split('T')[0],
        player.updated_at || new Date().toISOString().split('T')[0]
      ]
    );
    
    // 如果提供了tournamentId，则将选手与该赛季关联
    if (tournamentId) {
      await client.query(
        `INSERT INTO public.player_tournament_participations (player_id, tournament_id, created_at)
         VALUES ($1, $2, $3)`,
        [playerId, tournamentId, new Date().toISOString()]
      );
    }
    
    console.log('选手数据插入成功');
    return playerResult.rows[0]; // 返回新创建的选手数据
  } catch (error) {
    console.error('添加选手错误详情:', error);
    console.error('选手数据:', player);
    throw new Error(`添加选手失败: ${error.message}`);
  } finally {
    client.release();
  }
};

// 根据ID获取选手
const getPlayerById = async (playerId) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM public.players WHERE id = $1',
      [playerId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('获取选手错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 更新选手
const updatePlayer = async (playerId, player) => {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE public.players 
       SET nickname = $1, game_id = $2, group_nickname = $3, score = $4, positions = $5, heroes = $6, win_rate = $7, championships = $8, synergy_players = $9, region = $10, self_intro = $11, enemies = $12, updated_at = $13
       WHERE id = $14`,
      [
        player.nickname,
        player.game_id,
        player.group_nickname,
        player.score,
        Array.isArray(player.positions) ? player.positions.join(',') : 
        typeof player.positions === 'string' ? player.positions : '',
        Array.isArray(player.heroes) ? player.heroes.join(',') : 
        typeof player.heroes === 'string' ? player.heroes : '',
        player.win_rate,
        player.championships,
        Array.isArray(player.synergy_players) ? player.synergy_players.join(',') : 
        typeof player.synergy_players === 'string' ? player.synergy_players : '',
        player.region || null,
        player.self_intro || null,
        Array.isArray(player.enemies) ? player.enemies.join(',') : 
        typeof player.enemies === 'string' ? player.enemies : (player.enemies || null),
        player.updated_at || new Date().toISOString(),
        playerId
      ]
    );
    
    // 返回更新后的选手数据
    const result = await client.query(
      'SELECT * FROM public.players WHERE id = $1',
      [playerId]
    );
    return result.rows[0];
  } catch (error) {
    console.error('更新选手错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 删除选手
const deletePlayer = async (playerId) => {
  const client = await pool.connect();
  try {
    // 先删除队伍关系
    await client.query(
      'DELETE FROM public.team_players WHERE player_id = $1',
      [playerId]
    );
    
    // 再删除选手
    await client.query(
      'DELETE FROM public.players WHERE id = $1',
      [playerId]
    );
  } catch (error) {
    console.error('删除选手错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 添加队伍
const addTeam = async (team, tournamentId = null) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO public.teams (name, tournament_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        team.name,
        tournamentId || null,
        team.created_at,
        team.updated_at
      ]
    );

    return result.rows[0];
  } catch (error) {
    console.error('添加队伍错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 更新队伍
const updateTeam = async (teamId, team) => {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE public.teams 
       SET name=$1, updated_at=$2
       WHERE id=$3`,
      [
        team.name,
        team.updated_at,
        teamId
      ]
    );
  } catch (error) {
    console.error('更新队伍错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 删除队伍
const deleteTeam = async (teamId) => {
  const client = await pool.connect();
  try {
    // 先删除队伍中的选手关系
    await client.query(
      'DELETE FROM public.team_players WHERE team_id = $1',
      [teamId]
    );
    
    // 再删除队伍
    await client.query(
      'DELETE FROM public.teams WHERE id = $1',
      [teamId]
    );
  } catch (error) {
    console.error('删除队伍错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 将选手添加到队伍
const addPlayerToTeam = async (teamId, playerId, tournamentId = null) => {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO public.team_players (team_id, player_id, tournament_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [
        teamId,
        playerId,
        tournamentId,
        new Date().toISOString()
      ]
    );
  } catch (error) {
    console.error('添加选手到队伍错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 从队伍中移除选手
const removePlayerFromTeam = async (teamId, playerId, tournamentId = null) => {
  const client = await pool.connect();
  try {
    let query = 'DELETE FROM public.team_players WHERE team_id = $1 AND player_id = $2';
    let params = [teamId, playerId];
    
    // 如果提供了tournamentId，也作为过滤条件
    if (tournamentId) {
      query += ' AND tournament_id = $3';
      params = [teamId, playerId, tournamentId];
    }
    
    await client.query(query, params);
  } catch (error) {
    console.error('从队伍中移除选手错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 清空队伍中的所有选手
const clearTeamPlayers = async (teamId) => {
  const client = await pool.connect();
  try {
    await client.query(
      'DELETE FROM public.team_players WHERE team_id = $1',
      [teamId]
    );
  } catch (error) {
    console.error('清空队伍选手错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 通用查询函数
const query = async (text, params) => {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
};

// 更新队伍中的所有选手（用于保存整个队伍配置）
const updateTeamPlayers = async (teamId, playerIds, tournamentId = null) => {
  const client = await pool.connect();
  try {
    // 先清空队伍中的所有选手
    await clearTeamPlayers(teamId);
    
    // 添加新的选手到队伍
    for (const playerId of playerIds) {
      await addPlayerToTeam(teamId, playerId, tournamentId);
    }
  } catch (error) {
    console.error('更新队伍选手错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 添加队伍到赛季
const addTeamToTournament = async (teamId, tournamentId) => {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO public.tournament_teams (tournament_id, team_id, created_at)
       VALUES ($1, $2, $3)`,
      [tournamentId, teamId, new Date().toISOString()]
    );
  } catch (error) {
    console.error('添加队伍到赛季错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 按 steamid（game_id）查找选手，用于注册时判断是否已有选手记录
const getPlayerByGameId = async (gameId) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM public.players WHERE game_id = $1',
      [gameId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('按 steamid 查询选手错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 搜索选手（昵称 / steamid 模糊匹配），用于仇人 / 默契队友选择器
const searchPlayers = async (keyword) => {
  const client = await pool.connect();
  try {
    const kw = String(keyword || '').trim();
    if (!kw) return [];
    const result = await client.query(
      `SELECT id, nickname, group_nickname, game_id, score
       FROM public.players
       WHERE nickname ILIKE $1
          OR group_nickname ILIKE $1
          OR CAST(game_id AS TEXT) LIKE $2
       ORDER BY score DESC NULLS LAST
       LIMIT 20`,
      [`%${kw}%`, `${kw}%`]
    );
    return result.rows;
  } catch (error) {
    console.error('搜索选手错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 把账号绑定到选手（注册时回填 play_score.player_id）
const bindAccountToPlayer = async (username, playerId) => {
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE public.play_score SET player_id = $1 WHERE name = $2',
      [playerId, username]
    );
  } catch (error) {
    console.error('绑定账号到选手错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 查询队伍信息（含 captain_id 与 tournament_id），用于队内管理权限判定
const getTeamInfo = async (teamId) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, name, tournament_id, captain_id, rank FROM public.teams WHERE id = $1',
      [teamId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('查询队伍信息错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 更新队员在该队的担任位置（中单/优势路等）
const updateTeamPlayerPosition = async (teamId, playerId, position) => {
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE public.team_players SET position = $3 WHERE team_id = $1 AND player_id = $2',
      [teamId, playerId, position || null]
    );
  } catch (error) {
    console.error('更新队员担任位置错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 更新队伍比赛名次（1=冠军… NULL=未定）
const updateTeamRank = async (teamId, rank) => {
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE public.teams SET rank = $2 WHERE id = $1',
      [teamId, rank === null || rank === undefined || rank === '' ? null : rank]
    );
  } catch (error) {
    console.error('更新队伍名次错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 查询某选手参加过的所有比赛（含名次、担任位置、队伍）
const getPlayerTournaments = async (playerId) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT
         t.id AS tournament_id,
         t.name AS tournament_name,
         t.status AS tournament_status,
         t.start_date,
         t.end_date,
         tm.id AS team_id,
         tm.name AS team_name,
         tm.rank AS team_rank,
         tp.position AS my_position
       FROM public.team_players tp
       JOIN public.teams tm ON tm.id = tp.team_id
       JOIN public.tournaments t ON t.id = tm.tournament_id
       WHERE tp.player_id = $1
       ORDER BY t.start_date DESC NULLS LAST, tm.rank ASC NULLS LAST`,
      [playerId]
    );
    return result.rows;
  } catch (error) {
    console.error('查询选手比赛履历错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// 查询所有选手的地区（用于「从已有中选择」）
const getDistinctRegions = async () => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT DISTINCT region FROM public.players WHERE region IS NOT NULL AND region <> '' ORDER BY region ASC`
    );
    return result.rows.map((r) => r.region);
  } catch (error) {
    console.error('查询地区列表错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

// ===== players 的 heroes / positions 放宽为 text =====
// 建表语句里是 varchar(50)，多选擅长英雄很容易超长（PG 报 22001 直接把保存打回来）。
// 这里做一次幂等迁移，跟 ensurePartyTables 一样首次用到时自动补。
let playerTextColumnsReady = false;

const ensurePlayerTextColumns = async () => {
  if (playerTextColumnsReady) return;
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE public.players ALTER COLUMN heroes TYPE text;');
    await client.query('ALTER TABLE public.players ALTER COLUMN positions TYPE text;');
    playerTextColumnsReady = true;
  } catch (error) {
    // 没有 ALTER 权限时不要让整个保存流程失败：老长度下仍可正常保存少量英雄
    console.error('放宽 players 文本字段失败（可忽略）:', error.message);
  } finally {
    client.release();
  }
};

// ===== players 的头像缓存列 =====
// Steam 头像不每次实时去拉（OpenDota 有额度），抓一次就落到这三列里当持久缓存。
// 与 ensurePlayerTextColumns 同一套「首次用到时幂等补」的做法。
let avatarColumnsReady = false;

const ensureAvatarColumns = async () => {
  if (avatarColumnsReady) return;
  const client = await pool.connect();
  try {
    await client.query('ALTER TABLE public.players ADD COLUMN IF NOT EXISTS avatar_url text;');
    await client.query('ALTER TABLE public.players ADD COLUMN IF NOT EXISTS steam_name varchar(120);');
    await client.query(
      'ALTER TABLE public.players ADD COLUMN IF NOT EXISTS avatar_synced_at timestamptz;'
    );
    avatarColumnsReady = true;
  } catch (error) {
    // 没有 ALTER 权限时不能让整个列表接口挂掉：头像退化成昵称首字即可
    console.error('新增 players 头像列失败（可忽略）:', error.message);
  } finally {
    client.release();
  }
};

// ===== 开黑组队：建表（首次请求自动执行，幂等） =====
let partyTablesReady = false;

const ensurePartyTables = async () => {
  if (partyTablesReady) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.party_posts (
        id bigserial PRIMARY KEY,
        player_id bigint NULL,
        account_name varchar(60) NULL,
        mode varchar(20) NOT NULL,
        game_id bigint NULL,
        my_score int4 NULL,
        my_rank varchar(30) NULL,
        my_positions text NULL,
        want_score_min int4 NULL,
        want_score_max int4 NULL,
        want_rank varchar(30) NULL,
        want_positions text NULL,
        play_time varchar(120) NULL,
        need_players int4 NULL,
        start_at timestamptz NULL,
        duration_min int4 NULL,
        has_voice bool DEFAULT true,
        voice_app varchar(50) NULL,
        note varchar(500) NULL,
        status varchar(20) DEFAULT 'open',
        created_at timestamp DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 老库补列：人数上限 / 精确开始时间 / 持续时长。
    // play_time 保留（历史卡片是自由文本），新卡片以 start_at + duration_min 为准。
    await client.query('ALTER TABLE public.party_posts ADD COLUMN IF NOT EXISTS need_players int4;');
    await client.query('ALTER TABLE public.party_posts ADD COLUMN IF NOT EXISTS start_at timestamptz;');
    await client.query('ALTER TABLE public.party_posts ADD COLUMN IF NOT EXISTS duration_min int4;');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.party_signups (
        id bigserial PRIMARY KEY,
        post_id bigint NOT NULL,
        player_id bigint NULL,
        account_name varchar(60) NULL,
        nickname varchar(60) NULL,
        score int4 NULL,
        rank varchar(30) NULL,
        positions text NULL,
        eta varchar(120) NULL,
        note varchar(200) NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 同一张卡片，同一个人只能报名一次
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS party_signups_post_player_uniq
        ON public.party_signups (post_id, account_name);
    `);
    partyTablesReady = true;
  } finally {
    client.release();
  }
};

// 导出所有数据库函数
module.exports = {
  query,
  initDatabase,
  ensurePartyTables,
  ensurePlayerTextColumns,
  ensureAvatarColumns,
  getAllPlayers,
  getAllTeams,
  getPlayersInTeam,
  addPlayer,
  getPlayerById,
  updatePlayer,
  deletePlayer,
  addTeam,
  updateTeam,
  deleteTeam,
  addTeamToTournament,
  addPlayerToTeam,
  removePlayerFromTeam,
  clearTeamPlayers,
  updateTeamPlayers,
  getPlayerByGameId,
  searchPlayers,
  bindAccountToPlayer,
  getTeamInfo,
  updateTeamPlayerPosition,
  updateTeamRank,
  getPlayerTournaments,
  getDistinctRegions,
  pool // 导出pool以便其他API可以使用
};