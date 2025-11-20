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
        // 为消息点赞/取消点赞 - 使用原子操作防止并发问题
        const { id, action } = req.body;
        
        if (!id) {
          res.status(400).json({ error: '消息ID不能为空' });
          return;
        }
        
        let query, params;
        if (action === 'unlike') {
          // 先获取当前点赞数，然后减少点赞数，但不能小于0
          const currentResult = await client.query(
            'SELECT likes FROM public.messages WHERE id = $1',
            [id]
          );
          
          // 如果消息不存在
          if (currentResult.rowCount === 0) {
            res.status(404).json({ error: '消息不存在' });
            return;
          }
          
          // 计算新的点赞数（不低于0）
          const newLikes = Math.max((currentResult.rows[0].likes || 0) - 1, 0);
          
          query = 'UPDATE public.messages SET likes = $1 WHERE id = $2 RETURNING *';
          params = [newLikes, id];
        } else {
          // 增加点赞数
          query = 'UPDATE public.messages SET likes = likes + 1 WHERE id = $1 RETURNING *';
          params = [id];
        }
        
        // 执行更新操作
        const putResult = await client.query(query, params);
        
        // 如果没有更新任何行，说明消息不存在
        if (putResult.rowCount === 0) {
          res.status(404).json({ error: '消息不存在' });
          return;
        }
        
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