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
        "name" varchar NOT NULL,
        count int4 DEFAULT 1 NULL,
        CONSTRAINT play_score_pkey PRIMARY KEY (name)
      );
    `);
    
    // 创建赛季表 - 确保id列为SERIAL主键
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS tournaments_id_seq;
      
      CREATE TABLE IF NOT EXISTS public.tournaments (
        id integer NOT NULL DEFAULT nextval('tournaments_id_seq') PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        start_date DATE,
        end_date DATE,
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
    
    // 创建队伍表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.teams (
        id int4 NOT NULL,
        "name" varchar(50) NULL,
        tournament_id int8 NULL,
        created_at varchar(50) NULL,
        updated_at varchar(50) NULL,
        CONSTRAINT teams_pkey PRIMARY KEY (id)
      );
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
      SELECT p.*, tp.team_id, tp.tournament_id 
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
      `INSERT INTO public.players (id, nickname, game_id, group_nickname, score, positions, heroes, win_rate, championships, synergy_players, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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

// 更新选手信息
const updatePlayer = async (playerId, player) => {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE public.players 
       SET nickname = $1, game_id = $2, group_nickname = $3, score = $4, positions = $5, heroes = $6, win_rate = $7, championships = $8, synergy_players = $9, updated_at = $10
       WHERE id = $11`,
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
        player.updated_at,
        playerId
      ]
    );
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
      `INSERT INTO public.teams (id, name, tournament_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        team.id,
        team.name,
        tournamentId || null,  // 如果提供了tournamentId则使用它，否则为null
        team.created_at,
        team.updated_at
      ]
    );
    
    return result.rows[0]; // 返回创建的队伍
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

// 导出所有数据库函数
module.exports = {
  query: (text, params) => pool.query(text, params),
  initDatabase,
  getAllPlayers,
  getAllTeams,
  getPlayersInTeam,
  addPlayer,
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
  pool // 导出pool以便其他API可以使用
};