// 群友分布图：按 adcode 取某一级行政区（全国 / 省 / 市）的几何 + 计数
//
// 页面首次加载走 getServerSideProps 直出，下钻时由浏览器打这个接口。
// 两者共用 lib/map-data.mjs 的 loadMapData，不存在第二套装配逻辑。
//
// 返回 200 而不是 4xx 的两种情况要分清：
//   - `reason: 'no-children'`：「东莞市」这类不设区县的地方，属于正常业务结果
//   - `reason: 'unknown'`：adcode 不在索引里，可能是手改 URL
import { loadMapData } from '../../../lib/map-data.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ ok: false, error: `方法 ${req.method} 不被允许` });
  }

  const adcode = String(req.query.adcode || '').trim();
  if (!/^\d{6}$/.test(adcode)) {
    return res.status(400).json({ ok: false, reason: 'bad-adcode', error: 'adcode 需要 6 位数字' });
  }

  try {
    const data = await loadMapData({ adcode });
    // 群友补填地区后地图会变，缓存 60 秒就够，别让浏览器长期存住
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      ok: true,
      scope: data.scope,
      notice: data.notice || null,
      geo: data.geo,
      areas: data.areas,
      here: data.here,
      me: data.me,
      elsewhere: data.elsewhere,
      stats: data.stats,
    });
  } catch (e) {
    const msg = (e && e.message) || '读取地图数据失败';
    // 「没有下级」是正常结果：前端据此提示，不当错误
    if (/没有下级行政区数据/.test(msg)) {
      return res.status(200).json({ ok: false, reason: 'no-children', error: msg });
    }
    if (/地图索引缺失/.test(msg)) {
      return res.status(500).json({ ok: false, reason: 'no-index', error: msg });
    }
    console.error('[api/map/geo] 装配失败：', e);
    return res.status(502).json({ ok: false, reason: 'failed', error: msg });
  }
}
