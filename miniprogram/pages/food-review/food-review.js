const { request } = require('../../utils/api');

Page({
  data: {
    id: '',
    name: '',
    rating: 5,
    stars: [],
    content: '',
    submitting: false,
    error: ''
  },

  onLoad(query) {
    const id = String((query && query.id) || '');
    this.setData({
      id: id,
      name: (query && query.name) || '这家店',
      stars: this.buildStars(5)
    });
    if (!id) this.setData({ error: '缺少美食 id' });
  },

  // 星星做成 [{n, on}]：WXML 不能比较大小之外再调函数，选中态提前算好
  buildStars(v) {
    const list = [];
    for (let i = 1; i <= 5; i += 1) list.push({ n: i, on: i <= v });
    return list;
  },

  onStar(e) {
    const v = Number(e.currentTarget.dataset.n) || 5;
    this.setData({ rating: v, stars: this.buildStars(v) });
  },

  onContent(e) {
    this.setData({ content: e.detail.value });
  },

  submit() {
    if (this.data.submitting) return;
    const content = String(this.data.content || '').trim();
    if (!content) return this.setData({ error: '写两句再提交吧' });
    if (!this.data.id) return this.setData({ error: '缺少美食 id' });

    this.setData({ submitting: true, error: '' });
    request(
      '/api/food-reviews',
      { food_id: this.data.id, content: content, rating: this.data.rating },
      { method: 'POST' }
    )
      .then(() => {
        this.setData({ submitting: false });
        // 列表页 onShow 看到这个标记就重拉，否则回去还看不到自己刚写的评价
        const app = getApp();
        if (app && app.globalData) app.globalData.foodsDirty = true;
        wx.showToast({ title: '已提交', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch((e) =>
        this.setData({ submitting: false, error: (e && e.message) || '提交失败' })
      );
  }
});
