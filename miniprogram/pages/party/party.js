const { request, getToken } = require('../../utils/api');
const { fmtDateTime } = require('../../utils/format');
const session = require('../../utils/session');

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '招募中' },
  { key: 'joined', label: '我参与' }
];

const rangeText = (min, max) => {
  if (min === null || min === undefined) {
    if (max === null || max === undefined) return '';
    return '≤ ' + max;
  }
  if (max === null || max === undefined) return '≥ ' + min;
  return min + ' — ' + max;
};

Page({
  data: {
    tabs: TABS,
    tab: 'all',
    list: [],
    total: 0,
    loading: true,
    error: '',
    busyId: ''
  },

  onLoad() {
    this.all = [];
    this.load();
  },

  // 从登录页返回时页面不会重建，只有 onShow 会再跑。
  // 登录态变了（登录/退出/过期被清）就重拉一次 —— isMine / iJoined 是服务端按会话算的。
  onShow() {
    if (this.tokenSeen !== undefined && this.tokenSeen !== getToken()) this.load();
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  load() {
    this.tokenSeen = getToken();
    this.setData({ loading: true, error: '' });
    return request('/api/party', null, { method: 'GET' })
      .then((res) => {
        const posts = (res && res.posts) || [];
        const rows = posts.map((p) => {
          const need = p.need_players;
          const peopleText =
            need !== null && need !== undefined
              ? (p.signupCount || 0) + '/' + need + ' 人'
              : (p.signupCount || 0) + ' 人已报名';

          const positions = Array.isArray(p.want_positions) ? p.want_positions : [];
          const wantRange = rangeText(p.want_score_min, p.want_score_max);
          const isOpen = p.status === 'open' && !p.expired;
          const isMine = !!p.isMine;
          const iJoined = !!p.iJoined;

          // 按钮语义只在这里算一次，WXML 里不再写条件表达式
          let actionText = '';
          let actionKey = '';
          if (isMine && isOpen) {
            // 自己发的、还在招募 → 给一个关闭入口（关掉后别人就报不了名）
            actionText = '关闭招募';
            actionKey = 'close';
          } else if (isMine) {
            actionText = '我发起的';
          } else if (iJoined) {
            actionText = '取消报名';
            actionKey = 'cancel';
          } else if (isOpen) {
            actionText = '报名';
            actionKey = 'join';
          }

          // 报名者名单：接口本来就带回（网页端 PartyCard 平铺展示），这里做轻量映射。
          // WXML 里不能调方法，首字头像、段位文本都在 JS 算好。
          const signups = (p.signups || []).map((s, i) => ({
            idx: i,
            initial: (s.nickname || '?').slice(0, 1),
            nickname: s.nickname || '群友',
            rankText: s.rank || (s.score ? s.score + ' 分' : ''),
            eta: s.eta || '',
            note: s.note || ''
          }));

          return {
            id: String(p.id),
            title: p.title || '未命名开黑',
            modeLabel: p.modeLabel || '',
            statusLabel: p.statusLabel || '',
            isOpen: isOpen,
            isMine: isMine,
            iJoined: iJoined,
            actionText: actionText,
            actionKey: actionKey,
            playTime: p.play_time || '',
            startText: p.start_at ? fmtDateTime(p.start_at) : '',
            peopleText: peopleText,
            voiceText: p.voice_app || (p.has_voice === false ? '' : '有语音'),
            wantRange: wantRange,
            wantRank: p.want_rank || '',
            positionsText: positions.slice(0, 4).join('、'),
            note: p.note || '',
            creatorText: (p.creator && p.creator.nickname) || '群友',
            signupCount: p.signupCount || 0,
            needText: p.need_players ? ' / 需要 ' + p.need_players + ' 人' : '',
            signups: signups,
            expanded: false
          };
        });

        this.all = rows;
        const patch = { loading: false, total: rows.length };
        this.setData(patch, () => this.apply());
      })
      .catch((e) =>
        this.setData({ loading: false, error: (e && e.message) || '加载失败' })
      );
  },

  apply() {
    const tab = this.data.tab;
    let list = this.all;
    if (tab === 'open') list = list.filter((p) => p.isOpen);
    if (tab === 'joined') list = list.filter((p) => p.iJoined);
    this.setData({ list: list });
  },

  onTab(e) {
    const v = e.currentTarget.dataset.v || 'all';
    this.setData({ tab: v }, () => this.apply());
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goNew() {
    if (!session.isLoggedIn()) {
      this.goLogin();
      return;
    }
    wx.navigateTo({ url: '/pages/party-new/party-new' });
  },

  onTap(e) {
    // 点卡片 = 展开/收起报名者名单。网页端没有独立详情页（名单平铺在 PartyCard 里），
    // 这里对齐：卡片信息已足够，缺的只是名单。
    const i = Number(e.currentTarget.dataset.index);
    const cur = this.data.list[i];
    if (!cur) return;
    if (!cur.signups.length) {
      wx.showToast({ title: '还没有人报名', icon: 'none' });
      return;
    }
    const patch = {};
    patch['list[' + i + '].expanded'] = !cur.expanded;
    this.setData(patch);
  },

  // 报名 / 取消报名
  onAction(e) {
    const ds = e.currentTarget.dataset;
    const id = String(ds.id || '');
    const act = ds.act || '';
    if (!id || !act) return;

    if (!session.isLoggedIn()) {
      this.goLogin();
      return;
    }
    if (this.data.busyId) return;

    if (act === 'close') {
      wx.showModal({
        title: '关闭招募',
        content: '关闭后这张卡片就不再接受报名，已报名的人不受影响。',
        confirmText: '关闭',
        confirmColor: '#b02b25',
        success: (r) => {
          if (r.confirm) this.closePost(id);
        }
      });
      return;
    }

    if (act === 'cancel') {
      wx.showModal({
        title: '取消报名',
        content: '取消后要把位置让出来，确定吗？',
        confirmText: '取消报名',
        confirmColor: '#b02b25',
        success: (r) => {
          if (r.confirm) this.doAction(id, 'DELETE', {});
        }
      });
      return;
    }
    this.doAction(id, 'POST', {});
  },

  closePost(id) {
    this.setData({ busyId: id });
    request('/api/party/' + id, { status: 'closed' }, { method: 'PATCH' })
      .then(() => {
        this.setData({ busyId: '' });
        wx.showToast({ title: '已关闭', icon: 'success' });
        this.load();
      })
      .catch((err) => {
        this.setData({ busyId: '' });
        wx.showModal({
          title: '没能关闭',
          content: (err && err.message) || '稍后再试',
          showCancel: false
        });
      });
  },

  doAction(id, method, body) {
    this.setData({ busyId: id });
    request('/api/party/' + id + '/join', body, { method: method })
      .then(() => {
        this.setData({ busyId: '' });
        wx.showToast({ title: method === 'DELETE' ? '已取消报名' : '报名成功', icon: 'success' });
        this.load();
      })
      .catch((err) => {
        this.setData({ busyId: '' });
        // 409 = 已报过名 / 已停止招募；400 = 自己发起的 / 已满。原样把服务端的话显示出来
        wx.showModal({
          title: '没能完成',
          content: (err && err.message) || '稍后再试',
          showCancel: false
        });
      });
  },

  onShareAppMessage() {
    return { title: 'LaRoja 开黑广场 · 缺人喊一嗓', path: '/pages/party/party' };
  },

  onShareTimeline() {
    return { title: 'LaRoja 开黑广场' };
  }
});
