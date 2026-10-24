/**
 * 语录页的纯展示逻辑（无任何依赖，客户端要 import）。
 *
 * 为什么单独一个文件：lib/quotes.mjs 里 import 了 db.js（连 PG），
 * 页面组件一旦直接 import 它，pg 会被打进浏览器 bundle 直接报错。
 *
 * 月份按 Asia/Shanghai 固定时区算，不用浏览器本地时区 ——
 * 否则服务器在 UTC+8、访客在 UTC-5 时，同一条语录会被分到不同月份，
 * SSR 和 hydration 的文本对不上，React 会整段重渲染并告警。
 */

const monthFmt = () =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
  });

/** '2026-10-24T05:30:00.000Z' → '2026-10' */
export const monthKey = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return monthFmt().format(d).slice(0, 7);
};

/** '2026-10' → '2026 年 10 月' */
export const monthLabel = (key) => {
  const [y, m] = String(key || '').split('-');
  if (!y || !m) return '';
  return `${y} 年 ${Number(m)} 月`;
};

/** 列表按「收录时间」倒序分组 —— 排序依据和分组依据必须是同一个，否则同月条目会跳来跳去 */
export const groupByMonth = (quotes = []) => {
  const out = [];
  let cur = null;
  for (const q of quotes) {
    const key = monthKey(q.createdAt);
    if (!cur || cur.key !== key) {
      cur = { key, label: monthLabel(key), items: [] };
      out.push(cur);
    }
    cur.items.push(q);
  }
  return out;
};

/** '2026-10-24' → '2026.10.24'，等宽体配这个格式读起来像日期而不是数字 */
export const dateLabel = (s) => String(s || '').replace(/-/g, '.');

/** 悬浮栏里超过这个长度就截断 —— 一句 120 字的「语录」本来就不该躺在底部栏里 */
export const TICKER_MAX = 60;
export const tickerText = (s) => {
  const t = String(s || '');
  return [...t].length > TICKER_MAX ? [...t].slice(0, TICKER_MAX).join('') + '…' : t;
};
