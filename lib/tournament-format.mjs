/**
 * 赛事名次 / 状态的展示口径（唯一来源）
 * 个人信息页、我的赛事、赛事信息页都用这一份，避免「冠军」和「第 1 名」两种说法混用。
 */

export function rankLabel(rank) {
  const n = Number(rank);
  if (n === 1) return '冠军';
  if (n === 2) return '亚军';
  if (n === 3) return '季军';
  if (n > 3) return '第 ' + n + ' 名';
  return '参赛';
}

export function rankCls(rank) {
  const n = Number(rank);
  if (n === 1) return 'rank-gold';
  if (n === 2) return 'rank-silver';
  if (n === 3) return 'rank-bronze';
  return 'rank-plain';
}

export const TOURNAMENT_STATUS = {
  planning: '筹办中',
  ongoing: '进行中',
  elimination: '淘汰赛',
  semifinal: '半决赛',
  final: '决赛',
  finished: '已完赛',
  postponed: '延期',
  // 历史数据里的旧枚举
  planned: '筹备中',
  active: '进行中',
  done: '已结束',
};

export function statusLabel(s) {
  return TOURNAMENT_STATUS[s] || s || '—';
}

// 报名状态
export const SIGNUP_STATUS = {
  pending: '待审核',
  approved: '已通过',
  rejected: '未通过',
  withdrawn: '已退出',
};

export function signupLabel(s) {
  return SIGNUP_STATUS[s] || '已报名';
}

/**
 * 把两份「我的赛事」数据合并成一张表。
 *
 * 因为历史原因，同一件事散在两个接口里：
 *   - /api/profile        → getPlayerTournaments：给了我名次、担任位置、队伍快照
 *   - /api/my-tournaments → 给了是否队长、报名状态、报名时间、当前所在队伍
 * 任何一个来源单独渲染都会缺字段，所以统一按 tournament_id 合并，
 * 两端结构略有差异（teams 数组 vs team_name 字符串）也在这里抹平。
 */
export function mergeMyTournaments(rankRows = [], signupRows = [], sortBy = 'time') {
  const map = new Map();

  const ensure = (id) => {
    const key = String(id);
    if (!map.has(key)) {
      map.set(key, {
        tournament_id: key,
        name: '未命名赛事',
        status: null,
        rank: null,
        position: null,
        teams: [],
        isCaptain: false,
        signupStatus: null,
        signedAt: null,
        start_date: null,
      });
    }
    return map.get(key);
  };

  for (const r of rankRows || []) {
    if (r.tournament_id === null || r.tournament_id === undefined) continue;
    const it = ensure(r.tournament_id);
    it.name = r.tournament_name || it.name;
    it.status = r.tournament_status || it.status;
    if (r.team_rank !== null && r.team_rank !== undefined) it.rank = Number(r.team_rank);
    if (r.my_position) it.position = r.my_position;
    if (r.team_name && !it.teams.includes(r.team_name)) it.teams.push(r.team_name);
    if (r.start_date) it.start_date = r.start_date;
  }

  for (const s of signupRows || []) {
    if (s.tournament_id === null || s.tournament_id === undefined) continue;
    const it = ensure(s.tournament_id);
    it.name = s.tournament_name || it.name;
    it.status = s.tournament_status || it.status;
    it.isCaptain = s.is_captain === true;
    it.signupStatus = s.signup_status || null;
    it.signedAt = s.signed_at || null;
    if (s.start_date) it.start_date = it.start_date || s.start_date;
    for (const t of s.teams || []) {
      if (t && t.name && !it.teams.includes(t.name)) it.teams.push(t.name);
    }
  }

  // 已报名/进行中的排前面，其次按开赛时间倒序（默认 time）
  return sortTournamentsBy([...map.values()], sortBy);
}

/* ----------------------------------------------------------------------------
 * 赛事记录排序（群友信息 / 个人信息的「我的赛事」共用）
 *
 * sortBy:
 *  - 'time'（默认）：已完赛排最后，其余按「开赛时间」倒序（最新在上）
 *  - 'rank'：按名次升序（冠军→亚军→季军→…→参赛→无名次沉底），并列按开赛时间倒序
 *
 * 两条数据源字段名不一致，这里统一抹平：
 *  - 群友信息的 records：start_date / team_rank / tournament_status
 *  - 个人信息的 tournaments：start_date / rank / status
 * -------------------------------------------------------------------------- */
function recRank(r) {
  const n =
    r.team_rank !== undefined && r.team_rank !== null
      ? Number(r.team_rank)
      : r.rank !== undefined && r.rank !== null
        ? Number(r.rank)
        : null;
  return Number.isFinite(n) ? n : null;
}
function recDate(r) {
  if (!r) return '';
  const v = r.start_date || r.signedAt;
  if (!v) return '';
  // start_date 在 records 里是 timestamptz 解析出的 Date 对象，
  // 直接 String(Date) 会变成「Tue Jun 07 2026…」这种星期开头的串，
  // localeCompare 会按星期名排而非按日期排 → 乱序。统一归一成本地 YYYY-MM-DD。
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v);
}
function recFinished(r) {
  const s = r.tournament_status || r.status;
  return s === 'finished' || s === 'done';
}
function cmpDateDesc(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1; // 空日期沉底
  if (!b) return -1;
  return b.localeCompare(a); // ISO 字符串倒序 = 最新在上
}

export function sortTournamentsBy(items = [], sortBy = 'time') {
  const arr = [...items];
  if (sortBy === 'rank') {
    arr.sort((a, b) => {
      const ra = recRank(a);
      const rb = recRank(b);
      const da = recDate(a);
      const db = recDate(b);
      if (ra == null && rb == null) return cmpDateDesc(da, db);
      if (ra == null) return 1;
      if (rb == null) return -1;
      if (ra !== rb) return ra - rb;
      return cmpDateDesc(da, db);
    });
  } else {
    arr.sort((a, b) => {
      const wa = recFinished(a) ? 1 : 0;
      const wb = recFinished(b) ? 1 : 0;
      if (wa !== wb) return wa - wb;
      return cmpDateDesc(recDate(a), recDate(b));
    });
  }
  return arr;
}

/**
 * 状态归组：筛选只按「筹备 / 进行 / 结束」三档，不把 elimination/final
 * 这些阶段当成独立筛选项 —— 用户筛的是「我还能不能报名」，
 * 至于是淘汰赛还是决赛，那是赛事内部的细节。
 *
 * 历史数据混用 planned/active/done 与 planning/ongoing/finished，这里统一。
 */
export function statusGroup(status) {
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

export const STATUS_GROUP_LABEL = {
  planning: '筹备中',
  live: '进行中',
  finished: '已结束',
};

