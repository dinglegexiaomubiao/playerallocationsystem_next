// 展示格式化工具（列表页共用）。注意：players.id 是 17 位雪花号，始终当字符串处理。
function fullUrl(base, p) {
  if (!p) return '';
  if (/^https?:\/\//.test(p)) return p;
  if (p.charAt(0) === '/') return base + p;
  return p;
}

function regionShort(region) {
  if (!region) return '';
  const parts = String(region).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  return parts.slice(-2).join(' ');
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate());
}

function fmtMonthDay(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.getMonth() + 1 + '.' + d.getDate();
}

function tourStatusText(s) {
  if (!s) return '筹备中';
  if (s === 'finished' || s === 'done') return '已结束';
  if (['ongoing', 'active', 'elimination', 'semifinal', 'final'].indexOf(s) >= 0) return '进行中';
  if (s === 'postponed') return '延期';
  return '筹备中';
}

// 'YYYY-MM-DD' 手拆，避免 new Date('2026-10-26') 被当 UTC 零点导致的跨时区跳日
function splitDateOnly(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** 'YYYY年M月'，语录按月分组用 */
function monthLabel(v) {
  const p = splitDateOnly(v);
  if (!p) return '';
  return p.y + '年' + p.m + '月';
}

/** 'M月D日' */
function fmtMD(v) {
  const p = splitDateOnly(v);
  if (!p) return '';
  return p.m + '月' + p.d + '日';
}

/** ISO / 时间戳 → 'M月D日 HH:mm'（本地时区） */
function fmtDateTime(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/** 5 分制 → '★★★★☆' */
function stars(n) {
  const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  let s = '';
  for (let i = 0; i < 5; i++) s += i < v ? '★' : '☆';
  return s;
}

module.exports = {
  fullUrl,
  regionShort,
  fmtDate,
  fmtMonthDay,
  fmtMD,
  fmtDateTime,
  monthLabel,
  stars,
  tourStatusText
};
