// 邀请群友（帮主专用）。
//
// 为什么单独一页而不是在帮派页里塞搜索框：搜人要输入法弹出 + 结果列表，
// 放在滚动页里会和「成员列表」抢焦点；网页端也是用一个独立的选择器弹窗。
//
// 进页先拉一次 GET /api/guild，只为了拿 sentInvites 和 members ——
// 已经邀请过的人不能重复邀请，已经在帮里的人也不该出现在可选列表里。
const { request, getBase, getToken } = require('../../utils/api');
const { loadOptions } = require('../../utils/options');
const { fullUrl } = require('../../utils/format');

const toast = (t) => wx.showToast({ title: t, icon: 'none' });

Page({
  data: {
    loading: true,
    needLogin: false,
    keyword: '',
    results: [],
    searching: false,
    picked: null,
    message: '',
    limit: 60,
    busy: false,
    error: ''
  },

  onLoad() {
    this._invited = {}; // playerId -> 邀请 id（已发出还没回应）
    this._members = {}; // playerId -> true（已经在帮里）
    if (!getToken()) {
      this.setData({ loading: false, needLogin: true });
      return;
    }
    loadOptions()
      .then((opt) => {
        const lim = (opt && opt.limits) || {};
        if (lim.guildInvite) this.setData({ limit: lim.guildInvite });
      })
      .catch(() => {});
    this.loadContext();
  },

  /** 只为了知道谁能邀、谁不能邀；失败不挡主流程（服务端还会再拦一次） */
  loadContext() {
    return request('/api/guild', null, { method: 'GET' })
      .then((res) => {
        const sent = (res && res.sentInvites) || [];
        const invited = {};
        sent.forEach((x) => {
          invited[String(x.playerId)] = String(x.id);
        });
        const members = {};
        ((res && res.guild && res.guild.members) || []).forEach((m) => {
          members[String(m.playerId)] = true;
        });
        this._invited = invited;
        this._members = members;
        this.setData({ loading: false });
      })
      .catch((e) => {
        const expired = e && (e.statusCode === 401 || e.code === 'SESSION_EXPIRED');
        this.setData({ loading: false, needLogin: !!expired });
        if (!expired) toast((e && e.message) || '帮派信息没取到');
      });
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value });
  },

  onMessage(e) {
    this.setData({ message: e.detail.value });
  },

  search() {
    const q = String(this.data.keyword || '').trim();
    if (!q) return this.setData({ results: [] });
    this.setData({ searching: true, error: '' });
    request('/api/players/search?q=' + encodeURIComponent(q), null, { method: 'GET' })
      .then((res) => {
        const base = getBase();
        const list = (res && res.players) || [];
        const results = list.slice(0, 12).map((p) => {
          const id = String(p.id);
          const inGuild = !!this._members[id];
          const invitedId = this._invited[id] || '';
          return {
            id: id,
            nickname: p.nickname || '未命名',
            initial: (p.nickname || '群').charAt(0),
            avatar: fullUrl(base, p.avatar || ''),
            meta: [p.group_nickname, p.score ? p.score + ' 分' : ''].filter(Boolean).join(' · '),
            stateText: inGuild ? '已在帮里' : invitedId ? '已邀请' : '',
            disabled: inGuild || !!invitedId
          };
        });
        this.setData({ searching: false, results: results });
        if (!list.length) toast('没搜到这个人');
      })
      .catch((e) => this.setData({ searching: false, error: (e && e.message) || '搜索失败' }));
  },

  pick(e) {
    const ds = e.currentTarget.dataset;
    if (ds.disabled) {
      return toast(ds.state || '这个人不用再邀请了');
    }
    this.setData({
      picked: {
        id: String(ds.id),
        nickname: ds.nick || '这位群友',
        avatar: ds.avatar || '',
        initial: (ds.nick || '群').charAt(0)
      },
      error: ''
    });
  },

  clearPick() {
    this.setData({ picked: null });
  },

  submit() {
    if (this.data.busy) return;
    const picked = this.data.picked;
    if (!picked) return this.setData({ error: '先搜一下要邀请谁' });

    const body = { playerId: picked.id };
    const msg = String(this.data.message || '').trim();
    if (msg) body.message = msg;

    this.setData({ busy: true, error: '' });
    request('/api/guild/invites', body, { method: 'POST' })
      .then(() => {
        // 帮派页 onShow 看到标记就重拉（「已发出」列表要出现这个人）
        const app = getApp();
        if (app && app.globalData) app.globalData.guildDirty = true;
        this.setData({ busy: false });
        wx.showToast({ title: '邀请已发出', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch((e) => this.setData({ busy: false, error: (e && e.message) || '邀请没发出去' }));
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  }
});
