// 群友语录：按月分组列表 + 收录入口 + 删除 + **打分与评价**。
//
// 评价是「一人一评、可改」（服务端 UNIQUE(quote_id, reviewer_id) + upsert），
// 所以提交按钮的语义是「提交/更新我的评价」，不是追加第二条。
//
// 评价区按需加载：列表里 8 条语录如果一次性把每条的评价都拉一遍，就是 8 个请求，
// 绝大多数用户只会点开一两条。所以只在展开时拉，拉过就缓存（this._loaded）。
const { request, getBase } = require('../../utils/api');
const { fullUrl, monthLabel, fmtMD, fmtDateTime, stars } = require('../../utils/format');
const { loadOptions } = require('../../utils/options');
const session = require('../../utils/session');

const PAGE_SIZE = 30;

// 0 ~ 5，半星步进，从高到低（用户想给 5 分不用滚到底）
const SCORE_OPTIONS = [];
for (let i = 10; i >= 0; i--) {
  const v = i / 2;
  SCORE_OPTIONS.push({ value: v, label: (v === 0 ? '0（不打分）' : v + ' 分') });
}

Page({
  data: {
    groups: [],
    total: 0,
    people: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: '',
    // 评价区状态：id -> { open, loading, list, avg, count, myScore, myComment, scoreIndex, busy, canDeleteMy }
    reviews: {},
    scoreLabels: SCORE_OPTIONS.map((x) => x.label),
    reviewMax: 200,
    isAdmin: false,
    loggedIn: false
  },

  onLoad() {
    this.offset = 0;
    this.all = [];
    this._loaded = {};
    this.load(true);
    loadOptions()
      .then((o) => {
        const max = (o && o.limits && o.limits.reviewComment) || 200;
        this.setData({ reviewMax: max });
      })
      .catch(() => {});
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
    // session 的导出里**没有** isAdmin()，管理员标记存在 getUser().isAdmin 上
    const me = session.getUser();
    this.setData({ loggedIn: session.isLoggedIn(), isAdmin: !!(me && me.isAdmin) });
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

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  load(reset) {
    const base = getBase();
    if (reset) {
      this.offset = 0;
      this.all = [];
      this._loaded = {};
      this.setData({ loading: true, error: '', reviews: {} });
    } else {
      this.setData({ loadingMore: true });
    }

    const query = '/api/quotes?offset=' + this.offset + '&limit=' + PAGE_SIZE;

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
            ratingAvg: Number(q.ratingAvg) || 0,
            ratingCount: Number(q.ratingCount) || 0,
            ratingText:
              q.ratingCount > 0
                ? Number(q.ratingAvg).toFixed(1) + ' · ' + q.ratingCount + ' 人评'
                : ''
          };
        });

        this.all = this.all.concat(rows);
        this.offset = this.all.length;

        this.setData({
          total: (res && res.total) || this.all.length,
          people: (res && res.people) || 0,
          hasMore: !!(res && res.hasMore),
          loading: false,
          loadingMore: false
        });
        this._renderGroups();
      })
      .catch((e) =>
        this.setData({
          loading: false,
          loadingMore: false,
          error: (e && e.message) || '加载失败'
        })
      );
  },

  // 按月分组：接口已按 created_at DESC，这里只做折叠，不重排
  _renderGroups() {
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
    this.setData({ groups: groups });
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
  },

  // ---------------- 评价 ----------------

  /** 展开/收起评价区；第一次展开才拉评价列表 */
  toggleReviews(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    const cur = this.data.reviews[id];
    if (cur && cur.open) {
      this._setReview(id, { open: false });
      return;
    }
    this._setReview(id, { open: true });
    if (!this._loaded[id]) this.loadReviews(id);
  },

  loadReviews(id) {
    this._setReview(id, { loading: true });
    return request('/api/quotes/' + id + '/reviews', null, { method: 'GET' })
      .then((res) => {
        const my = (res && res.myReview) || null;
        const list = (res && res.reviews ? res.reviews : []).map((r) => ({
          id: String(r.id),
          score: Number(r.score) || 0,
          scoreText: Number(r.score) > 0 ? Number(r.score) + ' 分' : '未打分',
          stars: stars(r.score),
          comment: r.comment || '',
          name: (r.reviewer && r.reviewer.nickname) || '已注销的群友',
          when: r.createdAt ? fmtDateTime(r.createdAt) : '',
          mine: !!(my && String(my.id) === String(r.id))
        }));
        this._loaded[id] = true;
        const idx = my ? this._indexOfScore(Number(my.score) || 0) : 0;
        this._setReview(id, {
          loading: false,
          list: list,
          avg: Number(res && res.ratingAvg) || 0,
          count: Number(res && res.ratingCount) || 0,
          myId: my ? String(my.id) : '',
          myScore: my ? Number(my.score) || 0 : 0,
          myComment: my ? my.comment || '' : '',
          commentLen: my ? (my.comment || '').length : 0,
          scoreIndex: idx,
          scoreLabel: this.data.scoreLabels[idx]
        });
        return res;
      })
      .catch((err) => {
        this._loaded[id] = false;
        this._setReview(id, { loading: false, error: (err && err.message) || '评价加载失败' });
      });
  },

  _indexOfScore(v) {
    const i = SCORE_OPTIONS.map((x) => x.value).indexOf(v);
    return i < 0 ? 0 : i;
  },

  _setReview(id, patch) {
    const cur = this.data.reviews[id] || {
      open: false,
      loading: false,
      list: [],
      avg: 0,
      count: 0,
      myId: '',
      myScore: 0,
      myComment: '',
      commentLen: 0,
      scoreIndex: 0,
      scoreLabel: this.data.scoreLabels[0],
      busy: false,
      error: ''
    };
    const next = Object.assign({}, cur, patch);
    const data = {};
    data['reviews.' + id] = next;
    this.setData(data);
  },

  onScoreChange(e) {
    const id = String(e.currentTarget.dataset.id || '');
    const i = Number(e.detail.value) || 0;
    this._setReview(id, { scoreIndex: i, scoreLabel: this.data.scoreLabels[i] });
  },

  onComment(e) {
    const id = String(e.currentTarget.dataset.id || '');
    const v = String((e.detail && e.detail.value) || '');
    this._setReview(id, { myComment: v, commentLen: v.length });
  },

  submitReview(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    if (!session.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    const cur = this.data.reviews[id] || {};
    if (cur.busy) return;

    const score = SCORE_OPTIONS[cur.scoreIndex || 0].value;
    const comment = String(cur.myComment || '').trim();

    this._setReview(id, { busy: true, error: '' });
    request(
      '/api/quotes/' + id + '/reviews',
      { score: score, comment: comment },
      { method: 'POST' }
    )
      .then((res) => {
        this._setReview(id, { busy: false });
        wx.showToast({ title: '已提交评价', icon: 'success' });
        // 用返回值同步列表上的平均分，不用整页重拉
        this._patchRating(id, res && res.ratingAvg, res && res.ratingCount);
        return this.loadReviews(id);
      })
      .catch((err) => {
        this._setReview(id, { busy: false, error: (err && err.message) || '提交失败' });
        wx.showToast({ title: (err && err.message) || '提交失败', icon: 'none' });
      });
  },

  /** 把新的平均分/人数写回扁平列表并重建分组（避免整页重拉闪一下） */
  _patchRating(id, avg, count) {
    const row = this.all.filter((x) => x.id === id)[0];
    if (!row) return;
    row.ratingAvg = Number(avg) || 0;
    row.ratingCount = Number(count) || 0;
    row.ratingText = row.ratingCount > 0 ? row.ratingAvg.toFixed(1) + ' · ' + row.ratingCount + ' 人评' : '';
    this._renderGroups();
  },

  removeMyReview(e) {
    const id = String(e.currentTarget.dataset.id || '');
    const rid = String(e.currentTarget.dataset.rid || '');
    if (!id || !rid) return;
    wx.showModal({
      title: '删除我的评价',
      content: '删掉后这条语录的平均分会重新计算。',
      confirmText: '删除',
      confirmColor: '#b02b25',
      success: (r) => {
        if (!r.confirm) return;
        request('/api/quotes/' + id + '/reviews/' + rid, {}, { method: 'DELETE' })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            // 只重拉这一条的评价区 + 把新平均分写回列表，不整页重载（否则面板会被收起来）
            return this.loadReviews(id).then((res) =>
              this._patchRating(id, res && res.ratingAvg, res && res.ratingCount)
            );
          })
          .catch((err) =>
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          );
      }
    });
  },

  onShareAppMessage() {
    return { title: '群友语录 · LaRoja', path: '/pages/quotes/quotes' };
  },

  onShareTimeline() {
    return { title: '群友语录 · LaRoja' };
  }
});
