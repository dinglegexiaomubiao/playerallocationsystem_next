import { initDatabase, query } from '../../lib/db';

export default async function handler(req, res) {
  // 初始化数据库
  await initDatabase();

  if (req.method === 'POST') {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: '用户名不能为空' });
    }

    try {
      // 检查用户是否已存在
      const result = await query(
        'SELECT name, count FROM public.play_score WHERE name = $1',
        [username]
      );

      if (result.rows.length > 0) {
        // 用户存在，更新计数
        const updated = await query(
          'UPDATE public.play_score SET count = count + 1 WHERE name = $1 RETURNING count',
          [username]
        );
        return res.status(200).json({ 
          name: username, 
          count: updated.rows[0].count,
          message: '登录成功' 
        });
      } else {
        // 新用户，插入记录
        const inserted = await query(
          'INSERT INTO public.play_score (name, count) VALUES ($1, $2) RETURNING count',
          [username, 1]
        );
        return res.status(200).json({ 
          name: username, 
          count: inserted.rows[0].count,
          message: '登录成功' 
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