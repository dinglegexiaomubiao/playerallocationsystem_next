// 站点更新日志（对齐网页端 /changelog）。
//
// 数据走 GET /api/changelog，服务端直接读 lib/changelog.js —— **不在这里抄一份**：
// 抄了就是两份数据，网页端每次上线往里加条目、小程序这份忘了跟，两边就开始说
// 不同的话（这坑在 member-filter 上踩过一次）。而且照抄会把 adminOnly 条目
// 一起搬过来，过滤必须在服务端做，前端隐藏不算隐藏。
//
// 网页端每条带 href（「去哪看」），那些都是网页路由，小程序里跳不过去，
// 所以这里不渲染链接，只把「哪天、改了什么」说清楚。
const { request } = require('../../utils/api');
const { fmtMD } = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: '',
    latest: '',
    isAdmin: false,
    groups: []
  },

  onLoad() {
    return this.load();
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  load() {
    this.setData({ loading: true, error: '' });
    return request('/api/changelog', null, { method: 'GET' })
      .then((res) => {
        const groups = (res && res.groups ? res.groups : []).map((g) => ({
          version: g.version,
          // date 是 'YYYY-MM-DD'，用 fmtMD 手拆：new Date('2026-10-24') 会被当 UTC 零点，
          // 跨时区会跳日
          dateText: fmtMD(g.date),
          title: g.title || '',
          items: (g.items || []).map((it, i) => ({
            // wx:key 要唯一；同一版本里标题理论上不重复，但加上序号更稳
            uid: g.version + '-' + i,
            title: it.title || '',
            adminOnly: !!it.adminOnly,
            // clock 只有管理员拿得到（服务端按 isAdmin 决定给不给），群友按天看就够
            timeText: it.clock || ''
          }))
        }));
        const latest = (res && res.latest) || '';
        this.setData({
          loading: false,
          latest: latest,
          isAdmin: !!(res && res.isAdmin),
          groups: groups
        });
        // 导航栏带上最新版本号，一眼知道小程序看到的是不是最新的
        if (latest) wx.setNavigationBarTitle({ title: '更新日志 v' + latest });
      })
      .catch((e) =>
        this.setData({ loading: false, error: (e && e.message) || '加载失败' })
      );
  },

  onShareAppMessage() {
    return { title: 'DoDo资料查询 · 更新日志', path: '/pages/changelog/changelog' };
  },

  onShareTimeline() {
    return { title: 'DoDo资料查询 · 更新日志' };
  }
});
