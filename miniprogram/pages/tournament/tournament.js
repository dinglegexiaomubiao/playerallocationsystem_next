// 赛事详情：名次 / 赛程对阵 / 队伍成员 / 报名名单 + 报名与退赛。
//
// 为什么合并成一个页面：这四块在网页端是同一页（pages/tournaments/[id].js），
// 数据也来自同一批接口，拆页会让同一届赛事被拉三四遍。报名名单 51 人、队伍 8 支，
// 加起来不到 20KB，一次拉完比「点一下再拉」更省。
//
// 三个接口各自独立：
//   GET /api/tournaments/{id}          赛事本体 + 名次 + 队伍 + 报名名单
//   GET /api/tournaments/{id}/matches  轮次 + 对阵（多数赛事没编赛程，返回空数组）
//   GET /api/tournaments/{id}/signup   我的报名状态 + 档案预填值（匿名也能调）
// 赛程接口失败不该拖垮整页，所以单独 catch 成空；报名状态同理。
const { request } = require('../../utils/api');
const { fmtMonthDay, tourStatusText } = require('../../utils/format');

const PLACE_LABEL = { 1: '冠军', 2: '亚军', 3: '季军' };
// 报名名单一次最多先渲染这么多条，剩下的点「展开全部」。
// 不是分页 —— 51 条一次 setData 也不算大，但首屏没必要等它。
const SIGNUP_PREVIEW = 8;

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

// positions 在库里是 '优势路,中单' 这种逗号串，展示成 '优势路·中单'
function positionsText(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  return arr
    .map((x) => String(x).trim())
    .filter(Boolean)
    .join('·');
}

function matchStatusText(s) {
  if (s === 'finished' || s === 'done') return '已结束';
  if (s === 'ongoing' || s === 'live') return '进行中';
  return '未开始';
}

function normalizeMatch(m) {
  const aScore = m.team_a_score;
  const bScore = m.team_b_score;
  const hasScore =
    aScore !== null && aScore !== undefined && bScore !== null && bScore !== undefined;
  return {
    key: String(m.id),
    a: m.team_a_name || '待定',
    b: m.team_b_name || '待定',
    scoreText: hasScore ? aScore + ' : ' + bScore : '—',
    winner: m.winner_name || '',
    statusText: matchStatusText(m.status),
    finished: hasScore,
    grudge: !!m.is_grudge,
    note: m.note || ''
  };
}

Page({
  data: {
    id: '',
    loading: true,
    error: '',
    t: null,
    places: [],
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

  // 从登录页回来要重新问一次「我报名了没」——登录成功后 login 页只做 navigateBack，
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

  load() {
    const id = this.data.id;
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

    return Promise.all([detail(), bracket(), mine()])
      .then((res) => {
        const d = res[0] || {};
        const b = res[1] || {};
        const me = res[2] || {};

        if (!d.tournament) {
          this.setData({ loading: false, error: '没找到这届赛事' });
          return;
        }
        const t = d.tournament;

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

        // ---- 队伍（成员默认折叠）
        const teams = (Array.isArray(d.teams) ? d.teams : []).map((x) => {
          const members = Array.isArray(x.members) ? x.members : [];
          return {
            id: String(x.id),
            name: x.name || '未命名队伍',
            rankText: x.rank ? '第 ' + x.rank + ' 名' : '',
            captain: x.captain_nickname || '',
            memberCount: x.member_count || members.length,
            open: false,
            members: members.map((mm) => ({
              id: String(mm.player_id),
              name: mm.nickname || mm.group_nickname || '未命名',
              position: mm.position || '',
              group: mm.group_nickname || ''
            }))
          };
        });

        // ---- 报名名单
        const signups = (Array.isArray(d.signups) ? d.signups : []).map((s) => ({
          id: String(s.player_id),
          name: s.nickname || s.group_nickname || '未命名',
          group: s.group_nickname || '',
          score: s.score || 0,
          positionsText: positionsText(s.positions),
          captain: !!s.is_captain
        }));

        // ---- 赛程：按轮次分组；round_id 对不上的归到「未分轮次」
        const groups = (Array.isArray(b.rounds) ? b.rounds : []).map((r) => ({
          id: String(r.id),
          name: r.name || '轮次',
          items: []
        }));
        const loose = { id: 'none', name: '未分轮次', items: [] };
        (Array.isArray(b.matches) ? b.matches : []).forEach((m) => {
          const g = groups.filter((x) => x.id === String(m.round_id))[0] || loose;
          g.items.push(normalizeMatch(m));
        });
        const rounds = groups
          .concat(loose.items.length ? [loose] : [])
          .filter((g) => g.items.length > 0);

        const prizes = [t.champion_prize, t.runner_up_prize].filter(Boolean);

        // 全量名单留在页面实例上（不塞 data）：51 条一次渲染没必要，
        // 「展开全部」时再从 _allSignups 切一份出来。
        this._allSignups = signups;

        this.setData({
          loading: false,
          error: '',
          t: {
            name: t.name || '未命名赛事',
            statusText: tourStatusText(t.status),
            dateText: [fmtMonthDay(t.start_date), fmtMonthDay(t.end_date)].filter(Boolean).join(' — '),
            sponsor: t.sponsor_info || '',
            prizeText: prizes.join(' / ')
          },
          places: places,
          teams: teams,
          signupList: signups.slice(0, SIGNUP_PREVIEW),
          signupTotal: signups.length,
          showAllSignups: false,
          rounds: rounds
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

  toggleSignups() {
    const all = this._allSignups || [];
    const showAll = !this.data.showAllSignups;
    this.setData({
      showAllSignups: showAll,
      signupList: showAll ? all : all.slice(0, SIGNUP_PREVIEW)
    });
  },

  // 报名 / 退赛共用一个按钮位：已报名就变成退赛
  onSignupTap() {
    const st = this.data.state;
    if (this.data.busy) return;

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
