// 赛事详情：概览 / 赛程与对阵 / 参赛队伍 / 报名名单 + 报名与退赛。
//
// 对齐网页端 pages/tournaments/[id].js 的四个 Tab，数据来自四批接口：
//   GET /api/tournaments/{id}            赛事本体 + 名次 + 队伍 + 报名名单
//   GET /api/tournaments/{id}/matches    轮次 + 对阵 + 逐局十人数据（dota_players）
//   GET /api/tournaments/{id}/signup     我的报名状态 + 档案预填值（匿名也能调）
//   GET /api/teams?tournament_id=        各队阵容（带位置 / 天梯分 / 队长）
//
// 为什么队伍要单独再拉一次 /api/teams：tournaments/{id} 里的 members 只有
// 昵称和 position（实测 position 全是 null），没有位置和分数，看起来就是「一队五个名字」。
// 网页端的 TeamTable 用的就是 /api/teams，小程序跟着用同一份，两边数字才对得上。
//
// 赛程接口失败不该拖垮整页，所以单独 catch 成空；报名状态、队伍阵容同理。
const { request, getBase } = require('../../utils/api');
const { fullUrl, fmtMonthDay, tourStatusText, tourStatusGroup } = require('../../utils/format');

const PLACE_LABEL = { 1: '冠军', 2: '亚军', 3: '季军' };
// 报名名单一次最多先渲染这么多条，剩下的点「展开全部」。
// 不是分页 —— 51 条一次 setData 也不算大，但首屏没必要等它。
const SIGNUP_PREVIEW = 8;
// 概览里的「赛果」只放最后一轮的前几局，全放会和「赛程」Tab 重复
const RECENT_PREVIEW = 3;

const toast = (t) => wx.showToast({ title: t, icon: 'none' });

function confirmBox(title, content, okText) {
  return new Promise((resolve) => {
    wx.showModal({
      title: title,
      content: content,
      confirmText: okText || '确定',
      confirmColor: '#b02b25',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false)
    });
  });
}

function placeLabel(n) {
  return PLACE_LABEL[n] || '第 ' + n + ' 名';
}

// positions 在库里是 '优势路,中单' 这种逗号串（也可能已经是数组），展示成 '优势路/中单'
function posList(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  return arr
    .map((x) => String(x).trim())
    .filter(Boolean);
}

function positionsText(v) {
  return posList(v).join('·');
}

function matchStatusText(s) {
  if (s === 'finished' || s === 'done') return '已结束';
  if (s === 'ongoing' || s === 'live') return '进行中';
  return '未开始';
}

/** 秒 → 41:55 */
function fmtDuration(sec) {
  const s = Number(sec) || 0;
  if (!s) return '';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m + ':' + (r < 10 ? '0' + r : String(r));
}

/** ISO → 10-17 14:46（年份对单届赛事没意义） */
function fmtClock(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** 净经济 / 伤害：18436 → 18.4k */
function fmtK(n) {
  const v = Number(n) || 0;
  if (!v) return '';
  return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v);
}

/**
 * 单局里的一个选手，压成页面要渲染的字段。
 * 装备只留前 6 个（第 7 格是中立道具，网页端也没在主行里显示全）。
 */
function normalizePlayer(p, base) {
  const kdaMissing = p.kills === null || p.kills === undefined;
  const items = Array.isArray(p.items) ? p.items : [];
  return {
    key: String(p.player_id || p.account_id || ''),
    playerId: String(p.player_id || ''),
    name: p.group_nickname || p.nickname || p.account_id || '未知',
    heroName: p.hero_name || '',
    heroIcon: p.hero_slug ? fullUrl(base, '/api/hero-icon/' + p.hero_slug) : '',
    avatar: p.player_id ? fullUrl(base, '/api/avatar/' + p.player_id) : '',
    kdaText: kdaMissing ? '—' : p.kills + '/' + p.deaths + '/' + p.assists,
    nwText: fmtK(p.net_worth) || '—',
    dmgText: fmtK(p.hero_damage) || '—',
    gpm: Number(p.gpm) || 0,
    standin: !!p.is_standin,
    aghs: !!p.aghanims_scepter,
    shard: !!p.aghanims_shard,
    items: items.slice(0, 6).map((it) => ({
      key: String(it.id),
      icon: it.slug ? fullUrl(base, '/api/item-icon/' + it.slug) : ''
    })),
    // 有经济或 KDA 才算「这局回放解析过」，否则只能显示英雄和昵称
    parsed: (Number(p.net_worth) || 0) > 0 || !kdaMissing
  };
}

