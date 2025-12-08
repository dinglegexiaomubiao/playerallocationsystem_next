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
        count INTEGER DEFAULT 1
      );
    `);
    
    // 创建选手表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.players (
        id bigint PRIMARY KEY,
        nickname varchar(50) NULL,
        game_id bigint NULL,
        group_nickname varchar(50) NULL,
        score integer NULL,
        positions text NULL,
        heroes text NULL,
        win_rate integer NULL,
        championships integer NULL,
        synergy_players text NULL,
        created_at varchar(50) NULL,
        updated_at varchar(50) NULL
      );
    `);
    
    // 创建队伍表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.teams (
        id integer PRIMARY KEY,
        "name" varchar(50) NULL,
        created_at varchar(50) NULL,
        updated_at varchar(50) NULL
      );
    `);
    
    // 创建队伍选手关系表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.team_players (
        id serial PRIMARY KEY,
        team_id integer NULL,
        player_id bigint NULL,
        created_at varchar(50) NULL
      );
    `);
    
    // 创建留言板消息表
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.messages (
        id serial NOT NULL,
        username varchar(50) NOT NULL,
        "content" text NOT NULL,
        likes int4 DEFAULT 0 NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP NULL,
        CONSTRAINT messages_pkey PRIMARY KEY (id)
      );
    `);
  } catch (error) {
    console.error('数据库初始化错误:', error);
  } finally {
    client.release();
  }
};

// 获取所有选手（支持tournament_id过滤）
const getAllPlayers = async (tournamentId = null) => {
  try {
    if (tournamentId) {
      // 如果指定了tournament_id，则只获取该赛季的选手
      const result = await pool.query(
        `SELECT DISTINCT p.* 
         FROM public.players p 
         JOIN public.team_players tp ON p.id = tp.player_id 
         WHERE tp.tournament_id = $1`,
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
const addPlayer = async (player) => {
  const client = await pool.connect();
  try {
    // 插入选手数据
    console.log('尝试插入选手数据:', player);
    await client.query(
      `INSERT INTO public.players (id, nickname, game_id, group_nickname, score, positions, heroes, win_rate, championships, synergy_players, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        player.id,
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
        player.created_at,
        player.updated_at
      ]
    );
    console.log('选手数据插入成功');
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
const addTeam = async (team) => {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO public.teams (id, name, created_at, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [
        team.id,
        team.name,
        team.created_at,
        team.updated_at
      ]
    );
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
const addPlayerToTeam = async (teamId, playerId) => {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO public.team_players (team_id, player_id, created_at)
       VALUES ($1, $2, $3)`,
      [
        teamId,
        playerId,
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
const removePlayerFromTeam = async (teamId, playerId) => {
  const client = await pool.connect();
  try {
    await client.query(
      'DELETE FROM public.team_players WHERE team_id = $1 AND player_id = $2',
      [teamId, playerId]
    );
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
const updateTeamPlayers = async (teamId, playerIds) => {
  const client = await pool.connect();
  try {
    // 先清空队伍中的所有选手
    await clearTeamPlayers(teamId);
    
    // 添加新的选手到队伍
    for (const playerId of playerIds) {
      await addPlayerToTeam(teamId, playerId);
    }
  } catch (error) {
    console.error('更新队伍选手错误:', error);
    throw error;
  } finally {
    client.release();
  }
};

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
  addPlayerToTeam,
  removePlayerFromTeam,
  clearTeamPlayers,
  updateTeamPlayers,
  pool // 导出pool以便其他API可以使用
};