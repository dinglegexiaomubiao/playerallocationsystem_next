const { request } = require('../../utils/api');
const { fmtMonthDay, tourStatusText } = require('../../utils/format');

Page({
  data: { list: [], loading: true, error: '' },

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
          timeText: [fmtMonthDay(t.start_date), fmtMonthDay(t.end_date)].filter(Boolean).join(' — '),
          champion: t.champions_text || t.champion_team_name || '',
          sponsor: t.sponsor_info || ''
        }));
        this.setData({ loading: false, list });
      })
      .catch((e) => this.setData({ loading: false, error: (e && e.message) || '加载失败' }));
  },

  onOpen(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    wx.navigateTo({ url: '/pages/tournament/tournament?id=' + id });
  }
});
