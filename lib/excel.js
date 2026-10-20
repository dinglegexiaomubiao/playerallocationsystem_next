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

/* ==========================================================================
 * 单赛事整包（多 sheet）：赛事信息 / 报名名单 / 队伍与成员 / 赛程对阵
 *
 * 和全局赛事导出的区别：全局导出是「一行一个赛季」，只管 tournaments 表；
 * 整包是把**一个赛事下面的全部数据**装进一个工作簿，可以整包带走、整包搬回来。
 *
 * 导入语义是「合并」：同名的更新、没有的新增，库里多出来的不动。
 * 所以留空的格子不会清空线上数据（服务端用 COALESCE 兜的），改一格就传一格。
 * ========================================================================== */

export const PACKAGE_SHEET_NAMES = {
  info: '赛事信息',
  signups: '报名名单',
  teams: '队伍与成员',
  matches: '赛程对阵',
};

// 表名容错：用户可能把 sheet 改名成「报名」「队伍」「赛程」之类
const PACKAGE_SHEET_ALIASES = {
  info: ['赛事信息', '赛事', '赛事资料', '基本信息'],
  signups: ['报名名单', '报名', '参赛选手', '报名选手'],
  teams: ['队伍与成员', '队伍', '战队', '队伍名单', '参赛队伍'],
  matches: ['赛程对阵', '赛程与对阵', '赛程', '对阵', '比赛'],
};

const normSheet = (s) =>
  String(s || '')
    .replace(/[\s　]+/g, '')
    .replace(/[（）()【】[\]]/g, '')
    .toLowerCase();

/** 把实际 sheet 名映射到 info/signups/teams/matches，认不出来返回 null */
export function resolveSheetRole(rawName) {
  const k = normSheet(rawName);
  if (!k) return null;
  for (const [role, names] of Object.entries(PACKAGE_SHEET_ALIASES)) {
    if (names.some((n) => normSheet(n) === k)) return role;
  }
  // 带前后缀的情况，如「队伍与成员(第十届)」
  for (const [role, names] of Object.entries(PACKAGE_SHEET_ALIASES)) {
    if (names.some((n) => normSheet(n).length >= 2 && k.includes(normSheet(n)))) return role;
  }
  return null;
}

export const PACKAGE_INFO_COLUMNS = [
  { key: 'name', label: '赛季名称' },
  { key: 'status', label: '比赛状态', get: (r) => statusLabel(r.status) },
  { key: 'start_date', label: '开始日期', type: 'date', get: (r) => dateOnly(r.start_date) },
  { key: 'end_date', label: '结束日期', type: 'date', get: (r) => dateOnly(r.end_date) },
  { key: 'sponsor_info', label: '赞助信息' },
  { key: 'champion_prize', label: '冠军奖金' },
  { key: 'runner_up_prize', label: '亚军奖金' },
];

export const PACKAGE_SIGNUP_COLUMNS = [
  { key: 'nickname', label: '昵称' },
  { key: 'game_id', label: 'steamID', get: (r) => (r.game_id == null ? '' : String(r.game_id)) },
  { key: 'score', label: '天梯分', get: (r) => (r.score == null ? '' : r.score) },
  { key: 'positions', label: '擅长位置' },
  { key: 'region', label: '所处地区' },
  { key: 'is_captain', label: '是否队长', get: (r) => (r.is_captain ? '是' : '') },
];

// 一行一个人：队伍没有队员时单独占一行（队员列为空），这样空队也能建出来
export const PACKAGE_TEAM_COLUMNS = [
  { key: 'team_name', label: '队伍名称' },
  { key: 'rank', label: '名次', get: (r) => (r.rank == null ? '' : r.rank) },
  { key: 'nickname', label: '队员昵称' },
  { key: 'game_id', label: 'steamID' },
  { key: 'position', label: '担任位置' },
  { key: 'is_captain', label: '是否队长' },
];

