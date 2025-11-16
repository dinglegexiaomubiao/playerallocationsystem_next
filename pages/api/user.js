import { initDatabase, query } from '../../lib/db';

export default async function handler(req, res) {
  // 初始化数据库
  await initDatabase();

  if (req.method === 'GET') {
    const { username } = req.query;

    if (!username) {
      return res.status(400).json({ error: '用户名不能为空' });
    }

    try {
      // 获取用户信息
      const result = await query(
        'SELECT name, count FROM public.play_score WHERE name = $1',
        [username]
      );

      if (result.rows.length > 0) {
        return res.status(200).json(result.rows[0]);
      } else {
        return res.status(404).json({ error: '用户不存在' });
      }
    } catch (error) {
      console.error('获取用户信息错误:', error);
      return res.status(500).json({ error: '服务器内部错误' });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  }
}