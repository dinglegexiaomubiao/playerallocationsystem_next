const { Pool } = require('pg');
// 身份（多 SteamID / 多群昵称）统一读写层。本文件是 CommonJS，这里 require 一个 ESM 模块，
// webpack 会做 interop（命名导出可直接取）。该模块刻意不反向 require 本文件，避免循环依赖。
const {
  ensureIdentityTables,
  replaceIdentities,
  listIdentities,
  syncPrimary,
  playerIdBySteamId,
} = require('./player-identity');

// 创建数据库连接池
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 环境变量未设置，请检查 .env.local 文件');
}

// SSL 开关
// Neon 等云托管库强制要求 SSL；阿里云 RDS 走内网时通常不开 SSL，
// 此时传 ssl: true 会直接连接失败。用 DATABASE_SSL=off 关闭；
// 不设置则保持原有行为（启用但不校验证书），确保老部署无需改动。
const useSsl = String(process.env.DATABASE_SSL || '').toLowerCase() !== 'off';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
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
      SELECT p.*, tp.team_id, tp.tournament_id, tp.position AS team_position,
             tpl.score    AS signup_score,
             tpl.positions AS signup_positions
      FROM public.players p 
      JOIN public.team_players tp ON p.id = tp.player_id 
      LEFT JOIN public.tournament_players tpl
             ON tpl.player_id = p.id AND tpl.tournament_id = tp.tournament_id
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
    
    // 身份（SteamID / 群昵称）：新版调用方直接给数组，老调用方只有单值，两种都接受
    await ensureIdentityTables(client);
    {
      const steamIds = Array.isArray(player.steamIds)
        ? player.steamIds
        : player.game_id
          ? [String(player.game_id)]
          : [];
      const nicknames = Array.isArray(player.groupNicknames)
        ? player.groupNicknames
        : player.group_nickname
          ? [String(player.group_nickname)]
          : [];
      if (steamIds.length > 0 || nicknames.length > 0) {
        await replaceIdentities(client, playerId, {
          steamIds,
          nicknames,
          source: player.identitySource || 'admin',
        });
      }
    }

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
    // 身份冲突（SteamID 被别人占了）是「用户可修正」的错误，保留原始信息与 code，
    // 不要裹成「添加选手失败: xxx」，否则前端只能弹一句没有指导意义的话。
    if (error && error.name === 'IdentityError') throw error;
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
    await ensureIdentityTables(client);

    // 身份（SteamID / 群昵称）是「一或多」的关系，存在子表里，players 上那两个字段只是主号缓存。
    // 这里分两种情况：
    //   1. 调用方传了 steamIds / groupNicknames 数组 → 按数组整体覆盖（后台编辑、自助编辑走这条）
    //   2. 只传了单个 game_id / group_nickname（Excel 导入等老调用）→ 只在这个人还没有任何身份时补一条，
    //      绝不覆盖已有的副号，否则导入一次就会把用户自己加的号删掉。
    const hasArrays =
      Array.isArray(player.steamIds) || Array.isArray(player.groupNicknames);

    if (hasArrays) {
      await replaceIdentities(client, playerId, {
        steamIds: player.steamIds,
        nicknames: player.groupNicknames,
        source: player.identitySource || 'admin',
        requirePrimary: !!player.identityRequirePrimary,
      });
    } else {
      const cur = await listIdentities(client, playerId);
      const seedAccounts = [];
      const seedNicks = [];
      if (cur.steam.length === 0 && player.game_id) seedAccounts.push(String(player.game_id));
      if (cur.nicknames.length === 0 && player.group_nickname) seedNicks.push(String(player.group_nickname));
      if (seedAccounts.length > 0 || seedNicks.length > 0) {
        await replaceIdentities(client, playerId, {
          steamIds: seedAccounts.length > 0 ? seedAccounts : cur.steam.map((s) => s.accountId),
          nicknames: seedNicks.length > 0 ? seedNicks : cur.nicknames.map((n) => n.nickname),
          source: 'legacy',
        });
      }
    }

    // peak_score 是后加的字段。这里是全量 UPDATE，如果直接写进 SET，
    // 那些不传它的调用处（/api/players、后台编辑）会把它刷成 NULL。
    // 所以用「对象里显式带了这个 key 才更新」的语义，既兼容老调用
    // 又允许传 null 主动清空。
    const hasPeak = Object.prototype.hasOwnProperty.call(player, 'peak_score');
    await client.query(
      `UPDATE public.players 
       SET nickname = $1, game_id = $2, group_nickname = $3, score = $4, positions = $5, heroes = $6, win_rate = $7, championships = $8, synergy_players = $9, region = $10, self_intro = $11, enemies = $12, updated_at = $13,
           peak_score = CASE WHEN $15::boolean THEN $16::int ELSE peak_score END
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
        playerId,
        hasPeak,
        hasPeak ? (player.peak_score === '' || player.peak_score === undefined ? null : player.peak_score) : null,
      ]
    );

    // 上面这条 UPDATE 会把 game_id / group_nickname 写成调用方传的值（可能是旧的单值），
    // 再按子表主号回写一次，保证「主号缓存」永远等于子表里的主号。
    await syncPrimary(client, playerId);
    
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
    // 先删身份子表：SteamID 有全局唯一索引，不清理会导致这个号以后再也登记给不了别人
    await ensureIdentityTables(client);
    await client.query('DELETE FROM public.player_steam_accounts WHERE player_id = $1', [playerId]);
    await client.query('DELETE FROM public.player_group_nicknames WHERE player_id = $1', [playerId]);

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
// 注意：查的是**全部** SteamID（主号 + 副号），否则副号注册/报名会认不出本人
const getPlayerByGameId = async (gameId) => {
  const client = await pool.connect();
  try {
    await ensureIdentityTables(client);
    const pid = await playerIdBySteamId(client, gameId);
    if (!pid) return null;
    const result = await client.query('SELECT * FROM public.players WHERE id = $1', [pid]);
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
    // 主号/副号、主群昵称/备用群昵称都要能被搜到，否则给某人记录了副号也白记
    const result = await client.query(
      `SELECT DISTINCT p.id, p.nickname, p.group_nickname, p.game_id, p.score
         FROM public.players p
         LEFT JOIN public.player_steam_accounts s ON s.player_id = p.id
         LEFT JOIN public.player_group_nicknames n ON n.player_id = p.id
        WHERE p.nickname ILIKE $1
           OR p.group_nickname ILIKE $1
           OR n.nickname ILIKE $1
           OR CAST(p.game_id AS TEXT) LIKE $2
           OR CAST(s.account_id AS TEXT) LIKE $2
        ORDER BY p.score DESC NULLS LAST
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

// ===== play_score 的重置密码标记 =====
// 管理员重置密码后置 must_change_password=true，强制本人登录后先改密码。
// 另外两列只做审计（谁在什么时候重置过），不参与鉴权。
let passwordResetColumnsReady = false;

const ensurePasswordResetColumns = async () => {
  if (passwordResetColumnsReady) return;
  const client = await pool.connect();
  try {
    await client.query(
      'ALTER TABLE public.play_score ADD COLUMN IF NOT EXISTS must_change_password bool DEFAULT false;'
    );
    await client.query(
      'ALTER TABLE public.play_score ADD COLUMN IF NOT EXISTS password_reset_at timestamptz;'
    );
    await client.query(
      'ALTER TABLE public.play_score ADD COLUMN IF NOT EXISTS password_reset_by varchar(60);'
    );
    passwordResetColumnsReady = true;
  } catch (error) {
    console.error('补 play_score 重置密码列失败:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

// ===== play_score 的改名审计列 =====
// 用户名（登录账号）写错时管理员可在后台改。改的是主键值，必须留痕：
// 谁改的、什么时候、改成什么之前的名字。否则事后无法判断「landizhong 和 lanzihong 是不是一个人」。
// 同样只做审计，不参与鉴权。
let accountRenameColumnsReady = false;

const ensureAccountRenameColumns = async () => {
  if (accountRenameColumnsReady) return;
  const client = await pool.connect();
  try {
    await client.query(
      'ALTER TABLE public.play_score ADD COLUMN IF NOT EXISTS previous_name varchar(40);'
    );
    await client.query(
      'ALTER TABLE public.play_score ADD COLUMN IF NOT EXISTS name_changed_at timestamptz;'
    );
    await client.query(
      'ALTER TABLE public.play_score ADD COLUMN IF NOT EXISTS name_changed_by varchar(60);'
    );
    accountRenameColumnsReady = true;
  } catch (error) {
    console.error('补 play_score 改名审计列失败:', error.message);
    throw error;
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

// ===== 售后 / 反馈表：建表（首次请求自动执行，幂等） =====
//
// 用途有两个：
//   1. 自动收集前端「加载失败 / 超时 / 白屏没数据」等异常
//   2. 收集用户主动提交的问题与功能建议（右下角浮窗）
//
// 敏感度控制：只存排查必需的信息（报错文本、页面地址、账号、浏览器、IP），
// 不存密码、cookie、请求体。读取接口只对管理员开放。
let supportTableReady = false;

const ensureSupportTable = async () => {
  if (supportTableReady) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.support_reports (
        id bigserial PRIMARY KEY,
        kind varchar(20) NOT NULL DEFAULT 'feedback',
        category varchar(30) NULL,
        message text NULL,
        detail jsonb NULL,
        page_url text NULL,
        account_name varchar(60) NULL,
        is_admin bool DEFAULT false,
        user_agent text NULL,
        platform varchar(120) NULL,
        ip varchar(64) NULL,
        contact varchar(120) NULL,
        status varchar(20) DEFAULT 'new',
        notified_at timestamptz NULL,
        notify_error text NULL,
        created_at timestamptz DEFAULT now()
      );
    `);
    // 老库补列（幂等）：
    //   client_token —— 未登录访客的「这台设备」标识，让他也能看到自己提的反馈。
    //                   IP 不可靠（运营商 NAT / 切基站就变），账号又没有，只能靠前端
    //                   在 localStorage 里存一个随机串，提交和查询时都带上。
    //   reply        —— 管理员给用户的留言，用户在反馈浮窗里能看到。
    await client.query('ALTER TABLE public.support_reports ADD COLUMN IF NOT EXISTS client_token varchar(64);');
    await client.query('ALTER TABLE public.support_reports ADD COLUMN IF NOT EXISTS reply text;');
    await client.query('ALTER TABLE public.support_reports ADD COLUMN IF NOT EXISTS replied_at timestamptz;');
    await client.query('ALTER TABLE public.support_reports ADD COLUMN IF NOT EXISTS replied_by varchar(60);');

    // 常用查询维度：按类型/状态/时间翻工单
    await client.query(
      `CREATE INDEX IF NOT EXISTS support_reports_created_idx ON public.support_reports (created_at DESC);`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS support_reports_kind_idx ON public.support_reports (kind, status);`
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS support_reports_dedupe_idx ON public.support_reports (kind, ip, category, created_at DESC);`
    );
    // 「我的反馈」查询：按设备串或账号捞出最近若干条
    await client.query(
      `CREATE INDEX IF NOT EXISTS support_reports_token_idx ON public.support_reports (client_token, created_at DESC);`
    );
    supportTableReady = true;
  } finally {
    client.release();
  }
};

const clipText = (v, n) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, n) : null;
};

const insertSupportReport = async (row = {}) => {
  await ensureSupportTable();
  const r = await pool.query(
    `INSERT INTO public.support_reports
       (kind, category, message, detail, page_url, account_name, is_admin,
        user_agent, platform, ip, contact, status, client_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'new',$12)
     RETURNING id, created_at`,
    [
      row.kind === 'error' ? 'error' : 'feedback',
      clipText(row.category, 30),
      clipText(row.message, 4000),
      row.detail === undefined || row.detail === null ? null : JSON.stringify(row.detail).slice(0, 8000),
      clipText(row.page_url, 1000),
      clipText(row.account_name, 60),
      row.is_admin === true,
      clipText(row.user_agent, 500),
      clipText(row.platform, 120),
      clipText(row.ip, 64),
      clipText(row.contact, 120),
      clipText(row.client_token, 64),
    ]
  );
  return { id: String(r.rows[0].id), created_at: r.rows[0].created_at };
};

// 同一来源在短时间内重复报**同一个错误**时不再入库。
// 去重键必须带上错误内容：只按 (ip, 分类) 去重的话，同一台机器上
// 出现 3 个不同报错后，后续 10 分钟内该类错误会被全部丢掉，等于瞎了。
const countRecentSimilarReports = async ({
  kind,
  ip,
  category,
  message = '',
  withinMinutes = 10,
}) => {
  await ensureSupportTable();
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM public.support_reports
      WHERE kind = $1
        AND coalesce(ip,'') = coalesce($2,'')
        AND coalesce(category,'') = coalesce($3,'')
        AND left(coalesce(message,''), 120) = left(coalesce($4,''), 120)
        AND created_at > now() - ($5 || ' minutes')::interval`,
    [kind, ip, category, String(message || ''), String(withinMinutes)]
  );
  return r.rows[0].n;
};

const listSupportReports = async ({ kind, status, limit = 100, offset = 0 } = {}) => {
  await ensureSupportTable();
  const where = [];
  const params = [];
  if (kind) {
    params.push(kind);
    where.push(`kind = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  params.push(Math.min(Number(limit) || 100, 300));
  const limIdx = params.length;
  params.push(Math.max(Number(offset) || 0, 0));
  const offIdx = params.length;

  const r = await pool.query(
    `SELECT id, kind, category, message, detail, page_url, account_name, is_admin,
            user_agent, platform, ip, contact, status, reply, replied_at, replied_by,
            notified_at, notify_error, created_at
       FROM public.support_reports
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC
      LIMIT $${limIdx} OFFSET $${offIdx}`,
    params
  );
  const total = await pool.query(
    `SELECT count(*)::int AS n FROM public.support_reports
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
    params.slice(0, params.length - 2)
  );
  return {
    reports: r.rows.map((x) => ({ ...x, id: String(x.id) })),
    total: total.rows[0].n,
  };
};

const updateSupportReport = async (id, patch = {}) => {
  await ensureSupportTable();
  const fields = [];
  const params = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);

  if (has('status') && patch.status) {
    params.push(clipText(patch.status, 20));
    fields.push(`status = $${params.length}`);
  }
  if (has('notified_at')) {
    params.push(patch.notified_at);
    fields.push(`notified_at = $${params.length}`);
  }
  if (has('notify_error')) {
    params.push(clipText(patch.notify_error, 1000));
    fields.push(`notify_error = $${params.length}`);
  }
  // 管理员留言：写内容的同时落「谁、什么时候」，方便用户端显示署名与时间。
  // 传空串 = 撤回留言，把三个字段一起清掉，避免留下「有回复时间却没内容」的脏状态。
  if (has('reply')) {
    const text = clipText(patch.reply, 2000);
    params.push(text);
    fields.push(`reply = $${params.length}`);
    if (text) {
      params.push(new Date().toISOString());
      fields.push(`replied_at = $${params.length}`);
      params.push(clipText(patch.replied_by, 60));
      fields.push(`replied_by = $${params.length}`);
    } else {
      fields.push('replied_at = NULL', 'replied_by = NULL');
    }
  }
  if (!fields.length) return false;
  params.push(id);
  const r = await pool.query(
    `UPDATE public.support_reports SET ${fields.join(', ')} WHERE id = $${params.length}`,
    params
  );
  return r.rowCount > 0;
};

/**
 * 「我的反馈」：用户端浮窗里看到的那份列表。
 *
 * 归属判定两条路并集：
 *   1. 登录用户按 account_name 认（换设备也能看到）
 *   2. 未登录访客按 client_token 认（同一浏览器）
 * 只返回展示必需的字段 —— ip / detail / notify_error 这类排查信息留在后台，
 * 不给普通用户看（尤其 detail 里可能带接口地址与堆栈）。
 */
const listMySupportReports = async ({ account, token, limit = 30 } = {}) => {
  await ensureSupportTable();
  const acct = clipText(account, 60);
  const tk = clipText(token, 64);
  if (!acct && !tk) return [];

  const r = await pool.query(
    `SELECT id, kind, category, message, status, reply, replied_at, replied_by, created_at
       FROM public.support_reports
      WHERE kind = 'feedback'
        AND ( ($1::text IS NOT NULL AND account_name = $1)
              OR ($2::text IS NOT NULL AND client_token = $2) )
      ORDER BY created_at DESC
      LIMIT $3`,
    [acct, tk, Math.min(Number(limit) || 30, 100)]
  );
  return r.rows.map((x) => ({ ...x, id: String(x.id) }));
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
        title varchar(80) NULL,
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
    // 卡片名称：不填则用「昵称喊你来开黑了」兜底。老卡片为 NULL，读的时候再兜底一次。
    await client.query('ALTER TABLE public.party_posts ADD COLUMN IF NOT EXISTS title varchar(80);');
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

// ===== 活动招募：建表（首次请求自动执行，幂等） =====
// 与开黑同源：登录即可发，不要求绑定选手资料（约饭爬山打球钓鱼不需要段位）。
// 字段上砍掉 Dota 专有项（SteamID / 段位 / 位置 / 语音），换成活动通用项：
//   type（约饭/爬山/打球/钓鱼/其他）、region（国省市区，来自 RegionPicker）、
//   location（具体集合地点）、meet_at（集合时间）、cost（费用方式）。
// 报名侧多一个 guests（携伴人数），其余与开黑一致。
let activityTablesReady = false;

const ensureActivityTables = async () => {
  if (activityTablesReady) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.activity_posts (
        id bigserial PRIMARY KEY,
        player_id bigint NULL,
        account_name varchar(60) NULL,
        title varchar(80) NULL,
        type varchar(20) NOT NULL,
        region varchar(50) NULL,
        location varchar(160) NULL,
        meet_at timestamptz NULL,
        duration_min int4 NULL,
        need_people int4 NULL,
        cost varchar(40) NULL,
        note varchar(500) NULL,
        status varchar(20) DEFAULT 'open',
        created_at timestamp DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 老库补列兜底：具体地点 / 持续时长 / 费用 / 名称都是后来加的字段。
    // region 在创建时走 RegionPicker 必填，但老库新建时也可能为空，故一并补齐。
    await client.query('ALTER TABLE public.activity_posts ADD COLUMN IF NOT EXISTS region varchar(50);');
    await client.query('ALTER TABLE public.activity_posts ADD COLUMN IF NOT EXISTS location varchar(160);');
    await client.query('ALTER TABLE public.activity_posts ADD COLUMN IF NOT EXISTS duration_min int4;');
    await client.query('ALTER TABLE public.activity_posts ADD COLUMN IF NOT EXISTS cost varchar(40);');
    await client.query('ALTER TABLE public.activity_posts ADD COLUMN IF NOT EXISTS title varchar(80);');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.activity_signups (
        id bigserial PRIMARY KEY,
        post_id bigint NOT NULL,
        player_id bigint NULL,
        account_name varchar(60) NULL,
        nickname varchar(60) NULL,
        guests int4 DEFAULT 0,
        note varchar(200) NULL,
        created_at timestamp DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // 同一场活动，同一个人只能报名一次（可带多名携伴，但只算一条报名）
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS activity_signups_post_player_uniq
        ON public.activity_signups (post_id, account_name);
    `);
    activityTablesReady = true;
  } finally {
    client.release();
  }
};

// ===== 访问埋点：page_views =====
//
// 为什么需要它：Nginx 日志只有 IP 和路径，答不出「谁」看了什么。
// 这个站是登录制，登录态里有账号名，所以每条浏览都能落到具体的人头上。
//
// 写入策略：前端只在页面切换时上报一次，后端按 IP 限流，
// 目的是拿到「活跃度画像」，不是做精确的 PV 统计（那交给 GoAccess）。
let pageViewTableReady = false;

const ensurePageViewTable = async () => {
  if (pageViewTableReady) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.page_views (
        id bigserial PRIMARY KEY,
        account_name varchar(60) NULL,
        path varchar(200) NOT NULL,
        referer varchar(500) NULL,
        ua varchar(300) NULL,
        ip varchar(64) NULL,
        created_at timestamptz DEFAULT now()
      );
    `);
    // 查询维度：按时间翻最近记录、按人看活跃、按页面看热度
    await client.query(
      'CREATE INDEX IF NOT EXISTS page_views_created_idx ON public.page_views (created_at DESC);'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS page_views_account_idx ON public.page_views (account_name, created_at DESC);'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS page_views_path_idx ON public.page_views (path);'
    );
    pageViewTableReady = true;
  } catch (error) {
    // 建表失败不能让上报流程抛错，前端埋点本来就是尽力而为
    console.error('创建 page_views 失败（可忽略）:', error.message);
  } finally {
    client.release();
  }
};

const insertPageView = async (row = {}) => {
  await ensurePageViewTable();
  await pool.query(
    `INSERT INTO public.page_views (account_name, path, referer, ua, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      clipText(row.account_name, 60),
      clipText(row.path, 200) || '/',
      clipText(row.referer, 500),
      clipText(row.ua, 300),
      clipText(row.ip, 64),
    ]
  );
};

// ===== 赛事名次表 + 选手历史最高分列 =====
//
// 新版本把「一届可并列多个冠军/亚军/季军」建模成 tournament_placements
// （一行一个名次），并把天梯历史最高分拆成独立列 players.peak_score。
// 这两项是新版赛事详情/列表/报名/档案的硬依赖，但旧库没有，老迁移脚本
// 也没覆盖。这里用「首次用到时幂等补」的做法（与 ensurePartyTables 一致），
// 让新版本在干净库上也能直接跑起来。
let tournamentSchemaReady = false;

const ensureTournamentSchema = async () => {
  if (tournamentSchemaReady) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.tournament_placements (
        id            serial PRIMARY KEY,
        tournament_id bigint   NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
        team_id       bigint   NOT NULL REFERENCES public.teams(id)       ON DELETE CASCADE,
        place         smallint NOT NULL,          -- 1 冠军 / 2 亚军 / 3 季军
        note          varchar(60),                -- 「B 组决赛冠军」这类说明
        created_at    timestamptz DEFAULT now(),
        UNIQUE (tournament_id, team_id, place)
      );
    `);
    await client.query(
      'ALTER TABLE public.players ADD COLUMN IF NOT EXISTS peak_score int4;'
    );
    // 赛后数据明细表：赛程/对阵接口用 LEFT JOIN 读取，缺失会直接 500。
    // 这两个表由 fetch-dota-matches.js 填充，这里只保证结构存在（空表即可）。
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.dota_matches (
        match_id       bigint PRIMARY KEY,
        tournament_id  bigint NOT NULL,
        round_id       bigint,
        game_no        int,
        radiant_win    boolean,
        duration       int,
        start_time     timestamptz,
        radiant_name   varchar(80),
        dire_name      varchar(80),
        team_a_id      bigint,
        team_b_id      bigint,
        winner_team_id bigint,
        radiant_score  int,
        dire_score     int,
        raw            jsonb,
        fetched_at     timestamptz DEFAULT now()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.dota_match_players (
        match_id    bigint NOT NULL,
        account_id  bigint NOT NULL,
        player_id   bigint,
        hero_id     int,
        is_radiant  boolean,
        kills int, deaths int, assists int,
        net_worth int, gpm int, xpm int,
        last_hits int, hero_damage int,
        is_standin  boolean DEFAULT false,
        PRIMARY KEY (match_id, account_id)
      );
    `);
    await client.query('ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS dota_match_id bigint');
    tournamentSchemaReady = true;
  } catch (error) {
    // 没有建表权限时不要让公开接口整体挂掉：名次/最高分/赛后明细会退化成空
    console.error('初始化 tournament_placements / peak_score / dota_* 失败（可忽略）:', error.message);
  } finally {
    client.release();
  }
};

// 导出所有数据库函数
module.exports = {
  query,
  initDatabase,
  ensureTournamentSchema,
  ensurePartyTables,
  ensureActivityTables,
  ensureSupportTable,
  ensurePageViewTable,
  insertPageView,
  insertSupportReport,
  countRecentSimilarReports,
  listSupportReports,
  listMySupportReports,
  updateSupportReport,
  ensurePlayerTextColumns,
  ensureAvatarColumns,
  ensurePasswordResetColumns,
  ensureAccountRenameColumns,
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