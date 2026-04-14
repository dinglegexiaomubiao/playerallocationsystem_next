import { pool } from '../../lib/db';

// 简单的内存 Rate Limiting：IP -> { count, resetTime }
const rateLimitMap = new Map();

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
    || req.headers['x-real-ip'] 
    || req.connection.remoteAddress 
    || 'unknown';
}

function checkRateLimit(ip, method) {
  const now = Date.now();
  // 不同方法不同限制
  const limits = {
    GET: { max: 60, window: 60 * 1000 },    // 60次/分钟
    POST: { max: 10, window: 60 * 1000 },   // 10次/分钟
    PUT: { max: 20, window: 60 * 1000 }     // 20次/分钟
  };
  const limit = limits[method] || { max: 30, window: 60 * 1000 };
  const key = `${ip}:${method}`;
  const record = rateLimitMap.get(key);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + limit.window });
    return { allowed: true };
  }
  
  if (record.count >= limit.max) {
    return { 
      allowed: false, 
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    };
  }
  
  record.count++;
  rateLimitMap.set(key, record);
  return { allowed: true };
}

export default async function handler(req, res) {
  // 速率限制检查
  const clientIp = getClientIp(req);
  const rateCheck = checkRateLimit(clientIp, req.method);
  if (!rateCheck.allowed) {
    return res.status(429).json({ 
      error: '请求过于频繁，请稍后再试', 
      retryAfter: rateCheck.retryAfter 
    });
  }

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
      case 'GET': {
        const getMessagesResult = await client.query(
          'SELECT * FROM public.messages ORDER BY created_at DESC'
        );
        res.status(200).json(getMessagesResult.rows);
        break;
      }
        
      case 'POST': {
        let { username, content } = req.body;
        
        if (!username || !content) {
          res.status(400).json({ error: '用户名和内容不能为空' });
          return;
        }
        
        // 简单的输入清理：截断过长内容
        username = String(username).trim().slice(0, 50);
        content = String(content).trim().slice(0, 500);
        
        if (!username || !content) {
          res.status(400).json({ error: '用户名和内容不能为空' });
          return;
        }
        
        const chinaTime = new Date().toLocaleString("sv-SE", {timeZone: "Asia/Shanghai"});
        
        const postResult = await client.query(
          'INSERT INTO public.messages (username, content, created_at) VALUES ($1, $2, $3) RETURNING *',
          [username, content, chinaTime]
        );
        res.status(201).json(postResult.rows[0]);
        break;
      }
        
      case 'PUT': {
        const { id, action } = req.body;
        
        if (!id) {
          res.status(400).json({ error: '消息ID不能为空' });
          return;
        }
        
        let queryStr, params;
        if (action === 'unlike') {
          queryStr = 'UPDATE public.messages SET likes = GREATEST(likes - 1, 0) WHERE id = $1 RETURNING *';
          params = [id];
        } else {
          queryStr = 'UPDATE public.messages SET likes = likes + 1 WHERE id = $1 RETURNING *';
          params = [id];
        }
        
        const putResult = await client.query(queryStr, params);
        
        if (putResult.rowCount === 0) {
          res.status(404).json({ error: '消息不存在' });
          return;
        }
        
        res.status(200).json(putResult.rows[0]);
        break;
      }
        
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
