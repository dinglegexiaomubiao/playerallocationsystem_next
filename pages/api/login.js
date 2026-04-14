import { initDatabase, query } from '../../lib/db';
import crypto from 'crypto';

let dbInitialized = false;

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
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
    const { username, password } = req.body;

    if (!username) {
      return res.status(400).json({ error: '用户名不能为空' });
    }

    const trimmedUsername = String(username).trim();
    const trimmedPassword = password ? String(password).trim() : '';

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
          if (hashPassword(trimmedPassword) !== existingPassword) {
            return res.status(401).json({ error: '密码错误' });
          }
        } else {
          // 旧用户没有密码：如果有提交密码，则帮他设置上
          if (trimmedPassword) {
            await query(
              'UPDATE public.play_score SET password = $1 WHERE name = $2',
              [hashPassword(trimmedPassword), trimmedUsername]
            );
          }
        }

        // 更新登录次数
        const updated = await query(
          'UPDATE public.play_score SET count = count + 1 WHERE name = $1 RETURNING count',
          [trimmedUsername]
        );
        return res.status(200).json({
          name: trimmedUsername,
          count: updated.rows[0].count,
          message: '登录成功'
        });
      } else {
        // 新用户注册并登录
        if (!trimmedPassword) {
          return res.status(400).json({ error: '新用户需要设置密码' });
        }

        const inserted = await query(
          'INSERT INTO public.play_score (name, count, password) VALUES ($1, $2, $3) RETURNING count',
          [trimmedUsername, 1, hashPassword(trimmedPassword)]
        );
        return res.status(200).json({
          name: trimmedUsername,
          count: inserted.rows[0].count,
          message: '注册并登录成功'
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
