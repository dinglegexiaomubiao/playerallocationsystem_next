/**
 * 地区（国 / 省 / 市 / 区）的唯一解析层。
 *
 * 存储方案：**继续用 `players.region` 这一个 varchar(50) 列**，存空格分隔的路径，
 * 比如 `中国 广东省 深圳市 南山区`。三个理由：
 *  1. `players` 表本来就有列漂移的历史（db.js 建表写了线上老库没有的列），加列要写
 *     幂等迁移，收益不抵风险；
 *  2. 老的自由文本（`南山`、`龙华，深圳，china`）天然还能读，不会因为上线把历史数据
 *     变成空白；
 *  3. 查询/导出/Excel 都不用改口径。
 *
 * 表里存的 4 段是**定长**的：`国 省 市 区`。直辖市会出现省市同名
 * （`中国 北京市 北京市 朝阳区`），这是故意的 —— 保证 parse 无损、可逆；
 * 展示时由 `regionFull` / `regionShort` 去重压缩。
 *
 * 这里只有纯函数，不 import 任何数据文件：行政区划 JSON 在 `public/data/` 下
 * 按需 fetch（见 components/RegionPicker.js），免得 60KB 数据进 JS bundle。
 */

export const DEFAULT_COUNTRY = '中国';
export const SHENZHEN_PROVINCE = '广东省';
export const SHENZHEN_CITY = '深圳市';

/**
 * 深圳的行政区（去掉「区」后缀做匹配用）。
 * 社区在深圳，历史上有人只写了区名（`南山`、`龙岗`），这类也要认成深圳。
 */
const SHENZHEN_DISTRICT_KEYS = new Set([
  '罗湖', '福田', '南山', '宝安', '龙岗', '盐田', '龙华', '坪山', '光明',
  // 不是行政区但有实际意义的两块飞地 / 新区
  '大鹏', '深汕',
]);

const stripRegionSuffix = (s) =>
  String(s || '')
    .replace(/(特别合作区|新区|自治县|自治州|自治区|特别行政区|地区|林区|盟|市辖区|区|县|市|省|旗)$/u, '')
    .trim();

/** 老数据里常见的分隔符（中英文逗号、顿号、斜杠、竖线、连续空格）统一按分隔处理 */
const splitTokens = (text) =>
  String(text || '')
    .trim()
    .split(/[\s,，、/|；;]+/u)
    .filter(Boolean);

/**
 * 解析地区字符串。
 * @returns {{country:string, province:string, city:string, district:string,
 *            structured:boolean, foreign:boolean, raw:string}}
 *   structured=false 表示是老的自由文本，四段都可能为空，原值在 raw 里。
 */
export function parseRegion(text) {
  const raw = String(text || '').trim();
  const empty = { country: '', province: '', city: '', district: '', structured: false, foreign: false, raw };
  if (!raw) return empty;

  // 老文本里带逗号顿号的一律当成非结构化（`龙华，深圳，china`）
  const hasLegacySeparator = /[，,、/|；;]/u.test(raw);
  const tokens = raw.split(/\s+/u).filter(Boolean);

  if (!hasLegacySeparator && tokens[0] === DEFAULT_COUNTRY) {
    return {
      country: DEFAULT_COUNTRY,
      province: tokens[1] || '',
      city: tokens[2] || '',
      district: tokens[3] || '',
      structured: true,
      foreign: false,
      raw,
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
      raw,
    };
  }

  return empty;
}

/**
 * 拼成入库字符串。中国固定 4 段（空段跳过），其他国家是 `国 城市`。
 * 上限 50 字符，与 `players.region` 的 varchar(50) 对齐。
 */
export function formatRegion(parts = {}) {
  const country = String(parts.country || '').trim();
  if (!country) return '';

  if (country !== DEFAULT_COUNTRY) {
    return [country, String(parts.city || parts.province || '').trim()]
      .filter(Boolean)
      .join(' ')
      .slice(0, 50);
  }

  return [DEFAULT_COUNTRY, parts.province, parts.city, parts.district]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 50);
}

/** 完整展示（省市同名时只留一个）：`中国 北京市 朝阳区` */
export function regionFull(text) {
  const p = parseRegion(text);
  if (!p.raw) return '';
  if (!p.structured) return p.raw;

  const parts = [p.country, p.province, p.city, p.district].filter(Boolean);
  const dedup = parts.filter((v, i) => v !== parts[i - 1]);
  return dedup.join(' ');
}

/**
 * 紧凑展示（群友卡片用）：`深圳市 · 南山区` / `日本 · 东京都`。
 * 只到市+区，因为卡片宽度有限，完整路径放 title 里。
 */
