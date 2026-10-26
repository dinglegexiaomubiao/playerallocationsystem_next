const { request, getBase } = require('../../utils/api');
const { fullUrl, monthLabel, fmtMD } = require('../../utils/format');
const session = require('../../utils/session');

const PAGE_SIZE = 30;

Page({
  data: {
    groups: [],
    total: 0,
    people: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: ''
  },

  onLoad() {
    this.offset = 0;
    this.all = [];
    this.load(true);
  },

  onPullDownRefresh() {
    this.load(true).then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) this.load(false);
  },

  // 从收录页回来要能立刻看到自己刚加的那条
  onShow() {
    const app = getApp();
    if (app && app.globalData && app.globalData.quotesDirty) {
      app.globalData.quotesDirty = false;
      this.load(true);
    }
  },

  goNew() {
    if (!session.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    wx.navigateTo({ url: '/pages/quote-new/quote-new' });
  },

  load(reset) {
    const base = getBase();
    if (reset) {
      this.offset = 0;
      this.all = [];
      this.setData({ loading: true, error: '' });
    } else {
      this.setData({ loadingMore: true });
    }

    const query =
      '/api/quotes?offset=' + this.offset + '&limit=' + PAGE_SIZE;

    return request(query, null, { method: 'GET' })
      .then((res) => {
        const quotes = (res && res.quotes) || [];
        const rows = quotes.map((q) => {
          const src = q.source || {};
          const isPlayer = src.type === 'player';
          const by = q.submittedBy;
          return {
            id: String(q.id),
            content: q.content,
            sourcePlayerId: isPlayer ? String(src.playerId) : '',
            sourceName: isPlayer ? src.nickname || '群友' : src.text || '群里某人',
            sourceAvatar: isPlayer ? fullUrl(base, src.avatar || '') : '',
            saidText: fmtMD(q.saidAt),
            month: monthLabel(q.saidAt),
            submittedText: by && by.nickname ? '由 ' + by.nickname + ' 收录' : '',
            // 「能不能删」由接口算（本人收录 / 管理员）。账号没绑选手资料时永远是 false，
            // 那是服务端的既定规则，页面不用再猜
            canDelete: !!q.canDelete,
            ratingText:
              q.ratingCount > 0
                ? Number(q.ratingAvg).toFixed(1) + ' · ' + q.ratingCount + ' 人评'
                : ''
          };
        });

        this.all = this.all.concat(rows);
        this.offset = this.all.length;

        // 按月分组：接口已按 created_at DESC，这里只做折叠，不重排
        const groups = [];
        const index = {};
        for (const row of this.all) {
          const key = row.month || '未知月份';
          if (index[key] === undefined) {
            index[key] = groups.length;
            groups.push({ key: key, label: key, items: [] });
          }
          groups[index[key]].items.push(row);
        }

        this.setData({
          groups: groups,
          total: (res && res.total) || this.all.length,
          people: (res && res.people) || 0,
          hasMore: !!(res && res.hasMore),
          loading: false,
          loadingMore: false
        });
      })
      .catch((e) =>
        this.setData({
          loading: false,
          loadingMore: false,
          error: (e && e.message) || '加载失败'
        })
      );
  },

  onTapSource(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/member/member?id=' + String(id) });
  },

  /** 收错了（出处点错人 / 日期填错）自己撤掉，不用找管理员 —— 和网页同一个口径 */
  removeQuote(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    wx.showModal({
      title: '删除这条语录',
      content: '删掉之后不能恢复。',
      confirmText: '删除',
      confirmColor: '#b02b25',
      success: (r) => {
        if (!r.confirm) return;
        request('/api/quotes/' + id, {}, { method: 'DELETE' })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.load(true);
          })
          .catch((err) => {
            // 403 多半是「账号没绑选手资料」，服务端文案已经说清楚了
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' });
          });
      }
    });
  }
});
