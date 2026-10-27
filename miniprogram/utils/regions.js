// 地区（省/市/区）数据 + 拼串。
//
// 两个刻意的克制：
//
// 1. **不复制区划数据**。网页版和小程序都读同一个 `public/data/china-division.json`
//    （30KB，小程序用 wx.request 拉，storage 缓存 7 天）。复制一份进 miniprogram/
//    就是第二份真相，区划一改就两边不一致。
//
// 2. **只实现「拼串 + 展示压缩」这两半**。`lib/regions.js` 里真正复杂的是解析与判断
//    （isShenzhen 之类），那些只有服务端需要。但 `regionShort` 是**展示口径**，
//    网页和小程序必须逐字一致，否则「网页筛深圳 10 人、小程序 0 人」——
//    所以下面那份 parseRegion / regionShort 是从 `lib/regions.js` 逐行抄的，
//    ⚠ 改一边就要改另一边，`scripts/check-miniprogram-members.cjs` 会比对。
//
// 取不到数据时不要卡住用户：调用方据 failed 降级成「只填具体地点」，
// 地点本来就是必填项，地区只是锦上添花。
const { getBase } = require('./api');

const CACHE_KEY = 'chinaDivision';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LEN = 50;

let mem = null;
let pending = null;

function readCache() {
  try {
    const raw = wx.getStorageSync(CACHE_KEY);
    if (!raw || !raw.china || !raw.china.length) return null;
    if (Date.now() - (raw.fetchedAt || 0) > TTL_MS) return null;
    return raw.china;
  } catch (e) {
    return null;
  }
}

function writeCache(china) {
  try {
    wx.setStorageSync(CACHE_KEY, { china: china, fetchedAt: Date.now() });
  } catch (e) {
    /* 存不下就只留内存，下次再拉 */
  }
}

/** 省列表：[{name, cities:[{name, areas:[]}]}] */
function loadChina() {
  if (mem) return Promise.resolve(mem);
  if (pending) return pending;

  const cached = readCache();
  if (cached) {
    mem = cached;
    return Promise.resolve(mem);
  }

  pending = new Promise((resolve, reject) => {
    wx.request({
      // 静态文件走同一个域名，不用另开接口：Next 的 public/ 目录直接吐这个 json
      url: getBase() + '/data/china-division.json',
      method: 'GET',
      success(res) {
        pending = null;
        const china = res && res.statusCode === 200 ? res.data && res.data.china : null;
        if (!Array.isArray(china) || !china.length) {
          reject(new Error('地区数据格式不对'));
          return;
        }
        mem = china;
        writeCache(china);
        resolve(china);
      },
      fail(err) {
        pending = null;
        reject(new Error((err && err.errMsg) || '地区数据加载失败'));
      }
    });
  });
  return pending;
}

/**
 * 拼成服务端认的串：`中国 广东省 深圳市 南山区`。
 * 级别可以只填到市（甚至只填到省），和网页版一样允许。
 */
function buildRegion(sel) {
  const s = sel || {};
  return ['中国', s.province, s.city, s.district]
    .map(function (v) {
      return String(v || '').trim();
    })
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_LEN);
}

/**
 * 反解存量串 → 三级选择。只认「中国 省 市 区」这一种结构，
 * 老自由文本（`南山`、`龙华，深圳`）一律当成「没有地区」，让用户重新选。
 */
function splitRegion(text) {
  const raw = String(text || '').trim();
  const empty = { province: '', city: '', district: '' };
  if (!raw) return empty;
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens[0] !== '中国') return empty;
  return { province: tokens[1] || '', city: tokens[2] || '', district: tokens[3] || '' };
}

// ---------------- 下面是 lib/regions.js 的展示口径移植 ----------------

const DEFAULT_COUNTRY = '中国';

/**
 * 解析地区字符串。structured=false 表示老的自由文本（`龙华，深圳，china`），
 * 四段都可能为空，原值在 raw 里。
 */
function parseRegion(text) {
  const raw = String(text || '').trim();
  const empty = {
    country: '',
    province: '',
    city: '',
    district: '',
    structured: false,
    foreign: false,
    raw: raw
  };
  if (!raw) return empty;

  // 老文本里带逗号顿号的一律当成非结构化
  const hasLegacySeparator = /[，,、/|；;]/.test(raw);
  const tokens = raw.split(/\s+/).filter(Boolean);

  if (!hasLegacySeparator && tokens[0] === DEFAULT_COUNTRY) {
    return {
      country: DEFAULT_COUNTRY,
      province: tokens[1] || '',
      city: tokens[2] || '',
      district: tokens[3] || '',
      structured: true,
      foreign: false,
      raw: raw
    };
  }

  // 其他国家：`日本 东京都`。国名之后整段都算「城市/地区」，不做层级拆分。
  if (!hasLegacySeparator && tokens.length >= 2) {
    return {
      country: tokens[0],
      province: '',
      city: tokens.slice(1).join(' '),
      district: '',
      structured: true,
      foreign: tokens[0] !== DEFAULT_COUNTRY,
      raw: raw
    };
  }

  return empty;
}

/** 完整展示（省市同名时只留一个）：`中国 北京市 朝阳区` */
function regionFull(text) {
  const p = parseRegion(text);
  if (!p.raw) return '';
  if (!p.structured) return p.raw;
  const parts = [p.country, p.province, p.city, p.district].filter(Boolean);
  const dedup = parts.filter(function (v, i) {
    return v !== parts[i - 1];
  });
  return dedup.join(' ');
}

/** 紧凑展示（群友卡片 / 筛选下拉）：`深圳市 · 南山区`、`日本 · 东京都` */
function regionShort(text) {
  const p = parseRegion(text);
  if (!p.raw) return '';
  if (!p.structured) return p.raw;

  if (p.foreign) return [p.country, p.city].filter(Boolean).join(' · ');

  // 有区就「市 · 区」；没有区就退到市，再没有就省
  if (p.district) return [p.city || p.province, p.district].filter(Boolean).join(' · ');
  return p.city || p.province || p.country;
}

module.exports = { loadChina, buildRegion, splitRegion, MAX_LEN, TTL_MS, parseRegion, regionFull, regionShort };
