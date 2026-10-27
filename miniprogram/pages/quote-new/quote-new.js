const { request, getBase } = require('../../utils/api');
const { fullUrl, fmtDate } = require('../../utils/format');

const pad = (n) => (n < 10 ? '0' + n : '' + n);

Page({
  data: {
    content: '',
    // 出处二选一：'player' 选群友 / 'text' 自己写。服务端也强制只能二选一
    sourceMode: 'player',
    keyword: '',
    results: [],
    searching: false,
    picked: null,
    sourceText: '',
    today: '',
    date: '',
    submitting: false,
    error: ''
  },

  onLoad() {
    const d = new Date();
    const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    this.setData({ today: today, date: today });
  },

  onContent(e) {
    this.setData({ content: e.detail.value, error: '' });
  },
  onDate(e) {
    this.setData({ date: e.detail.value });
  },
  onMode(e) {
    this.setData({ sourceMode: e.currentTarget.dataset.v, error: '' });
  },
  onKeyword(e) {
    this.setData({ keyword: e.detail.value });
  },
  onSourceText(e) {
    this.setData({ sourceText: e.detail.value, error: '' });
  },

  search() {
    const q = String(this.data.keyword || '').trim();
    if (!q) return this.setData({ results: [] });
    this.setData({ searching: true });
    request('/api/players/search?q=' + encodeURIComponent(q), null, { method: 'GET' })
      .then((res) => {
        const base = getBase();
        const list = (res && res.players) || [];
        this.setData({
          searching: false,
          results: list.slice(0, 10).map((p) => ({
            id: String(p.id),
            nickname: p.nickname || '未命名',
            meta: [p.group_nickname, p.score ? p.score + ' 分' : ''].filter(Boolean).join(' · '),
            avatar: fullUrl(base, p.avatar || '')
          }))
        });
        if (!list.length) wx.showToast({ title: '没搜到这个人', icon: 'none' });
      })
      .catch((e) => {
        this.setData({ searching: false, error: (e && e.message) || '搜索失败' });
      });
  },

  pick(e) {
    const ds = e.currentTarget.dataset;
    this.setData({
      picked: { id: String(ds.id), nickname: ds.nickname },
      results: [],
      keyword: '',
      error: ''
    });
  },

  clearPick() {
    this.setData({ picked: null });
  },

  submit() {
    if (this.data.submitting) return;
    const d = this.data;

    const content = String(d.content || '').trim();
    if (!content) return this.setData({ error: '写点内容吧' });

    const body = { content: content, saidAt: d.date };
    if (d.sourceMode === 'player') {
      if (!d.picked) return this.setData({ error: '选一下这句话是谁说的' });
      body.sourcePlayerId = d.picked.id;
    } else {
      const s = String(d.sourceText || '').trim();
      if (!s) return this.setData({ error: '写一下出处' });
      body.sourceText = s;
    }

    this.setData({ submitting: true, error: '' });
    request('/api/quotes', body, { method: 'POST' })
      .then(() => {
        this.setData({ submitting: false });
        // 语录页 onShow 看到标记就重拉
        const app = getApp();
        if (app && app.globalData) app.globalData.quotesDirty = true;
        wx.showToast({ title: '已收录', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch((e) =>
        this.setData({ submitting: false, error: (e && e.message) || '收录失败' })
      );
  }
});
