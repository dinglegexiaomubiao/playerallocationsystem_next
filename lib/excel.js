import * as XLSX from 'xlsx';

export const PLAYER_COLUMNS = [
  { key: 'nickname', label: '昵称' },
  { key: 'game_id', label: 'steamID' },
  { key: 'group_nickname', label: '群昵称' },
  { key: 'score', label: '天梯分' },
  { key: 'positions', label: '擅长位置' },
  { key: 'heroes', label: '擅长英雄' },
  { key: 'win_rate', label: '胜率' },
  { key: 'championships', label: '冠军数' },
  { key: 'synergy_players', label: '默契选手' },
  { key: 'region', label: '所处地区' },
  { key: 'self_intro', label: '自我评价' },
  { key: 'enemies', label: '仇人', get: (r) => cell(r.enemies) },
];

// ===== 赛事信息（tournaments）=====
//
// 状态在库里是英文 key（planning/ongoing/...），但表格里必须是人能看懂的中文，
// 所以导出走 label、导入时 label 与 key 都认。
export const TOURNAMENT_STATUS_OPTIONS = [
  { value: 'planning', label: '筹办中' },
  { value: 'ongoing', label: '进行中' },
  { value: 'elimination', label: '淘汰赛' },
  { value: 'semifinal', label: '半决赛' },
  { value: 'final', label: '决赛' },
  { value: 'finished', label: '已完赛' },
  { value: 'postponed', label: '延期' },
];

const STATUS_LABELS = Object.fromEntries(TOURNAMENT_STATUS_OPTIONS.map((s) => [s.value, s.label]));

// 库里的 key → 中文标签
export function statusLabel(v) {
  return STATUS_LABELS[v] || (v ? String(v) : '');
}

// 表格里的值 → 库里的 key（认中文标签，也认英文 key；空值返回 ''，非法值返回 null）
export function statusValue(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!s) return '';
  if (STATUS_LABELS[s]) return s;
  const hit = TOURNAMENT_STATUS_OPTIONS.find((o) => o.label === s);
  return hit ? hit.value : null;
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * 把接口返回的日期值格式化成 YYYY-MM-DD。
 *
 * ⚠ 不要用 String(v).slice(0,10)：库里的 start_date/end_date 是
 * `timestamp without time zone`，node-postgres 会把它解析成「本地零点」的 Date，
 * 序列化成 JSON 时又变成 UTC ISO，于是 +08 时区下 `2026-08-14 00:00` 会写成
 * `2026-08-13T16:00:00Z`，直接截前 10 位就少了一天。
 * 必须像站内 fmt() 那样按**本地分量**取年月日，来回才对得上。
 */
export function dateOnly(v) {
  if (v === null || v === undefined || v === '') return '';
  // 纯日期串（正好 YYYY-MM-DD）直接返回，别再经 Date 绕一圈——
  // 负时区会把 '2026-08-14' 解析成 UTC 零点再还原成本地 08-13。
  // 注意不能只判前缀：'2026-08-13T16:00:00.000Z' 也以前缀开头，
  // 那种是 UTC 时间串，必须走下面的本地转换。
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Date → YYYY-MM-DD（用本地分量：SheetJS 的 cellDates 给的是「本地零点的 UTC 表示」）
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * 把单元格里的日期解析成 YYYY-MM-DD。
 * 覆盖四种来源：
 *   1) 字符串 "2026-08-13" / "2026/8/13" / "2026年8月13日" / ISO 时间戳
 *   2) Excel 日期单元格（默认读取会变成序列号 46247）
 *   3) cellDates 模式下得到的 Date 对象
 * 解析不出来返回 null（调用方应当报错，不要静默写空）。
 */
export function parseDateCell(v) {
  if (v === null || v === undefined || v === '') return null;

  if (v instanceof Date) return isNaN(v.getTime()) ? null : fmtDate(v);

  // Excel 序列号：1899-12-30 起算，25569 是 1970-01-01 的序列号
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  const s = String(v).trim();
  if (!s) return null;

  // 先按「年-月-日」硬解，避免 new Date() 把它当成 UTC 造成跨时区偏移一天
  const m = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : fmtDate(d);
}

export const TOURNAMENT_COLUMNS = [
  { key: 'name', label: '赛季名称' },
  { key: 'status', label: '比赛状态', get: (r) => statusLabel(r.status) },
  // type: 'date' 让 ExcelIO 的预览把日期单元格（序列号）显示成 YYYY-MM-DD
  { key: 'start_date', label: '开始日期', type: 'date', get: (r) => dateOnly(r.start_date) },
  { key: 'end_date', label: '结束日期', type: 'date', get: (r) => dateOnly(r.end_date) },
  { key: 'sponsor_info', label: '赞助信息' },
  { key: 'champion_prize', label: '冠军奖金' },
  { key: 'runner_up_prize', label: '亚军奖金' },
  // 名次在库里存的是队伍 id，表格里给人看的是队名；导入时按队名反查
  { key: 'champion_team_name', label: '冠军队伍', get: (r) => r.champion_team_name || '' },
  { key: 'runner_up_team_name', label: '亚军队伍', get: (r) => r.runner_up_team_name || '' },
  { key: 'third_place_team_name', label: '季军队伍', get: (r) => r.third_place_team_name || '' },
];

