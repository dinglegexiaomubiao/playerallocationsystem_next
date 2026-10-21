import { initDatabase, query, addPlayer } from '../../lib/db';
import { getSession } from '../../lib/auth';

let dbInitialized = false;

const MAX_GAME_ID_LEN = 64;

// 库里 positions / heroes / enemies 是逗号分隔的 text，对外统一成数组
const toList = (v) =>
  Array.isArray(v)
    ? v
    : String(v || '')
        .split(/[，,、\/;；|]/)
        .map((s) => s.trim())
        .filter(Boolean);

// 候选资料：带上「参加过几届比赛」和「已被哪个账号绑定」，方便用户确认是不是自己
const CANDIDATE_SQL = `
  SELECT p.id, p.nickname, p.group_nickname, p.game_id, p.score,
         p.positions, p.heroes, p.region, p.self_intro, p.win_rate,
         (SELECT COUNT(DISTINCT tp.tournament_id)
            FROM public.team_players tp WHERE tp.player_id = p.id) AS tournament_count,
         (SELECT ps.name FROM public.play_score ps
           WHERE ps.player_id = p.id ORDER BY ps.name LIMIT 1) AS bound_by
    FROM public.players p
`;

const shapeCandidate = (r) => ({
  id: String(r.id),
  nickname: r.nickname || null,
  group_nickname: r.group_nickname || null,
  game_id: r.game_id === null ? null : String(r.game_id),
  score: r.score,
  win_rate: r.win_rate,
  region: r.region || null,
  self_intro: r.self_intro || null,
  positions: toList(r.positions),
  heroes: toList(r.heroes),
  tournament_count: Number(r.tournament_count) || 0,
  bound_by: r.bound_by || null,
});

/**
 * 账号 ↔ 选手 的补绑接口（登录后使用）
 *
 * GET  /api/profile-bind?game_id=xxx
 *      → 按 SteamID 查历史选手资料（找不到精确匹配时给近似建议）
 * POST /api/profile-bind
 *      { game_id, player_id }            继承已存在的选手资料并绑定
 *      { game_id, group_nickname }       库里没有，新建选手资料并绑定
 *
 * 只处理「当前登录账号还没有绑定选手」的场景；已绑定的请走 PUT /api/profile 改资料。
 */
