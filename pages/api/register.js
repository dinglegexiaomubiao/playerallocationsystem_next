import {
  initDatabase,
  query,
  addPlayer,
  getPlayerByGameId,
  bindAccountToPlayer,
} from '../../lib/db';
import { setSessionCookie, isAdminName } from '../../lib/auth';
import { hashPasswordWithSalt } from '../../lib/password';

let dbInitialized = false;

const MAX_NAME_LEN = 40;
const MAX_GAME_ID_LEN = 64;
const MAX_PASSWORD_LEN = 64;

/**
 * 注册接口 —— 全站唯一的建号入口
 *
 * 与登录彻底分离：/api/login 只校验已有账号，不存在的直接拒绝；
 * 只有这里才允许往 play_score 插新行。
 *
 * POST { username, password, game_id, group_nickname }
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

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  }

  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '').trim();
  const gameId = String(body.game_id || '').trim();
  const groupNickname = String(body.group_nickname || '').trim();

  if (!username) return res.status(400).json({ error: '请填写登录账号' });
  if (!password) return res.status(400).json({ error: '请设置密码' });
  if (!gameId) return res.status(400).json({ error: '请填写 Steam 账号' });
  // 群昵称是选手的公开名片（登录账号不对外展示），所以必填
  if (!groupNickname) return res.status(400).json({ error: '请填写群昵称' });
  if (username.length > MAX_NAME_LEN) {
    return res.status(400).json({ error: `登录账号不能超过 ${MAX_NAME_LEN} 个字符` });
  }
  if (gameId.length > MAX_GAME_ID_LEN) {
    return res.status(400).json({ error: `Steam 账号不能超过 ${MAX_GAME_ID_LEN} 个字符` });
  }
  // players.game_id 是 bigint（Steam 数字 ID），非数字会在 SQL 层报 22P02，这里提前拦住
  if (!/^\d{1,20}$/.test(gameId)) {
    return res.status(400).json({ error: 'Steam 账号应为纯数字 ID，例如 114678450' });
  }
  // 加盐散列定长 97 字符，play_score.password 只有 varchar(100)
  if (password.length > MAX_PASSWORD_LEN) {
    return res.status(400).json({ error: `密码不能超过 ${MAX_PASSWORD_LEN} 个字符` });
  }

  try {
    // ---- 账号名唯一，且不区分大小写 ----
    // 必须不区分大小写：登录按原样精确匹配，但管理员判定 isAdminName 是大小写无关的。
    // 若允许 `DOM` 与已有的 `dom` 并存，任何人都能注册大小写变体冒充管理员。
    const dupName = await query(
      'SELECT name FROM public.play_score WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [username]
    );
    if (dupName.rows.length > 0) {
      return res.status(409).json({ error: '该登录账号已被占用，请换一个' });
    }

    // ---- Steam 账号唯一：已被别的账号认领的选手不允许重复绑定 ----
    const existingPlayer = await getPlayerByGameId(gameId);
    if (existingPlayer) {
      const bound = await query(
        'SELECT name FROM public.play_score WHERE player_id = $1 AND LOWER(name) <> LOWER($2) LIMIT 1',
        [existingPlayer.id, username]
      );
      if (bound.rows.length > 0) {
        return res.status(409).json({
          error: '该 Steam 账号已被其他登录账号绑定，请确认是否重复注册',
        });
      }
    }

    // ---- 先占号：play_score.name 是主键，并发下由唯一索引兜底 ----
    let inserted;
    try {
      inserted = await query(
        'INSERT INTO public.play_score (name, count, password) VALUES ($1, $2, $3) RETURNING count',
        [username, 1, hashPasswordWithSalt(password)]
      );
    } catch (error) {
      if (error && error.code === '23505') {
        return res.status(409).json({ error: '该登录账号已被占用，请换一个' });
      }
      throw error;
    }

    // ---- 建号成功后再建/复用选手并绑定；失败则把刚占的号删掉，避免留下空账号 ----
    let playerId = null;
    try {
      if (existingPlayer) {
        playerId = existingPlayer.id;
      } else {
        const newPlayer = await addPlayer({
          // 昵称用群昵称：登录账号是「随意填写、不对外展示」的，不能拿去当公开名片
          nickname: groupNickname,
          game_id: gameId,
          group_nickname: groupNickname,
          score: null,
          positions: [],
          heroes: [],
          region: null,
          self_intro: null,
          enemies: [],
          synergy_players: [],
        });
        playerId = newPlayer.id;
      }
      await bindAccountToPlayer(username, playerId);
    } catch (error) {
      await query('DELETE FROM public.play_score WHERE name = $1', [username]).catch(() => {});
      throw error;
    }

    setSessionCookie(res, username);
    return res.status(200).json({
      success: true,
      name: username,
      count: inserted.rows[0].count,
      playerId,
      message: '注册成功',
      isAdmin: isAdminName(username),
    });
  } catch (error) {
    console.error('注册错误:', error);
    return res.status(500).json({ error: '服务器内部错误' });
  }
}
