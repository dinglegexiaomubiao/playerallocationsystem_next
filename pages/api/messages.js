import { pool } from '../../lib/db';

export default async function handler(req, res) {
  // 确保正确解析请求体
  if (req.body && typeof req.body === 'string') {
    try {
      req.body = JSON.parse(req.body);
    } catch (e) {
      // 如果解析失败，保持原样
    }
  }

  let client;
  try {
    client = await pool.connect();
    
    switch (req.method) {
      case 'GET':
        // 获取所有消息，按创建时间倒序排列
        const getMessagesResult = await client.query(
          'SELECT * FROM public.messages ORDER BY created_at DESC'
        );
        res.status(200).json(getMessagesResult.rows);
        break;
        
      case 'POST':
        // 添加新消息
        const { username, content } = req.body;
        
        if (!username || !content) {
          res.status(400).json({ error: '用户名和内容不能为空' });
          return;
        }
        
        const postResult = await client.query(
          'INSERT INTO public.messages (username, content) VALUES ($1, $2) RETURNING *',
          [username, content]
        );
        res.status(201).json(postResult.rows[0]);
        break;
        
      case 'PUT':
        // 为消息点赞
        const { id, likes } = req.body;
        
        if (!id) {
          res.status(400).json({ error: '消息ID不能为空' });
          return;
        }
        
        const putResult = await client.query(
          'UPDATE public.messages SET likes = $1 WHERE id = $2 RETURNING *',
          [likes, id]
        );
        res.status(200).json(putResult.rows[0]);
        break;
        
      default:
        res.setHeader('Allow', ['GET', 'POST', 'PUT']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error('消息API错误:', error);
    res.status(500).json({ error: '服务器内部错误: ' + error.message });
  } finally {
    if (client) {
      client.release();
    }
  }
}