/**
 * 回忆页的纯展示逻辑（不碰 DOM、不碰网络），单独成文件是为了能被自检脚本直接 require 断言。
 *
 * 时间显示走相对时间：回忆这种东西「3 天前」比「10/28 14:20」好读，
 * 超过 30 天才退回日期。
 */

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relTime(iso, now = Date.now()) {
  const t = iso instanceof Date ? iso.getTime() : new Date(String(iso || '')).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = now - t;
  if (diff < 0) return '刚刚'; // 未来时间（时区/时钟偏差）不显示负号
  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  const d = new Date(t);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 图片网格的列数取决于张数：
 *   1 张   → 单图（按原比例，不裁切，最多 460 宽）
 *   2 张   → 两列
 *   3+ 张  → 三列正方形裁切（九宫格），再多也不会把页面拉长
 */
export function gridClass(n) {
  const c = Math.max(0, Number(n) || 0);
  if (c <= 1) return 'mem-grid mem-grid-1';
  if (c === 2) return 'mem-grid mem-grid-2';
  return 'mem-grid mem-grid-3';
}

/** 单图的宽高比，用来给容器占位，避免图片加载完后页面跳一下 */
export function aspectOf(w, h) {
  const ww = Number(w) || 0;
  const hh = Number(h) || 0;
  if (ww <= 0 || hh <= 0) return null;
  return `${ww} / ${hh}`;
}