/** 一局对阵的骨架（阵容先不放进来，点开再填，见 expandMatch） */
function normalizeMatch(m, roundName, base) {
  const aScore = m.team_a_score;
  const bScore = m.team_b_score;
  const hasScore = aScore !== null && aScore !== undefined && bScore !== null && bScore !== undefined;
  const list = Array.isArray(m.dota_players) ? m.dota_players : [];
  const parsed = list.some((p) => (Number(p.net_worth) || 0) > 0 || p.kills !== null);
  const sum = (arr, f) => arr.reduce((s, x) => s + (Number(x[f]) || 0), 0);
  const radiant = list.filter((p) => p.is_radiant);
  const dire = list.filter((p) => !p.is_radiant);

  return {
    key: String(m.id),
    mid: String(m.dota_match_id || ''),
    a: m.team_a_name || '待定',
    b: m.team_b_name || '待定',
    aWin: !!m.winner_name && m.winner_name === m.team_a_name,
    bWin: !!m.winner_name && m.winner_name === m.team_b_name,
    scoreText: hasScore ? aScore + ' : ' + bScore : '待录入',
    winner: m.winner_name || '',
    statusText: matchStatusText(m.status),
    finished: hasScore,
    grudge: !!m.is_grudge,
    note: m.note || '',
    roundName: roundName || '',
    orderNo: Number(m.order_no) || 0,
    timeText: fmtClock(m.dota_start_time),
    durText: fmtDuration(m.dota_duration),
    parsed: parsed,
    // 两队汇总带：杀敌（优先用官方比分）+ 总经济 + 替补数
    sides: [
      {
        key: 'radiant',
        tag: '天辉',
        name: m.team_a_name || '待定',
        win: !!m.winner_name && m.winner_name === m.team_a_name,
        lose: hasScore && !!m.winner_name && m.winner_name !== m.team_a_name,
        kills: hasScore ? aScore : sum(radiant, 'kills'),
        nwText: fmtK(sum(radiant, 'net_worth')) || '0',
        standin: radiant.filter((p) => p.is_standin).length,
        count: radiant.length,
        parsed: radiant.some((p) => (Number(p.net_worth) || 0) > 0 || p.kills !== null),
        list: []
      },
      {
        key: 'dire',
        tag: '夜魇',
        name: m.team_b_name || '待定',
        win: !!m.winner_name && m.winner_name === m.team_b_name,
        lose: hasScore && !!m.winner_name && m.winner_name !== m.team_b_name,
        kills: hasScore ? bScore : sum(dire, 'kills'),
        nwText: fmtK(sum(dire, 'net_worth')) || '0',
        standin: dire.filter((p) => p.is_standin).length,
        count: dire.length,
        parsed: dire.some((p) => (Number(p.net_worth) || 0) > 0 || p.kills !== null),
        list: []
      }
    ],
    playerCount: list.length,
    open: false
  };
}

/**
 * 交手记录：matches 一行 = 一局（不是一轮），同一对手会命中多局，
 * 按对手聚合成「月月 2 胜 1 负」。与网页 TeamTable 的 buildRecords 同一口径。
 */
function buildRecords(matches) {
  const map = {};
  const add = (teamId, opponent, result) => {
    if (!teamId) return;
    const k = String(teamId);
    if (!map[k]) map[k] = {};
    const name = opponent || '待定';
    if (!map[k][name]) map[k][name] = { opponent: name, win: 0, lose: 0, pending: 0 };
    map[k][name][result] += 1;
  };
  matches.forEach((m) => {
    const a = m.team_a_id;
    const b = m.team_b_id;
    if (!a || !b) return;
    const hasWinner = m.winner_team_id !== null && m.winner_team_id !== undefined;
    const resultOf = (id) =>
      !hasWinner ? 'pending' : String(m.winner_team_id) === String(id) ? 'win' : 'lose';
    add(a, m.team_b_name, resultOf(a));
    add(b, m.team_a_name, resultOf(b));
  });
  const out = {};
  Object.keys(map).forEach((k) => {
    out[k] = Object.keys(map[k])
      .map((name) => map[k][name])
      .sort((x, y) => y.win - x.win || y.lose - x.lose);
  });
  return out;
}