export function regionShort(text) {
  const p = parseRegion(text);
  if (!p.raw) return '';
  if (!p.structured) return p.raw;

  if (p.foreign) return [p.country, p.city].filter(Boolean).join(' · ');

  // 有区就「市 · 区」；没有区就退到市，再没有就省
  if (p.district) return [p.city || p.province, p.district].filter(Boolean).join(' · ');
  return p.city || p.province || p.country;
}

export function regionIsEmpty(text) {
  const p = parseRegion(text);
  return !p.raw;
}

/**
 * 是否在深圳。
 *
 * 判据顺序很重要：先看有没有明确写了**别的**城市，写了就不算深圳 ——
 * 否则 `中国 黑龙江省 鹤岗市 南山区` 会因为区名撞上深圳的南山区被误判。
 */
export function isShenzhen(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;

  const tokens = splitTokens(raw);

  // 「市 / 州 / 地区 / 盟」结尾的 token 视为城市级
  const cityTokens = tokens.filter((t) => /(市|自治州|地区|盟)$/u.test(t));
  if (cityTokens.length > 0 && !cityTokens.includes(SHENZHEN_CITY)) return false;

  if (raw.includes('深圳')) return true;

  // 只写了区名的情况（老数据 `南山` / `龙岗`）
  return tokens.some((t) => SHENZHEN_DISTRICT_KEYS.has(stripRegionSuffix(t)));
}

/**
 * 把老的自由文本猜成规范路径。猜不出来返回 null（调用方保留原值，别硬改）。
 *
 * @param {string} text 老值
 * @param {{china:Array}} division `public/data/china-division.json` 的内容
 */
export function guessRegionFromLegacy(text, division) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (!division || !Array.isArray(division.china)) return null;

  const p = parseRegion(raw);
  if (p.structured) return formatRegion(p);

  const lower = raw.toLowerCase();
  // `china` / `cn` / `中国` 只是注明国籍，不参与地名匹配
  const tokens = splitTokens(raw).filter((t) => !/^(china|cn|中国|中国大陆)$/i.test(t));
  if (tokens.length === 0) return null;

  const matchName = (candidate, token) => {
    if (!token) return false;
    return candidate === token || candidate.replace(/(省|市|区|县|自治区|特别行政区)$/u, '') === token;
  };

  // 先把所有 (省, 市) 对拉平，方便「只写了市」也能定位
  const flat = [];
  for (const province of division.china) {
    for (const city of province.cities) {
      flat.push({ province: province.name, city: city.name, areas: city.areas || [] });
    }
  }

  // 1) 城市名命中（含只写「深圳」这种）
  for (const token of tokens) {
    const hit = flat.filter((x) => matchName(x.city, token));
    if (hit.length === 0) continue;
    // 同名城市（如「市辖区」已在上游消歧，这里按第一个）取第一个，再找工作区
    const target = hit[0];
    const area = tokens.map((t) => target.areas.find((a) => matchName(a, t))).find(Boolean) || '';
    return formatRegion({ country: DEFAULT_COUNTRY, province: target.province, city: target.city, district: area });
  }

  // 2) 只写了区名：先在深圳找（社区在深圳，这是绝大多数情况），再全国找
  const shenzhen = flat.find((x) => x.city === SHENZHEN_CITY);
  for (const token of tokens) {
    if (shenzhen && SHENZHEN_DISTRICT_KEYS.has(stripRegionSuffix(token))) {
      const area = shenzhen.areas.find((a) => matchName(a, token)) || `${stripRegionSuffix(token)}区`;
      return formatRegion({
        country: DEFAULT_COUNTRY,
        province: shenzhen.province,
        city: shenzhen.city,
        district: area,
      });
    }
  }
  for (const token of tokens) {
    for (const x of flat) {
      const area = x.areas.find((a) => matchName(a, token));
      if (area) {
        return formatRegion({ country: DEFAULT_COUNTRY, province: x.province, city: x.city, district: area });
      }
    }
  }

  // 3) 只写了省
  for (const token of tokens) {
    const province = division.china.find((x) => matchName(x.name, token));
    if (province) return formatRegion({ country: DEFAULT_COUNTRY, province: province.name });
  }

  // 4) 实在猜不出来：只有明确带「深圳」时才兜到市一级，其余原样保留
  if (lower.includes('shenzhen') || raw.includes('深圳')) {
    return formatRegion({ country: DEFAULT_COUNTRY, province: SHENZHEN_PROVINCE, city: SHENZHEN_CITY });
  }
  return null;
}
