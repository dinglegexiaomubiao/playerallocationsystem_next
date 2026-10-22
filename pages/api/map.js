import { loadMapData } from '../../lib/map-data.mjs';

/**
 * 群友分布图的数据接口。
 *
 * 页面本身走 getServerSideProps 直出，这个接口是给「想二次利用」的地方用的
 * （比如以后做小程序、或者别的页面要拿聚合结果）。两者共用 loadMapData，
 * 不存在第二套装配逻辑。
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  }

  try {
    const data = await loadMapData({ cache: true });
    // 数据随群友补填变化，缓存 60 秒足够，别让 CDN/浏览器长时间存住
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ success: true, ...data });
  } catch (e) {
    console.error('[api/map] 装配失败：', e);
    return res.status(500).json({ success: false, error: e.message || '读取分布数据失败' });
  }
}