export const PACKAGE_MATCH_COLUMNS = [
  { key: 'round_name', label: '轮次' },
  { key: 'team_a_name', label: 'A队' },
  { key: 'team_b_name', label: 'B队' },
  { key: 'team_a_score', label: 'A比分' },
  { key: 'team_b_score', label: 'B比分' },
  { key: 'winner_name', label: '胜者' },
  { key: 'note', label: '备注' },
];

export const PACKAGE_FIELD_ALIASES = {
  info: {
    name: ['赛季名称', '赛事名称', '赛季', '赛事', '名称'],
    status: ['比赛状态', '状态', '赛程状态'],
    start_date: ['开始日期', '开始时间', '开赛日期'],
    end_date: ['结束日期', '结束时间', '完赛日期'],
    sponsor_info: ['赞助信息', '赞助商', '赞助'],
    champion_prize: ['冠军奖金', '冠军奖励', '冠军奖品'],
    runner_up_prize: ['亚军奖金', '亚军奖励', '亚军奖品'],
  },
  signups: {
    nickname: ['昵称', '选手昵称', '群昵称', '选手', '姓名'],
    game_id: ['steamID', 'steamid', 'steam_id', 'steam账号', '好友码'],
    score: ['天梯分', '分数', '积分'],
    positions: ['擅长位置', '位置', '担任位置'],
    region: ['所处地区', '地区', '所在地区'],
    is_captain: ['是否队长', '队长'],
  },
  teams: {
    team_name: ['队伍名称', '队伍', '队名', '战队名称', '战队'],
    rank: ['名次', '排名', '成绩'],
    nickname: ['队员昵称', '昵称', '队员', '选手'],
    game_id: ['steamID', 'steamid', 'steam_id', '好友码'],
    position: ['担任位置', '位置', '队内位置'],
    is_captain: ['是否队长', '队长'],
  },
  matches: {
    round_name: ['轮次', '阶段', '赛程阶段', '轮'],
    team_a_name: ['A队', '队伍A', '主队', '左侧队伍'],
    team_b_name: ['B队', '队伍B', '客队', '右侧队伍'],
    team_a_score: ['A比分', '主队比分', '比分A'],
    team_b_score: ['B比分', '客队比分', '比分B'],
    winner_name: ['胜者', '获胜队伍', '胜方'],
    note: ['备注', '说明'],
  },
};

/**
 * 把单赛事草稿快照整理成 4 个 sheet 的数据。
 * 入参就是 /admin/tournaments/[id] 里的 draft 结构。
 * gameIdOf(playerId)：可选的 player_id → steamID 查询函数。draft 里的队伍成员
 * 没带 steamID，导出时补上，导入时才能按 SteamID 精确定位（昵称可能重名）。
 */
export function packageRowsFromDraft(draft, gameIdOf) {
  const d = draft || {};
  const info = d.info || {};
  const gid = (pid) => (gameIdOf ? String(gameIdOf(pid) || '') : '');
  const rounds = d.rounds || [];
  const roundName = (rid) => {
    const r = rounds.find((x) => String(x.id) === String(rid));
    return r ? r.name || '' : '';
  };

  const signups = (d.signups || []).map((s) => ({ ...s, game_id: s.game_id || gid(s.player_id) }));

  const teamRows = [];
  (d.teams || []).forEach((t) => {
    const base = { team_name: t.name || '', rank: t.rank == null ? '' : t.rank };
    const members = t.members || [];
    if (members.length === 0) {
      teamRows.push({ ...base, nickname: '', game_id: '', position: '', is_captain: '' });
      return;
    }
    members.forEach((m) => {
      teamRows.push({
        ...base,
        nickname: m.nickname || '',
        game_id: gid(m.player_id),
        position: m.position || '',
        is_captain: String(m.player_id) === String(t.captain_id) ? '是' : '',
      });
    });
  });

  const matchRows = (d.matches || []).map((m) => {
    let winner = '';
    if (m.winner_team_id) {
      if (String(m.winner_team_id) === String(m.team_a_id)) winner = m.team_a_name;
      else if (String(m.winner_team_id) === String(m.team_b_id)) winner = m.team_b_name;
    }
    return {
      round_name: roundName(m.round_id),
      team_a_name: m.team_a_name || '',
      team_b_name: m.team_b_name || '',
      team_a_score: m.team_a_score === '' || m.team_a_score == null ? '' : m.team_a_score,
      team_b_score: m.team_b_score === '' || m.team_b_score == null ? '' : m.team_b_score,
      winner_name: winner,
      note: m.note || '',
    };
  });

  return {
    info: [info],
    signups,
    teams: teamRows,
    matches: matchRows,
  };
}

