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
];

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
