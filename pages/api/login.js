import { initDatabase, query, addPlayer, getPlayerByGameId, bindAccountToPlayer } from '../../lib/db';
import { setSessionCookie, isAdminName } from '../../lib/auth';
import { getClientIp, getLock, recordFail, resetFail, formatRetry } from '../../lib/rate-limit';
import crypto from 'crypto';

let dbInitialized = false;

function hashPassword(password, salt = '') {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

function hashPasswordWithSalt(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${hashPassword(password, salt)}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (hash === undefined) {
    // 旧格式：无盐 SHA256，兼容存量用户
    return hashPassword(password) === stored;
  }
  return hashPassword(password, salt) === hash;
}

export default async function handler(req, res) {
  if (!dbInitialized) {
    try {
      await initDatabase();
      dbInitialized = true;
    } catch (error) {
      console.error('数据库初始化失败:', error);
    }
  }

  if (req.method === 'POST') {
    const { username, password, profile } = req.body;

    if (!username) {
      return res.status(400).json({ error: '用户名不能为空' });
    }

    const trimmedUsername = String(username).trim();
    const trimmedPassword = password ? String(password).trim() : '';

    // ---- 登录失败限流：同一 IP 或同一账号在 10 分钟内失败 5 次即锁定 ----
    const limitKeys = [
      `ip:${getClientIp(req)}`,
      `user:${trimmedUsername.toLowerCase()}`,
    ];
    let locked = null;
    for (const k of limitKeys) {
      const st = getLock(k);
      if (st) {
        locked = st;
        break;
      }
    }
    if (locked) {
      res.setHeader('Retry-After', String(locked.retryAfterSec));
      return res.status(429).json({
        error: `登录尝试次数过多，请 ${formatRetry(locked.retryAfterSec)} 后再试`,
        retryAfterSec: locked.retryAfterSec,
      });
    }
    const markFail = () => {
      for (const k of limitKeys) recordFail(k);
    };
    const clearFail = () => {
      for (const k of limitKeys) resetFail(k);
    };

    try {
      const result = await query(
        'SELECT name, count, password FROM public.play_score WHERE name = $1',
        [trimmedUsername]
      );

      if (result.rows.length > 0) {
        const user = result.rows[0];
        const existingPassword = user.password;

        // 如果用户已有密码，必须校验
        if (existingPassword) {
          if (!trimmedPassword) {
            return res.status(400).json({ error: '请输入密码' });
          }
          if (!verifyPassword(trimmedPassword, existingPassword)) {
            markFail();
            return res.status(401).json({ error: '密码错误' });
          }
          // 旧格式（无盐）密码校验通过后，自动升级为加盐格式
          if (!existingPassword.includes(':')) {
            await query(
              'UPDATE public.play_score SET password = $1 WHERE name = $2',
              [hashPasswordWithSalt(trimmedPassword), trimmedUsername]
            );
          }
        } else {
          // 旧用户没有密码：如果有提交密码，则帮他设置上
          if (trimmedPassword) {
            await query(
              'UPDATE public.play_score SET password = $1 WHERE name = $2',
              [hashPasswordWithSalt(trimmedPassword), trimmedUsername]
            );
          }
        }

        // 更新登录次数
        const updated = await query(
          'UPDATE public.play_score SET count = count + 1 WHERE name = $1 RETURNING count',
          [trimmedUsername]
        );
        // 下发会话 cookie，供后续接口识别身份（含管理员判定）
        clearFail();
        setSessionCookie(res, trimmedUsername);
        return res.status(200).json({
          name: trimmedUsername,
          count: updated.rows[0].count,
          message: '登录成功',
          isAdmin: isAdminName(trimmedUsername)
        });
      } else {
        // 新用户注册并登录
        if (!trimmedPassword) {
          return res.status(400).json({ error: '新用户需要设置密码' });
        }

        const inserted = await query(
          'INSERT INTO public.play_score (name, count, password) VALUES ($1, $2, $3) RETURNING count',
          [trimmedUsername, 1, hashPasswordWithSalt(trimmedPassword)]
        );

        // 注册时如果带了选手资料（profile），则创建/复用选手并绑定账号
        let playerId = null;
        if (profile && profile.game_id) {
          const existing = await getPlayerByGameId(profile.game_id);
          if (existing) {
            playerId = existing.id;
          } else {
            const newPlayer = await addPlayer({
              nickname: profile.nickname || trimmedUsername,
              game_id: profile.game_id,
              group_nickname: profile.group_nickname || null,
              score: profile.score || null,
              positions: profile.positions || [],
              heroes: profile.heroes || [],
              region: profile.region || null,
              self_intro: profile.self_intro || null,
              enemies: profile.enemies || [],
              synergy_players: profile.synergy_players || [],
            });
            playerId = newPlayer.id;
          }
          await bindAccountToPlayer(trimmedUsername, playerId);
        }

        clearFail();
        setSessionCookie(res, trimmedUsername);
        return res.status(200).json({
          name: trimmedUsername,
          count: inserted.rows[0].count,
          message: '注册并登录成功',
          playerId,
          isAdmin: isAdminName(trimmedUsername)
        });
      }
    } catch (error) {
      console.error('登录错误:', error);
      return res.status(500).json({ error: '服务器内部错误' });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  }
}