// 把一组 sheet 导出成 .xlsx
export function exportSheets(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const data = (s.rows || []).map((r) => {
      const o = {};
      s.columns.forEach((c) => {
        o[c.label] = cell(c.get ? c.get(r) : r[c.key]);
      });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data, { header: s.columns.map((c) => c.label) });
    ws['!cols'] = s.columns.map((c) => ({ wch: c.wch || 16 }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  });
  XLSX.writeFile(wb, filename);
}

// 多 sheet 模板：每个 sheet 只有表头，末页附说明
export function templateSheets(sheets, filename, notes) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const ws = XLSX.utils.aoa_to_sheet([s.columns.map((c) => c.label)]);
    ws['!cols'] = s.columns.map((c) => ({ wch: c.wch || 16 }));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  });
  if (notes && notes.length) {
    const ws = XLSX.utils.aoa_to_sheet([['说明'], ...notes.map((n) => [n])]);
    ws['!cols'] = [{ wch: 96 }];
    XLSX.utils.book_append_sheet(wb, ws, '填写说明');
  }
  XLSX.writeFile(wb, filename);
}

/**
 * 读取整包工作簿，返回 { info, signups, teams, matches } 四组原始行（中文列名为 key）。
 * 认不出的 sheet 直接忽略（比如模板里的「填写说明」）。
 */
export async function readPackageWorkbook(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const out = { info: [], signups: [], teams: [], matches: [], found: [] };

  wb.SheetNames.forEach((name) => {
    const role = resolveSheetRole(name);
    if (!role) return;
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (rows.length === 0) return;
    out.found.push(role);
    if (role === 'info') {
      // 赛事信息只取第一行非空数据
      const first = rows.find((r) => Object.values(r).some((v) => String(v).trim() !== ''));
      if (first) out.info.push(first);
    } else {
      out[role] = out[role].concat(rows);
    }
  });

  return out;
}

const boolish = (v) => {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  return /^(是|有|对|true|yes|y|1|√|✓)$/i.test(s);
};

/**
 * 把整包原始行规范化成要 POST 给服务端的结构，并做行级校验。
 * 返回的 errors 里带 excelRow（用户看到的行号，表头占第 1 行）。
 */