// 导入时的列名别名（兼容手改表头）
export const TOURNAMENT_FIELD_ALIASES = {
  name: ['赛季名称', '赛事名称', '赛季', '赛事', '名称', '届次'],
  status: ['比赛状态', '状态', '赛程状态'],
  start_date: ['开始日期', '开始时间', '开赛日期', '开赛时间', '起始日期'],
  end_date: ['结束日期', '结束时间', '完赛日期', '完赛时间', '截止日期'],
  sponsor_info: ['赞助信息', '赞助商', '赞助', '赞助内容'],
  champion_prize: ['冠军奖金', '冠军奖励', '冠军奖品'],
  runner_up_prize: ['亚军奖金', '亚军奖励', '亚军奖品'],
  champion_team_name: ['冠军队伍', '冠军', '冠军战队'],
  runner_up_team_name: ['亚军队伍', '亚军', '亚军战队'],
  third_place_team_name: ['季军队伍', '季军', '季军战队'],
};

export const FOOD_COLUMNS = [
  { key: 'name', label: '店名' },
  { key: 'cuisine', label: '菜系' },
  { key: 'area', label: '区位' },
  { key: 'address', label: '详细地址' },
  { key: 'feature', label: '特点' },
  { key: 'recommender', label: '推荐人' },
  { key: 'avg_price', label: '美团人均' },
  { key: 'rating', label: '评分' },
  { key: 'nearby', label: '附近娱乐' },
  // 导出时由 reviews 子表拼装；导入时从「群友饭后评价」列读入
  { key: 'review_text', label: '群友饭后评价', get: (r) => reviewText(r.reviews) },
];

// 群友评价在单个单元格内用换行分隔多条，导出时还原成同样格式
export function reviewText(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) return '';
  return reviews.map((v) => (v.reviewer ? v.reviewer + '：' : '') + (v.content || '')).join('\n');
}

/**
 * 解析「群友饭后评价」单元格。
 * 支持一个单元格内多行、每行「署名：正文」或纯正文；
 * 无署名的行若紧跟在有署名的行之后，视为同一人对上一条的续写（合并），
 * 否则作为独立的无署名评价。
 * 返回 [{ reviewer, content }]
 */
export function parseReviews(raw) {
  const text = raw === null || raw === undefined ? '' : String(raw);
  if (!text.trim()) return [];

  const out = [];
  for (const line of text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    // 署名：1~12 个非空白非标点字符 + 半角/全角冒号
    const m = line.match(/^([^\s:：，,。；;！!？?]{1,12})\s*[:：]\s*(.+)$/);
    if (m) {
      out.push({
        reviewer: m[1].replace(/(评价|点评|推荐|觉得|说)$/, '').trim(),
        content: m[2].trim(),
      });
    } else if (out.length > 0 && out[out.length - 1].reviewer) {
      out[out.length - 1].content += ' ' + line;
    } else {
      out.push({ reviewer: '', content: line });
    }
  }

  return out
    .map((r) => ({
      reviewer: r.reviewer,
      content: r.content.replace(/^["“'‘]+|["”'’]+$/g, '').trim(),
    }))
    .filter((r) => r.content);
}

// 按候选列名依次取值，兼容不同来源表格的表头差异
export function pickAlias(row, aliases) {
  if (!row) return '';
  for (const k of aliases) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

function cell(v) {
  if (Array.isArray(v)) return v.join('，');
  return v === null || v === undefined ? '' : v;
}


// 导出为 .xlsx 并触发下载
export function exportRows(rows, columns, filename, sheetName = 'Sheet1') {
  const data = rows.map((r) => {
    const o = {};
    columns.forEach((c) => {
      o[c.label] = cell(c.get ? c.get(r) : r[c.key]);
    });
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: columns.map((c) => c.label) });
  ws['!cols'] = columns.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

// 下载只有表头的空白模板
export function downloadTemplate(columns, filename) {
  const ws = XLSX.utils.aoa_to_sheet([columns.map((c) => c.label)]);
  ws['!cols'] = columns.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '模板');
  XLSX.writeFile(wb, filename);
}

// 读取上传的 Excel/CSV，返回按表头（中文列名）为 key 的对象数组
export async function readRows(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

// 把「A，B、C」这类字符串拆成数组
export function splitList(v) {
  if (Array.isArray(v)) return v;
  return String(v || '')
    .split(/[，,、\/;；|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
