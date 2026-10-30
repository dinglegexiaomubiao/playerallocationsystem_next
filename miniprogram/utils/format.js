// 展示格式化工具（列表页共用）。注意：players.id 是 17 位雪花号，始终当字符串处理。
function fullUrl(base, p) {
  if (!p) return '';
  if (/^https?:\/\//.test(p)) return p;
  if (p.charAt(0) === '/') return base + p;
  return p;
}

function regionShort(region) {
  // 口径在 utils/regions.js（移植自 lib/regions.js）：`深圳市 · 南山区`
  return require('./regions').regionShort(region);
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

/**
 * 状态 → 三个筛选分组之一。口径必须跟网页端 lib/tournament-format.mjs 的
 * statusGroup() 完全一致，否则同一个赛事在网页端归「筹备中」、在小程序归「延期」，
 * 两边筛出来的条数对不上。改这里就要改那边，并有 scripts/check-miniprogram-tournaments.cjs 把关。
 *
 * 注意 postponed 归 planning（网页端就是「筹备中」），而上面 tourStatusText
 * 仍显示「延期」—— 文案和分组是两回事，别合并。
 */
function tourStatusGroup(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'finished' || s === 'done') return 'finished';
  if (
    s === 'ongoing' ||
    s === 'active' ||
    s === 'elimination' ||
    s === 'semifinal' ||
    s === 'final'
  ) {
    return 'live';
  }
  return 'planning'; // planning / planned / postponed / 空
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

/**
 * ISO / 时间戳 → 本地 'YYYY-MM-DD'。对齐网页端 pages/party|activities/index.js 的
 * dateKeyOf()，按日期查历史记录时用。用本地年月日拆，避免 UTC 零点跨时区跳日。
 */
function dateKeyOf(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/**
 * 集合 / 开黑时间段：'M月D日 HH:mm ~ HH:mm'（跨天带日期）。对齐网页端
 * components/ActivityCard.js 与 PartyCard.js 的 fmtRange()，卡片顶部展示「开始 ~ 结束」。
 */
function fmtRange(startAt, durationMin) {
  if (!startAt) return '';
  const d = startAt instanceof Date ? startAt : new Date(startAt);
  if (isNaN(d.getTime())) return '';
  const head = fmtDateTime(startAt);
  if (!durationMin) return head;
  const e = new Date(d.getTime() + Number(durationMin) * 60000);
  const sameDay =
    e.getFullYear() === d.getFullYear() &&
    e.getMonth() === d.getMonth() &&
    e.getDate() === d.getDate();
  const tail = sameDay ? pad2(e.getHours()) + ':' + pad2(e.getMinutes()) : fmtDateTime(e);
  return head + ' ~ ' + tail;
}

module.exports = {
  fullUrl,
  regionShort,
  fmtDate,
  fmtMonthDay,
  fmtMD,
  fmtDateTime,
  fmtRange,
  dateKeyOf,
  monthLabel,
  stars,
  tourStatusText,
  tourStatusGroup
};