export function buildPackagePayload(raw) {
  const src = raw || {};
  const errors = [];

  // ---- 赛事信息 ----
  let info = null;
  if (src.info && src.info.length > 0) {
    const r = src.info[0];
    const A = PACKAGE_FIELD_ALIASES.info;
    const statusRaw = String(pickAlias(r, A.status) || '').trim();
    let status = '';
    if (statusRaw) {
      const v = statusValue(statusRaw);
      if (v === null) {
        errors.push({ sheet: '赛事信息', excelRow: 2, name: '', error: `比赛状态「${statusRaw}」无法识别` });
      } else if (v) {
        status = v;
      }
    }
    info = {
      name: String(pickAlias(r, A.name) || '').trim() || null,
      status: status || null,
      start_date: parseDateCell(pickAlias(r, A.start_date)),
      end_date: parseDateCell(pickAlias(r, A.end_date)),
      sponsor_info: String(pickAlias(r, A.sponsor_info) || '').trim() || null,
      champion_prize: String(pickAlias(r, A.champion_prize) || '').trim() || null,
      runner_up_prize: String(pickAlias(r, A.runner_up_prize) || '').trim() || null,
    };
    if (Object.values(info).every((v) => v === null)) info = null;
  }

  // ---- 报名名单 ----
  const SA = PACKAGE_FIELD_ALIASES.signups;
  const signups = [];
  (src.signups || []).forEach((r, i) => {
    const excelRow = i + 2;
    const nickname = String(pickAlias(r, SA.nickname) || '').trim();
    const game_id = String(pickAlias(r, SA.game_id) || '').trim();
    const scoreRaw = pickAlias(r, SA.score);
    const score = scoreRaw === '' || scoreRaw === null || scoreRaw === undefined ? null : Number(scoreRaw);

    if (!nickname && !game_id) {
      errors.push({ sheet: '报名名单', excelRow, name: '', error: '昵称和 steamID 至少填一个' });
      return;
    }
    if (score !== null && !Number.isFinite(score)) {
      errors.push({ sheet: '报名名单', excelRow, name: nickname, error: `天梯分「${scoreRaw}」不是数字` });
      return;
    }
    signups.push({
      excelRow,
      nickname,
      game_id,
      score: score === null ? null : Math.round(score),
      positions: String(pickAlias(r, SA.positions) || '').trim() || null,
      region: String(pickAlias(r, SA.region) || '').trim() || null,
      is_captain: boolish(pickAlias(r, SA.is_captain)),
    });
  });

  // ---- 队伍与成员 ----
  const TA = PACKAGE_FIELD_ALIASES.teams;
  const teams = [];
  (src.teams || []).forEach((r, i) => {
    const excelRow = i + 2;
    const team_name = String(pickAlias(r, TA.team_name) || '').trim();
    const nickname = String(pickAlias(r, TA.nickname) || '').trim();
    const game_id = String(pickAlias(r, TA.game_id) || '').trim();
    const rankRaw = pickAlias(r, TA.rank);
    const rank = rankRaw === '' || rankRaw === null || rankRaw === undefined ? null : Number(rankRaw);

    if (!team_name) {
      errors.push({ sheet: '队伍与成员', excelRow, name: nickname, error: '缺少队伍名称' });
      return;
    }
    if (rank !== null && !Number.isFinite(rank)) {
      errors.push({ sheet: '队伍与成员', excelRow, name: team_name, error: `名次「${rankRaw}」不是数字` });
      return;
    }
    teams.push({
      excelRow,
      team_name,
      rank: rank === null ? null : Math.round(rank),
      nickname,
      game_id,
      position: String(pickAlias(r, TA.position) || '').trim() || null,
      is_captain: boolish(pickAlias(r, TA.is_captain)),
    });
  });

  // ---- 赛程对阵 ----
  const MA = PACKAGE_FIELD_ALIASES.matches;
  const matches = [];
  (src.matches || []).forEach((r, i) => {
    const excelRow = i + 2;
    const team_a_name = String(pickAlias(r, MA.team_a_name) || '').trim();
    const team_b_name = String(pickAlias(r, MA.team_b_name) || '').trim();
    if (!team_a_name || !team_b_name) {
      errors.push({ sheet: '赛程对阵', excelRow, name: `${team_a_name || '?'} vs ${team_b_name || '?'}`, error: 'A队和B队都要填' });
      return;
    }
    const numOrNull = (v) => {
      const s = String(v == null ? '' : v).trim();
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) ? Math.round(n) : NaN;
    };
    const a = numOrNull(pickAlias(r, MA.team_a_score));
    const b = numOrNull(pickAlias(r, MA.team_b_score));
    if (Number.isNaN(a) || Number.isNaN(b)) {
      errors.push({ sheet: '赛程对阵', excelRow, name: `${team_a_name} vs ${team_b_name}`, error: '比分不是数字' });
      return;
    }
    matches.push({
      excelRow,
      round_name: String(pickAlias(r, MA.round_name) || '').trim() || null,
      team_a_name,
      team_b_name,
      team_a_score: a,
      team_b_score: b,
      winner_name: String(pickAlias(r, MA.winner_name) || '').trim() || null,
      note: String(pickAlias(r, MA.note) || '').trim() || null,
    });
  });

  return { info, signups, teams, matches, errors };
}

