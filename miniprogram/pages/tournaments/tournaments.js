const { request } = require('../../utils/api');
const { fmtMonthDay, tourStatusText, tourStatusGroup } = require('../../utils/format');

// 赛事列表的筛选。
//
// 对齐网页端 /tournaments：那边有「状态 / 我的关系 / 关键词」三组筛选。
// 关系那组（我报名的、我参加的、我是队长、我拿名次了）在小程序里有独立页面
// pages/my-tournaments 覆盖，所以这里只做状态 + 关键词两组，避免两处口径打架。
const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'planning', label: '筹备中' },
  { key: 'live', label: '进行中' },
  { key: 'finished', label: '已结束' }
];

Page({
  data: {
    list: [],
    shown: [],
    loading: true,
    error: '',
    tabs: STATUS_TABS,
    group: '',
    q: '',
    // 有赛事但筛不出来时文案要不一样，否则用户会以为「这站一个赛事都没有」
    emptyText: '还没有赛事'
  },

  onLoad() {
    this.load();
  },
  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  load() {
    this.setData({ loading: true, error: '' });
    return request('/api/tournaments', null, { method: 'GET' })
      .then((res) => {
        const tours = (res && res.tournaments) || [];
        const list = tours.map((t) => ({
          id: String(t.id),
          name: t.name || '未命名赛事',
          statusText: tourStatusText(t.status),
          // 分组口径跟网页端 statusGroup 一致（见 utils/format.js 的注释）
          group: tourStatusGroup(t.status),
          timeText: [fmtMonthDay(t.start_date), fmtMonthDay(t.end_date)].filter(Boolean).join(' — '),
          champion: t.champions_text || t.champion_team_name || '',
          sponsor: t.sponsor_info || ''
        }));
        this.setData({ loading: false, list }, () => this.applyFilter());
      })
      .catch((e) => this.setData({ loading: false, error: (e && e.message) || '加载失败' }));
  },

  // 纯本地过滤：赛事列表一次全量返回，不必每切一次 tab 就打一次接口
  applyFilter() {
    const group = this.data.group;
    const q = String(this.data.q || '').trim().toLowerCase();
    const shown = this.data.list.filter((t) => {
      if (group && t.group !== group) return false;
      if (q) {
        const hay = (t.name + ' ' + t.champion + ' ' + t.sponsor).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    this.setData({
      shown: shown,
      emptyText: this.data.list.length ? '没有符合条件的赛事' : '还没有赛事'
    });
  },

  onStatusTab(e) {
    const key = String((e.currentTarget.dataset && e.currentTarget.dataset.key) || '');
    if (key === this.data.group) return;
    this.setData({ group: key }, () => this.applyFilter());
  },

  onSearch(e) {
    this.setData({ q: e.detail.value || '' }, () => this.applyFilter());
  },

  clearSearch() {
    if (!this.data.q) return;
    this.setData({ q: '' }, () => this.applyFilter());
  },

  onOpen(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    wx.navigateTo({ url: '/pages/tournament/tournament?id=' + id });
  },

  onShareAppMessage() {
    return { title: 'DoDo 赛事中心 · 历届名次', path: '/pages/tournaments/tournaments' };
  },

  onShareTimeline() {
    return { title: 'DoDo 赛事中心' };
  }
});
