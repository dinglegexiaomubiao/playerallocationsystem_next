// 我的赛事：我参加过的每一届 + 我在里面有队伍 / 是不是队长。
//
// 数据来自 GET /api/my-tournaments —— 它把「报名表」和「实际分组」两个来源按赛事合并，
// 因为老数据只填了队伍没填报名表（只查报名表会让老选手看到「还没参加过」）。
// 所以这里的「我的队伍」可能来自报名快照以外的来源，别在前端自己推。
const { request } = require('../../utils/api');
const { fmtDate, tourStatusText } = require('../../utils/format');

const SIGNUP_TEXT = {
  approved: '已通过',
  pending: '待审核',
  rejected: '未通过',
  withdrawn: '已退出'
};

Page({
  data: {
    loading: true,
    error: '',
    needLogin: false,
    bound: true,
    list: []
  },

  onLoad() {
    return this.load();
  },

  onShow() {
    // 从登录页回来重新拉
    if (this.data.needLogin) return this.load();
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  load() {
    this.setData({ loading: true, error: '', needLogin: false });
    return request('/api/my-tournaments', null, { method: 'GET' })
      .then((res) => {
        if (res && res.bound === false) {
          this.setData({ loading: false, bound: false, list: [] });
          return;
        }
        const list = (res && res.tournaments ? res.tournaments : []).map((t) => ({
          // 赛事 id 在别的接口里是数字，这里统一成字符串再拼 URL
          id: String(t.tournament_id),
          name: t.tournament_name || '未命名赛事',
          statusText: tourStatusText(t.tournament_status),
          captain: !!t.is_captain,
          teamsText: (Array.isArray(t.teams) ? t.teams : [])
            .map((x) => x.name)
            .filter(Boolean)
            .join('、'),
          signupText: SIGNUP_TEXT[t.signup_status] || '',
          dateText: t.signed_at ? fmtDate(t.signed_at) : ''
        }));
        this.setData({ loading: false, list: list });
      })
      .catch((e) => {
        if (e && e.statusCode === 401) {
          this.setData({ loading: false, needLogin: true });
          return;
        }
        this.setData({ loading: false, error: (e && e.message) || '加载失败' });
      });
  },

  onOpen(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    wx.navigateTo({ url: '/pages/tournament/tournament?id=' + id });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  }
});