export default async function handler(req, res) {
  if (!dbInitialized) {
    try {
      await initDatabase();
      dbInitialized = true;
    } catch (error) {
      console.error('数据库初始化失败:', error);
    }
  }

  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ success: false, error: '请先登录后再操作' });
  }

  try {
    const acct = await query('SELECT player_id FROM public.play_score WHERE name = $1', [
      session.name,
    ]);
    if (acct.rows.length === 0) {
      return res.status(401).json({ success: false, error: '账号不存在，请重新登录' });
    }
    const myPlayerId = acct.rows[0].player_id;

    // ---------- 查询历史资料 ----------
    if (req.method === 'GET') {
      const raw = String((req.query && req.query.game_id) || '').trim();
      if (!raw) {
        return res.status(400).json({ success: false, error: '请输入 SteamID' });
      }
      if (raw.length > MAX_GAME_ID_LEN) {
        return res.status(400).json({ success: false, error: 'SteamID 太长' });
      }

      const total = await query('SELECT COUNT(*)::int AS n FROM public.players');
      const totalPlayers = total.rows[0].n;

      // 纯数字按 SteamID 精确匹配；否则当成昵称去搜（用户常常记不住 ID）
      const isNumeric = /^\d{1,20}$/.test(raw);

      let candidates = [];
      if (isNumeric) {
        // 查**全部** SteamID（主号 + 副号），否则用副号来认领会找不到自己
        const r = await query(
          `${CANDIDATE_SQL}
            WHERE p.id IN (SELECT player_id FROM public.player_steam_accounts WHERE account_id = $1)
            ORDER BY p.id LIMIT 5`,
          [raw]
        );
        candidates = r.rows.map(shapeCandidate);
      }

      // 近似建议：数字按 ID 前缀（含副号），非数字按昵称（含全部群昵称）
      let suggestions = [];
      if (candidates.length === 0) {
        const r = isNumeric
          ? await query(
              `${CANDIDATE_SQL}
                WHERE p.id IN (SELECT player_id FROM public.player_steam_accounts
                                WHERE CAST(account_id AS TEXT) LIKE $1)
                ORDER BY p.id LIMIT 6`,
              [`${raw}%`]
            )
          : await query(
              `${CANDIDATE_SQL}
                WHERE p.nickname ILIKE $1
                   OR EXISTS (SELECT 1 FROM public.player_group_nicknames n
                               WHERE n.player_id = p.id AND n.nickname ILIKE $1)
                ORDER BY p.score DESC NULLS LAST, p.id LIMIT 6`,
              [`%${raw}%`]
            );
        suggestions = r.rows
          .map(shapeCandidate)
          .filter((c) => c.game_id !== (isNumeric ? raw : null));
      }

      return res.status(200).json({
        success: true,
        bound: myPlayerId !== null && myPlayerId !== undefined,
        totalPlayers,
        candidates,
        suggestions,
      });
    }

    // ---------- 绑定 / 新建 ----------
    if (req.method === 'POST') {
      if (myPlayerId !== null && myPlayerId !== undefined) {
        return res
          .status(409)
          .json({ success: false, error: '该账号已经绑定了选手资料，请直接在个人信息页编辑' });
      }

      const body = req.body || {};
      const gameId = String(body.game_id || '').trim();
      const playerId = body.player_id === undefined || body.player_id === null || body.player_id === ''
        ? null
        : String(body.player_id);
      const groupNickname = String(body.group_nickname || '').trim();

      if (!gameId) return res.status(400).json({ success: false, error: '请填写 SteamID' });
      // players.game_id 是 bigint，非数字会在 SQL 层抛 22P02
      if (!/^\d{1,20}$/.test(gameId)) {
        return res.status(400).json({ success: false, error: 'SteamID 应为纯数字' });
      }

      if (playerId) {
        // ---- 继承已有资料 ----
        // 防越权：这个 SteamID 必须真的属于所选选手（主号或任一备用号）
        const owns = await query(
          `SELECT 1 FROM public.player_steam_accounts WHERE player_id = $1 AND account_id = $2
           UNION ALL
           SELECT 1 FROM public.players WHERE id = $1 AND game_id = $2
           LIMIT 1`,
          [playerId, gameId]
        );
        const exists = await query('SELECT id FROM public.players WHERE id = $1', [playerId]);
        if (exists.rows.length === 0) {
          return res.status(404).json({ success: false, error: '该选手资料不存在' });
        }
        if (owns.rows.length === 0) {
          return res
            .status(400)
            .json({ success: false, error: '所选资料与填写的 SteamID 不一致，请重新查找' });
        }
        const taken = await query(
          'SELECT name FROM public.play_score WHERE player_id = $1 AND name <> $2 LIMIT 1',
          [playerId, session.name]
        );
        if (taken.rows.length > 0) {
          return res
            .status(409)
            .json({ success: false, error: '该选手资料已被其他账号绑定，请联系管理员' });
        }
        await query('UPDATE public.play_score SET player_id = $1 WHERE name = $2', [
          playerId,
          session.name,
        ]);
        return res.status(200).json({ success: true, playerId, inherited: true });
      }

      // ---- 新建资料 ----
      if (!groupNickname) {
        return res.status(400).json({ success: false, error: '请填写群昵称' });
      }
      // 这个 SteamID 可能已经作为别人的副号存在了
      const dup = await query(
        `SELECT s.player_id AS id, p.nickname FROM public.player_steam_accounts s
           JOIN public.players p ON p.id = s.player_id
          WHERE s.account_id = $1 LIMIT 1`,
        [gameId]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: `库里已有这个 SteamID 的资料（${dup.rows[0].nickname || '未命名'}），请选择「继承」而不是新建`,
        });
      }

      const created = await addPlayer({
        nickname: groupNickname,
        game_id: gameId,
        group_nickname: groupNickname,
        steamIds: [gameId],
        groupNicknames: [groupNickname],
        identitySource: 'register',
        score: null,
        positions: [],
        heroes: [],
        region: null,
        self_intro: null,
        enemies: [],
        synergy_players: [],
      });
      const newId = String(created.id);
      await query('UPDATE public.play_score SET player_id = $1 WHERE name = $2', [
        newId,
        session.name,
      ]);
      return res.status(200).json({ success: true, playerId: newId, inherited: false });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    if (error && error.code === '23505') {
      return res
        .status(409)
        .json({ success: false, error: '该选手资料刚被其他账号绑定，请刷新后重试' });
    }
    console.error('补绑选手资料错误:', error);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  }
}
