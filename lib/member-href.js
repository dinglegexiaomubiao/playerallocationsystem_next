/**
 * 选手详情页链接：带上「从哪来」
 *
 * 为什么不用 document.referrer：站内是客户端跳转，referrer 只在首次加载时
 * 写死，之后一直等于最初那个来源，用来判断「上一页」会判错。
 * 所以显式把当前路径塞进 ?from=，详情页的返回键照着它走。
 *
 * @param {string|number} playerId  players.id
 * @param {string} from             来源路径（不含查询串），如 /tournaments/16
 * @param {object} [extra]          额外要带过去的查询参数（如 { dist: '南山区' }），
 *                                  用来让「返回」时还原当时选中的区
 */
export function memberHref(playerId, from, extra) {
  const base = `/members/${playerId}`;
  const qs = [];
  if (from) qs.push('from=' + encodeURIComponent(from));
  if (extra && typeof extra === 'object') {
    for (const k of Object.keys(extra)) {
      const v = extra[k];
      if (v === undefined || v === null || v === '') continue;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
  }
  return qs.length ? `${base}?${qs.join('&')}` : base;
}

/** 把 /tournaments/16 这类路径翻成返回键上的人话 */
export function backLabelOf(from) {
  if (!from) return '返回群友列表';
  if (from.startsWith('/map')) return '返回分布图';
  if (from.startsWith('/tournaments')) return '返回赛事';
  if (from.startsWith('/party')) return '返回开黑组队';
  if (from === '/' || from === '') return '返回首页';
  return '返回上一页';
}