// 轮次的语义顺序：库里 order_no 是分批写入的，单靠它会把决赛排到淘汰赛前面（同网页端）
const ROUND_ORDER = { 小组赛: 1, 淘汰赛: 2, 半决赛: 3, 决赛: 4 };

function roundRank(r) {
  const byName = ROUND_ORDER[r.name];
  if (byName) return byName;
  return 50;
}

Page({
  data: {
    id: '',
    loading: true,
    error: '',
    tab: 'overview',
    t: null,
    places: [],
    stats: { teamCount: 0, playerCount: 0, signupCount: 0, matchCount: 0, signedCount: 0 },
    recentItems: [],
    recentRoundName: '',
    rounds: [],
    teams: [],
    signupList: [],
    signupTotal: 0,
    showAllSignups: false,
    profileText: '',
    state: { loggedIn: false, bound: false, signedUp: false, isCaptain: false },
    busy: false
  },

  onLoad(query) {
    const id = String((query && query.id) || '');
    this.setData({ id: id });
    if (!id) {
      this.setData({ loading: false, error: '缺少赛事 id' });
      return;
    }
    this._inited = true;
    // return 出去只为让联调脚本能 await（wx 不关心生命周期返回值）
    return this.load();
  },

  // 从登录页回来要重新问一次「我报名了没」—— 登录成功后 login 页只做 navigateBack，
  // 不会通知前一页。整页重拉没必要，只刷报名状态那一个接口。
  onShow() {
    if (this._inited && !this.data.loading) return this.loadState();
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  onTab(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '');
    if (!key || key === this.data.tab) return;
    this.setData({ tab: key });
  },

  load() {
    const id = this.data.id;
    const base = getBase();
    this.setData({ loading: true, error: '' });

    const detail = () => request('/api/tournaments/' + id, null, { method: 'GET' });
    // 赛程多数赛事没编，接口返空；真出错也不该白屏
    const bracket = () =>
      request('/api/tournaments/' + id + '/matches', null, { method: 'GET' }).catch(() => ({
        rounds: [],
        matches: []
      }));
    const mine = () =>
      request('/api/tournaments/' + id + '/signup', null, { method: 'GET' }).catch(() => null);
    // 队伍阵容（位置 / 天梯分 / 队长）：拿不到就回退到 detail 里的 members
    const roster = () =>
      request('/api/teams?tournament_id=' + id, null, { method: 'GET' }).catch(() => ({ teams: [] }));

    return Promise.all([detail(), bracket(), mine(), roster()])
      .then((res) => {
        const d = res[0] || {};
        const b = res[1] || {};
        const me = res[2] || {};
        const rosterRes = res[3] || {};

        if (!d.tournament) {
          this.setData({ loading: false, error: '没找到这届赛事' });
          return;
        }
        const t = d.tournament;
        const rawMatches = Array.isArray(b.matches) ? b.matches : [];

        // ---- 名次：placements 一行一个名次（可并列）；老数据没有就回退单值字段
        let places = (Array.isArray(t.placements) ? t.placements : []).map((p) => ({
          key: String(p.place) + '-' + String(p.team_id),
          label: placeLabel(p.place),
          team: p.team_name || '',
          note: p.note || ''
        }));
        if (!places.length) {
          const legacy = [
            [1, t.champion_team_name],
            [2, t.runner_up_team_name],
            [3, t.third_place_team_name]
          ];
          places = legacy
            .filter((x) => x[1])
            .map((x) => ({ key: 'legacy-' + x[0], label: placeLabel(x[0]), team: x[1], note: '' }));
        }

        // ---- 赛程：先按轮次分组，阵容留在 this._playersByMatch（点开才 setData）
        const rawRounds = Array.isArray(b.rounds) ? b.rounds : [];
        const sortedRounds = rawRounds.slice().sort((x, y) => {
          const rx = roundRank(x);
          const ry = roundRank(y);
          if (rx !== ry) return rx - ry;
          const ox = Number(x.order_no) || 0;
          const oy = Number(y.order_no) || 0;
          if (ox !== oy) return ox - oy;
          return Number(x.id || 0) - Number(y.id || 0);
        });
        const roundNameOf = (rid) => {
          const hit = rawRounds.filter((r) => String(r.id) === String(rid))[0];
          return hit ? hit.name || '轮次' : '';
        };

        const playersByMatch = {};
        rawMatches.forEach((m) => {
          const list = Array.isArray(m.dota_players) ? m.dota_players : [];
          playersByMatch[String(m.id)] = {
            radiant: list.filter((p) => p.is_radiant).map((p) => normalizePlayer(p, base)),
            dire: list.filter((p) => !p.is_radiant).map((p) => normalizePlayer(p, base))
          };
        });
        this._playersByMatch = playersByMatch;

        const groups = {};
        const order = [];
        sortedRounds.forEach((r) => {
          const gid = String(r.id);
          groups[gid] = { id: gid, name: r.name || '轮次', items: [] };
          order.push(gid);
        });
        const loose = { id: 'none', name: '未分轮次', items: [] };

        rawMatches.forEach((m) => {
          const g = groups[String(m.round_id)] || loose;
          g.items.push(normalizeMatch(m, g.name, base));
        });
        // 同轮次内按 order_no 排，没有就按 id。注意要返回组本身（g），
        // 别返回 g.items.sort(...) —— 那个返回的是数组，下游 .filter 会读不到 .items 直接崩。
        const finish = (g) => {
          g.items.sort((x, y) => x.orderNo - y.orderNo || Number(x.key) - Number(y.key));
          return g;
        };
        const rounds = order
          .map((gid) => finish(groups[gid]))
          .concat(loose.items.length ? [finish(loose)] : [])
          .filter((g) => g.items.length > 0);

        // 概览的「赛果」= 最后一轮的前几局
        const lastRound = rounds.length ? rounds[rounds.length - 1] : null;
        const recentItems = lastRound ? lastRound.items.slice(0, RECENT_PREVIEW) : [];

        // ---- 队伍：优先 /api/teams（带位置和分数），拿不到回退 detail 的 members
        const records = buildRecords(rawMatches);
        const rosterTeams = Array.isArray(rosterRes.teams) ? rosterRes.teams : [];
        const detailTeams = Array.isArray(d.teams) ? d.teams : [];
        const source = rosterTeams.length ? rosterTeams : detailTeams;

        const teams = source.map((x) => {
          const isRich = !!x.players;
          const players = isRich
            ? x.players.map((p) => ({
                key: String(p.id),
                playerId: String(p.id),
                name: p.group_nickname || p.nickname || '未命名',
                initial: String(p.group_nickname || p.nickname || '?').charAt(0),
                avatar: fullUrl(base, '/api/avatar/' + p.id),
                positions: posList(p.positions).slice(0, 2).join('/'),
                score: Number(p.score) || 0,
                isCaptain: String(p.id) === String(x.captain_id)
              }))
            : (Array.isArray(x.members) ? x.members : []).map((mm) => ({
                key: String(mm.player_id),
                playerId: String(mm.player_id),
                name: mm.group_nickname || mm.nickname || '未命名',
                initial: String(mm.group_nickname || mm.nickname || '?').charAt(0),
                avatar: fullUrl(base, '/api/avatar/' + mm.player_id),
                positions: positionsText(mm.position),
                score: 0,
                isCaptain: String(mm.player_id) === String(x.captain_id)
              }));

          players.sort((a, b) => (b.isCaptain ? 1 : 0) - (a.isCaptain ? 1 : 0) || b.score - a.score);

          const vs = records[String(x.id)] || [];
          // 队长昵称优先用接口字段，拿不到（不少队伍 captain_nickname 是空）就从成员里
          // 反查那个被标了 isCaptain 的人，免得头部一行空着。
          const capName = x.captain_nickname || (players.find((p) => p.isCaptain) || {}).name || '';
          return {
            id: String(x.id),
            name: x.name || '未命名队伍',
            rankText: x.rank ? placeLabel(Number(x.rank)) : '',
            captain: capName,
            memberCount: x.member_count || players.length,
            totalScore: players.reduce((s, p) => s + p.score, 0),
            records: vs.map((r) => ({
              key: r.opponent,
              opponent: r.opponent,
              win: r.win,
              lose: r.lose,
              pending: r.pending
            })),
            // 默认展开：网页端就是展开的，折叠起来用户会以为「队伍里没人」
            open: true,
            members: players
          };
        });
        teams.sort((a, b) => {
          const ra = a.rankText ? 1 : 999;
          const rb = b.rankText ? 1 : 999;
          if (ra !== rb) return ra - rb;
          return b.totalScore - a.totalScore;
        });

        // ---- 报名名单：补上所属队伍和头像（网页 PlayerTable 也是这么反查的）
        const teamOf = {};
        teams.forEach((tm) => tm.members.forEach((p) => (teamOf[p.playerId] = tm.name)));
        const signups = (Array.isArray(d.signups) ? d.signups : []).map((s) => ({
          id: String(s.player_id),
          name: s.nickname || s.group_nickname || '未命名',
          initial: String(s.nickname || s.group_nickname || '?').charAt(0),
          group: s.group_nickname || '',
          avatar: fullUrl(base, '/api/avatar/' + s.player_id),
          score: s.score || 0,
          positionsText: positionsText(s.positions),
          teamName: teamOf[String(s.player_id)] || '',
          signedText: fmtClock(s.signed_at),
          captain: !!s.is_captain
        }));

        const prizes = [t.champion_prize, t.runner_up_prize].filter(Boolean);
        const signedCount = signups.filter((s) => s.teamName).length;
        const playerIds = {};
        teams.forEach((tm) => tm.members.forEach((p) => (playerIds[p.playerId] = 1)));

        // 全量名单留在页面实例上（不塞 data）：51 条一次渲染没必要，
        // 「展开全部」时再从 _allSignups 切一份出来。
        this._allSignups = signups;
        this._rawMatches = rawMatches;

        this.setData({
          loading: false,
          error: '',
          tab: 'overview',
          t: {
            name: t.name || '未命名赛事',
            statusText: tourStatusText(t.status),
            // 赛完就关报名通道（网页端 locked 判断的是 finished / done 两种写法）
            locked: tourStatusGroup(t.status) === 'finished',
            dateText: [fmtMonthDay(t.start_date), fmtMonthDay(t.end_date)].filter(Boolean).join(' — '),
            sponsor: t.sponsor_info || '',
            prizeText: prizes.join(' / ')
          },
          places: places,
          stats: {
            teamCount: teams.length,
            playerCount: Object.keys(playerIds).length,
            signupCount: signups.length,
            matchCount: rawMatches.length,
            signedCount: signedCount
          },
          recentRoundName: lastRound ? lastRound.name : '',
          recentItems: recentItems,
          rounds: rounds,
          teams: teams,
          signupList: signups.slice(0, SIGNUP_PREVIEW),
          signupTotal: signups.length,
          showAllSignups: false
        });

        this.applyState(me);
      })
      .catch((e) =>
        this.setData({ loading: false, error: (e && e.message) || '加载失败' })
      );
  },

  // 只刷「我的报名状态」，不动列表内容
  loadState() {
    return request('/api/tournaments/' + this.data.id + '/signup', null, { method: 'GET' })
      .then((me) => this.applyState(me || {}))
      .catch(() => {});
  },

  applyState(me) {
    const prof = me.profile || {};
    const score = prof.score || 0;
    const pos = positionsText(prof.positions);
    this.setData({
      state: {
        loggedIn: !!me.loggedIn,
        bound: !!me.bound,
        signedUp: !!me.signedUp,
        isCaptain: !!me.isCaptain
      },
      profileText: [score ? score + ' 分' : '', pos].filter(Boolean).join(' · ')
    });
  },

  toggleTeam(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const open = !!this.data.teams[idx].open;
    // 路径键只回传这一个字段，不重发整个 teams 数组
    const patch = {};
    patch['teams[' + idx + '].open'] = !open;
    this.setData(patch);
  },

  /** 展开/收起某一局的阵容。阵容第一次展开时才 setData，首屏只传 17 个骨架 */
  toggleMatch(e) {
    const ds = e.currentTarget.dataset;
    const ri = Number(ds.ri);
    const mi = Number(ds.mi);
    const node = this.data.rounds[ri] && this.data.rounds[ri].items[mi];
    if (!node) return;
    const patch = {};
    if (node.open) {
      patch['rounds[' + ri + '].items[' + mi + '].open'] = false;
      this.setData(patch);
      return;
    }
    const all = (this._playersByMatch || {})[node.key] || { radiant: [], dire: [] };
    // 阵容塞进 sides[].list（WXML 渲染的是 side.list，不是 m.players），
    // 否则点开后两队十个人一条都出不来。
    patch['rounds[' + ri + '].items[' + mi + '].sides[0].list'] = all.radiant;
    patch['rounds[' + ri + '].items[' + mi + '].sides[1].list'] = all.dire;
    patch['rounds[' + ri + '].items[' + mi + '].open'] = true;
    this.setData(patch);
  },

  /** 概览里的赛果只有比分，点一下跳到赛程 Tab 看这一局的阵容 */
  gotoMatches() {
    this.setData({ tab: 'matches' });
  },

  toggleSignups() {
    const all = this._allSignups || [];
    const showAll = !this.data.showAllSignups;
    this.setData({
      showAllSignups: showAll,
      signupList: showAll ? all : all.slice(0, SIGNUP_PREVIEW)
    });
  },

  /** 点选手跳名片页（网页端头像和昵称都能点，这里给整行） */
  onTapPlayer(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.pid) || '');
    if (!id) return;
    wx.navigateTo({ url: '/pages/member/member?id=' + encodeURIComponent(id) });
  },

  /** 对局号：小程序打不开外链，改成复制，粘到浏览器里能看完整数据 */
  copyMatchId(e) {
    const mid = String((e.currentTarget.dataset && e.currentTarget.dataset.mid) || '');
    if (!mid) return;
    wx.setClipboardData({
      data: mid,
      success: () => toast('对局号已复制')
    });
  },

  // 报名 / 退赛共用一个按钮位：已报名就变成退赛
  onSignupTap() {
    const st = this.data.state;
    if (this.data.busy) return;
    // 赛事已结束：底部操作条本来就不渲染，这里是第二道闸（防止别处直接调）
    if (this.data.t && this.data.t.locked) {
      toast('赛事已结束，报名通道已关闭');
      return;
    }

    if (!st.loggedIn) {
      confirmBox('还没登录', '报名需要用你的账号，去登录？', '去登录').then((ok) => {
        if (ok) wx.navigateTo({ url: '/pages/login/login' });
      });
      return;
    }
    if (!st.bound) {
      toast('账号还没绑选手资料，请先补填选手资料');
      return;
    }
    if (st.isCaptain) {
      toast('你是队长，退赛要先解除队长身份');
      return;
    }
    if (st.signedUp) {
      this.withdraw();
      return;
    }
    this.signup();
  },

  signup() {
    const tip = this.data.profileText
      ? '用档案里的「' + this.data.profileText + '」报名本届？'
      : '用档案里的位置和天梯分报名本届？';
    confirmBox('确认报名', tip, '报名').then((ok) => {
      if (!ok) return;
      this.setData({ busy: true });
      // 不传 score / positions：服务端会用档案值生成快照（见 signup.js 的 snapScore 兜底）
      request('/api/tournaments/' + this.data.id + '/signup', {}, { method: 'POST' })
        .then((res) => {
          this.setData({ busy: false });
          toast((res && res.message) || '报名成功');
          this.load();
        })
        .catch((e) => {
          this.setData({ busy: false });
          toast((e && e.message) || '报名失败');
        });
    });
  },

  withdraw() {
    confirmBox('退出本届', '退赛会删掉你的报名记录，确定？', '退赛').then((ok) => {
      if (!ok) return;
      this.setData({ busy: true });
      request('/api/tournaments/' + this.data.id + '/signup', {}, { method: 'DELETE' })
        .then(() => {
          this.setData({ busy: false });
          toast('已退赛');
          this.load();
        })
        .catch((e) => {
          this.setData({ busy: false });
          toast((e && e.message) || '退赛失败');
        });
    });
  },

  onShareAppMessage() {
    const t = this.data.t;
    return {
      title: t ? t.name : 'DoDo 赛事',
      path: '/pages/tournament/tournament?id=' + this.data.id
    };
  },

  onShareTimeline() {
    const t = this.data.t;
    return { title: t ? t.name : 'DoDo 赛事', query: 'id=' + this.data.id };
  }
});
