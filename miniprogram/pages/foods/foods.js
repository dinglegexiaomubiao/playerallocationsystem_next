const { request } = require('../../utils/api');
const { stars, fmtDateTime } = require('../../utils/format');
const session = require('../../utils/session');

const ALL = '全部';

// 人均价格区间（对齐网页端 pages/food/index.js 的 PRICE_RANGES，单位元；min/max 为 null 表示该侧不设限）
const PRICE_RANGES = [
  { value: 'all', label: '不限', min: null, max: null },
  { value: '0-50', label: '¥50 以下', min: null, max: 50 },
  { value: '50-100', label: '¥50-100', min: 50, max: 100 },
  { value: '100-200', label: '¥100-200', min: 100, max: 200 },
  { value: '200-500', label: '¥200-500', min: 200, max: 500 },
  { value: '500+', label: '¥500 以上', min: 500, max: null }
];

Page({
  data: {
    list: [],
    cuisines: [ALL],
    cuisine: ALL,
    keyword: '',
    // 地区 / 推荐人 / 人均价格（对齐网页端 pages/food/index.js 的多维筛选）
    areas: [ALL],
    area: ALL,
    recommenders: [ALL],
    recommenderIndex: 0,
    recommender: ALL,
    priceRanges: PRICE_RANGES,
    price: 'all',
    total: 0,
    loading: true,
    error: '',
    // 管理员在小程序里只做「处置」这一件事：删掉违规评价。
    // 建店/改店/导入这些还是回网页后台（移动端做表格不现实）
    isAdmin: false
  },

  onLoad() {
    this.all = [];
    // 评价明细不进 data（809 家店全带上会撑爆 setData），
    // 展开时才按 id 从缓存里取。expanded 记在 id 上，筛选后也不会丢。
    this.reviewCache = {};
    this.expanded = {};
    this.setData({ isAdmin: !!(session.getUser() || {}).isAdmin });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  // 从评价页回来要能立刻看到自己刚写的那条，否则要手动下拉
  onShow() {
    const app = getApp();
    const isAdmin = !!(session.getUser() || {}).isAdmin;
    if (isAdmin !== this.data.isAdmin) this.setData({ isAdmin: isAdmin });
    if (app && app.globalData && app.globalData.foodsDirty) {
      app.globalData.foodsDirty = false;
      this.load();
    }
  },

  goReview(e) {
    const ds = e.currentTarget.dataset;
    if (!session.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    wx.navigateTo({
      url:
        '/pages/food-review/food-review?id=' +
        String(ds.id || '') +
        '&name=' +
        encodeURIComponent(String(ds.name || ''))
    });
  },

  load() {
    this.setData({ loading: true, error: '' });
    return request('/api/foods', null, { method: 'GET' })
      .then((res) => {
        const foods = (res && res.foods) || [];

        // 排序口径和网页 /map 右栏一致：评价数 → 星级 → 新。
        // 接口按 created_at DESC 返回，全是刚录入、零评价的店，直接渲染会整片「暂无评价」。
        const rows = foods.map((f) => {
          const reviews = Array.isArray(f.reviews) ? f.reviews : [];
          const id = String(f.id);
          // 时间戳是 timestamp（不带时区），服务端按本地时区序列化，直接 new Date 即可
          this.reviewCache[id] = reviews.map((r) => ({
            id: String(r.id),
            reviewer: r.reviewer || '匿名群友',
            content: r.content || '',
            stars: stars(r.rating),
            timeText: fmtDateTime(r.created_at)
          }));
          return {
            id: id,
            name: f.name || '未命名',
            cuisine: f.cuisine || '',
            area: f.area || '',
            address: f.address || '',
            feature: f.feature || '',
            nearby: f.nearby || '',
            recommender: f.recommender || '',
            rating: Number(f.rating) || 0,
            ratingStars: stars(f.rating),
            priceText: f.avg_price ? '人均 ¥' + f.avg_price : '',
            avgPrice: Number(f.avg_price) || 0,
            reviewCount: reviews.length,
            reviewText: reviews.length ? reviews.length + ' 条评价' : '暂无评价',
            hasMap: f.lat !== null && f.lng !== null && f.lat !== undefined && f.lng !== undefined
          };
        });

        rows.sort((a, b) => {
          if (b.reviewCount !== a.reviewCount) return b.reviewCount - a.reviewCount;
          if (b.rating !== a.rating) return b.rating - a.rating;
          return Number(b.id) - Number(a.id);
        });

        this.all = rows;

        const counter = {};
        for (const r of rows) {
          if (!r.cuisine) continue;
          counter[r.cuisine] = (counter[r.cuisine] || 0) + 1;
        }
        const cuisines = Object.keys(counter)
          .sort((a, b) => counter[b] - counter[a])
          .slice(0, 10);

        // 地区 / 推荐人 也按出现次数聚合，做筛选项（对齐网页端 facets）
        const areaCounter = {};
        const recCounter = {};
        for (const r of rows) {
          if (r.area) areaCounter[r.area] = (areaCounter[r.area] || 0) + 1;
          if (r.recommender) recCounter[r.recommender] = (recCounter[r.recommender] || 0) + 1;
        }
        const areas = Object.keys(areaCounter)
          .sort((a, b) => areaCounter[b] - areaCounter[a])
          .slice(0, 15);
        const recommenders = Object.keys(recCounter).sort(
          (a, b) => recCounter[b] - recCounter[a]
        );

        this.setData(
          {
            loading: false,
            cuisines: [ALL].concat(cuisines),
            areas: [ALL].concat(areas),
            recommenders: [ALL].concat(recommenders),
            total: rows.length
          },
          () => this.apply()
        );
      })
      .catch((e) =>
        this.setData({ loading: false, error: (e && e.message) || '加载失败' })
      );
  },

  apply() {
    const kw = String(this.data.keyword || '').trim().toLowerCase();
    const cuisine = this.data.cuisine;
    const area = this.data.area;
    const recommender = this.data.recommender;
    const price = this.data.price;
    const rows = this.all.filter((f) => {
      if (cuisine !== ALL && f.cuisine !== cuisine) return false;
      if (area !== ALL && f.area !== area) return false;
      if (recommender !== ALL && f.recommender !== recommender) return false;
      if (price !== 'all') {
        const pr = PRICE_RANGES.find((x) => x.value === price);
        if (pr) {
          if (pr.min !== null && f.avgPrice < pr.min) return false;
          if (pr.max !== null && f.avgPrice > pr.max) return false;
        }
      }
      if (!kw) return true;
      // 搜索范围对齐网页端 buildHaystack：店名 / 菜系 / 地区 / 地址 / 特色 / 推荐人 / 附近
      const hay = (
        f.name + ' ' + f.cuisine + ' ' + f.area + ' ' + f.address + ' ' +
        f.feature + ' ' + f.recommender + ' ' + f.nearby
      ).toLowerCase();
      return hay.indexOf(kw) >= 0;
    });
    // 展开状态按 id 记在外面，筛选/刷新后重新套用，不会因为重建数组就收起来
    const list = rows.map((f) => {
      const expanded = !!this.expanded[f.id];
      return Object.assign({}, f, {
        expanded: expanded,
        reviews: expanded ? this.reviewCache[f.id] || [] : [],
        toggleText: f.reviewCount ? (expanded ? '收起评价' : '看 ' + f.reviewCount + ' 条评价') : ''
      });
    });
    this.setData({ list: list });
  },

  /** 展开 / 收起某家店的评价 */
  toggleReviews(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    this.expanded[id] = !this.expanded[id];
    this.apply();
  },

  /**
   * 删掉一条评价（仅管理员，服务端也拦）。
   * 本地只改这一条，不整页重拉 —— 重拉会把展开状态和滚动位置一起丢掉。
   */
  removeReview(e) {
    const ds = e.currentTarget.dataset;
    const rid = String(ds.id || '');
    const foodId = String(ds.food || '');
    if (!rid || !this.data.isAdmin) return;

    wx.showModal({
      title: '删除这条评价',
      content: '删掉之后不能恢复。',
      confirmText: '删除',
      confirmColor: '#b02b25',
      success: (r) => {
        if (!r.confirm) return;
        request('/api/food-reviews', { id: rid }, { method: 'DELETE' })
          .then(() => {
            this.reviewCache[foodId] = (this.reviewCache[foodId] || []).filter((x) => x.id !== rid);
            const food = this.all.filter((f) => f.id === foodId)[0];
            if (food) {
              food.reviewCount = Math.max(0, (food.reviewCount || 0) - 1);
              food.reviewText = food.reviewCount ? food.reviewCount + ' 条评价' : '暂无评价';
            }
            wx.showToast({ title: '已删除', icon: 'success' });
            this.apply();
          })
          .catch((err) =>
            wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
          );
      }
    });
  },

  onCuisine(e) {
    const v = e.currentTarget.dataset.v || ALL;
    this.setData({ cuisine: v }, () => this.apply());
  },

  onArea(e) {
    const v = e.currentTarget.dataset.v || ALL;
    this.setData({ area: v }, () => this.apply());
  },

  onRecommender(e) {
    // picker 的 range 是字符串数组时，bindchange 返回的是「下标」而非字符串本身
    const idx = Number(e.detail.value) || 0;
    const v = this.data.recommenders[idx] || ALL;
    this.setData({ recommender: v, recommenderIndex: idx }, () => this.apply());
  },

  onPrice(e) {
    const v = e.currentTarget.dataset.v || 'all';
    this.setData({ price: v }, () => this.apply());
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value }, () => this.apply());
  },

  onClear() {
    this.setData(
      { keyword: '', cuisine: ALL, area: ALL, recommender: ALL, recommenderIndex: 0, price: 'all' },
      () => this.apply()
    );
  },

  onShareAppMessage() {
    return { title: 'DoDo 群友美食 · 深圳好店', path: '/pages/foods/foods' };
  },

  onShareTimeline() {
    return { title: 'DoDo 群友美食' };
  }
});
