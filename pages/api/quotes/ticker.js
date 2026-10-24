/**
 * 底部悬浮栏的数据源。
 *
 * 为什么不复用 /api/quotes：那个带分页总数、收录人、按需筛选，
 * 而悬浮栏只需要「一句话 + 出处」，而且在每个页面都会被请求。
 * 单独一个瘦接口，缓存 60 秒，对首屏和服务器的负担都小。
 *
 * 顺序不在这里打乱 —— 服务端打乱会让缓存失去意义（同一批 60 秒内顺序该一样）。
 * 洗牌交给客户端，每次打开页面顺序都不同。
 */
import { tickerQuotes } from '../../../lib/quotes.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  }
  try {
    const quotes = await tickerQuotes(30);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ success: true, quotes });
  } catch (e) {
    console.error('语录悬浮栏接口错误:', e);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  }
}
