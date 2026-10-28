// 消息（站内信）页。
//
// 为什么站内信是主渠道：小程序的「一次性订阅」每授权一次只能推一条，
// 额度用完、用户拒收、微信限流都会让推送失败 —— 那些都不在我们控制内。
// 所以「有人报名了你的开黑」这件事先落库，保证打开小程序一定看得到。
//
// 页面顺序上，未读置顶不额外排序：列表本身是 id 倒序，新的就在上面，
// 再按未读排一次会让人找不到刚才看到的那条。
const api = require('../../utils/api');
const session = require('../../utils/session');
const { fmtDateTime } = require('../../utils/format');
const badge = require('../../utils/badge');

const CAT_LABEL = { party: '开黑', activity: '活动', tournament: '赛事', digest: '汇总' };

Page({
  data: {
    logged: false,
    items: [],
    unread: 0,
    loading: true,
    error: '',
    marking: false
  },

  onShow() {
    const user = session.getUser();
    this.setData({ logged: !!user });
    if (!user) {
      this.setData({ loading: false, items: [], unread: 0 });
      badge.apply(0);
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  load(quiet) {
    this.setData(quiet ? {} : { loading: true, error: '' });
    return api
      .request('/api/mp/inbox?limit=40', null, { method: 'GET' })
      .then((d) => {
        const list = ((d && d.items) || []).map((it) => ({
          id: it.id,
          category: it.category,
          catText: CAT_LABEL[it.category] || it.category,
          title: it.title,
          body: it.body || '',
          page: it.page || '',
          read: !!it.read,
          timeText: fmtDateTime(it.created_at)
        }));
        const unread = (d && d.unread) || 0;
        this.setData({ items: list, unread: unread, loading: false, error: '' });
        badge.apply(unread);
        return list;
      })
      .catch((e) => {
        const msg = e && e.message ? e.message : '加载失败';
        if (e && e.code === 'SESSION_EXPIRED') {
          this.setData({ logged: false, loading: false, items: [] });
          badge.apply(0);
          return [];
        }
        this.setData({ loading: false, error: msg });
        return [];
      });
  },

  // 点一条：先本地标已读（不等网络，点了就该立刻变灰），再跳转
  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    const page = e.currentTarget.dataset.page;
    const items = this.data.items.map((it) => (it.id === id ? Object.assign({}, it, { read: true }) : it));
    const unread = Math.max(0, this.data.unread - 1);
    const wasUnread = (this.data.items.filter((it) => it.id === id)[0] || {}).read === false;
    this.setData({ items: items, unread: wasUnread ? unread : this.data.unread });
    badge.apply(wasUnread ? unread : this.data.unread);

    if (wasUnread) {
      api.request('/api/mp/inbox', { id: id }).catch(() => {});
    }

    if (page) {
      const url = '/' + String(page).replace(/^\//, '');
      // 不是 tabBar 页才能 push；失败就留在原地，不弹错误（用户只是点了一条消息）
      wx.navigateTo({
        url: url,
        fail() {
          wx.switchTab({
            url: url,
            fail() {
              wx.showToast({ title: '这个页面暂时打不开', icon: 'none' });
            }
          });
        }
      });
    }
  },

  markAll() {
    if (this.data.marking || this.data.unread === 0) return;
    this.setData({ marking: true });
    api
      .request('/api/mp/inbox', { all: true })
      .then(() => {
        const items = this.data.items.map((it) => Object.assign({}, it, { read: true }));
        this.setData({ items: items, unread: 0, marking: false });
        badge.apply(0);
        wx.showToast({ title: '都看过了', icon: 'success' });
      })
      .catch((e) => {
        this.setData({ marking: false });
        wx.showToast({ title: (e && e.message) || '操作失败', icon: 'none' });
      });
  },

  goSubscribe() {
    wx.navigateTo({ url: '/pages/subscribe/subscribe' });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goParty() {
    wx.navigateTo({ url: '/pages/party/party' });
  }
});
