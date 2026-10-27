const { request, getToken } = require('../../utils/api');
const { fmtDateTime, regionShort } = require('../../utils/format');
const session = require('../../utils/session');

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '招募中' },
  { key: 'joined', label: '我参与' }
];

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

  // 登录态变了就重拉：iJoined / isMine 由服务端按会话算
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
    return request('/api/activities', null, { method: 'GET' })
      .then((res) => {
        const posts = (res && res.posts) || [];
        const rows = posts.map((p) => {
          const costText = p.cost || '';
          const need = p.need_people;
          const peopleText =
            need !== null && need !== undefined
              ? p.joinedPeople + '/' + need + ' 人'
              : p.joinedPeople + ' 人已报名';

          const isOpen = p.status === 'open' && !p.expired;
          const isMine = !!p.isMine;
          const iJoined = !!p.iJoined;

          let actionText = '';
          let actionKey = '';
          if (isMine && isOpen) {
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

          // 报名者名单：接口本来就在列表里带回（网页端 ActivityCard 平铺展示）。
          // WXML 不能调方法，首字头像、携伴文案、日期都在 JS 算好。
          const signups = (p.signups || []).map((s, i) => ({
            idx: i,
            initial: (s.nickname || '?').slice(0, 1),
            nickname: s.nickname || '群友',
            guestsText: s.guests > 0 ? '携 ' + s.guests + ' 人同行' : '本人参加',
            note: s.note || '',
            dayText: s.created_at ? fmtDateTime(s.created_at).slice(0, 10) : ''
          }));

          return {
            id: String(p.id),
            title: p.title || '未命名活动',
            typeLabel: p.typeLabel || '',
            statusLabel: p.statusLabel || '',
            isOpen: isOpen,
            isMine: isMine,
            iJoined: iJoined,
            actionText: actionText,
            actionKey: actionKey,
            meetText: p.meet_at ? fmtDateTime(p.meet_at) : '时间待定',
            regionText: regionShort(p.region),
            locationText: p.location || '',
            costText: costText,
            peopleText: peopleText,
            note: p.note || '',
            creatorText: (p.creator && p.creator.nickname) || '群友',
            signupCount: p.signupCount || 0,
            needText: p.need_people ? ' / 需要 ' + p.need_people + ' 人' : '',
            signups: signups,
            expanded: false
          };
        });

        this.all = rows;
        this.setData({ loading: false, total: rows.length }, () => this.apply());
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
    wx.navigateTo({ url: '/pages/activity-new/activity-new' });
  },

  onTap(e) {
    // 点卡片 = 展开/收起报名者名单（与网页端 ActivityCard 平铺一致，没有独立详情页）
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
        content: '关闭后这个活动不再接受报名，已报名的人不受影响。',
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
        content: '取消后要把名额让出来，确定吗？',
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
    request('/api/activities/' + id, { status: 'closed' }, { method: 'PATCH' })
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
    request('/api/activities/' + id + '/join', body, { method: method })
      .then(() => {
        this.setData({ busyId: '' });
        wx.showToast({ title: method === 'DELETE' ? '已取消报名' : '报名成功', icon: 'success' });
        this.load();
      })
      .catch((err) => {
        this.setData({ busyId: '' });
        wx.showModal({
          title: '没能完成',
          content: (err && err.message) || '稍后再试',
          showCancel: false
        });
      });
  },

  onShareAppMessage() {
    return { title: 'LaRoja 活动招募 · 约饭爬山', path: '/pages/activities/activities' };
  },

  onShareTimeline() {
    return { title: 'LaRoja 活动招募' };
  }
});
