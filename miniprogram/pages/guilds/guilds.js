const { request, getBase } = require('../../utils/api');
const { fullUrl } = require('../../utils/format');

Page({
  data: { list: [], total: 0, mineCount: 0, loading: true, error: '' },

  onLoad() {
    this.load();
  },

  onShow() {
    // 建帮 / 解散 / 退出之后回到列表，要能立刻看到变化
    const app = getApp();
    if (app && app.globalData && app.globalData.guildListDirty) {
      app.globalData.guildListDirty = false;
      this.load();
    }
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  load() {
    this.setData({ loading: true, error: '' });
    const base = getBase();
    return request('/api/guilds', null, { method: 'GET' })
      .then((res) => {
        const guilds = (res && res.guilds) || [];
        // 接口已按「我所在的 → 人数多 → 建得早」排好，不要再重排
        const list = guilds.map((g) => {
          const heads = Array.isArray(g.headAvatars) ? g.headAvatars : [];
          return {
            id: String(g.id),
            name: g.name || '未命名帮派',
            slogan: g.slogan || '',
            // ⚠ color 是对象 {key,label,solid}，不是色值字符串；直接塞进 style 会变成 [object Object]
            color: (g.color && g.color.solid) || 'var(--brand)',
            leaderText: g.leaderName || '',
            memberText: (g.memberCount || 0) + '/' + (g.maxMembers || 0) + ' 人',
            isMine: !!g.isMine,
            heads: heads.slice(0, 5).map((h) => ({
              playerId: String(h.playerId || ''),
              nickname: h.nickname || '群友',
              initial: (h.nickname || '群').charAt(0),
              avatar: fullUrl(base, h.avatar || '')
            }))
          };
        });
        this.setData({
          loading: false,
          list: list,
          total: list.length,
          mineCount: list.filter((g) => g.isMine).length
        });
      })
      .catch((e) =>
        this.setData({ loading: false, error: (e && e.message) || '加载失败' })
      );
  },

  goMine() {
    wx.navigateTo({ url: '/pages/guild/guild' });
  },

  onTap(e) {
    const ds = e.currentTarget.dataset;
    // 同上：dataset 布尔值可能退化成字符串
    if (ds.mine === true || ds.mine === 'true') {
      // 自己帮派 → 直接进管理页
      wx.navigateTo({ url: '/pages/guild/guild' });
      return;
    }
    // 别人的帮派：小程序没有公开详情页（成员列表只给本帮成员看），
    // 说清楚加入方式比给一个空白页强
    wx.showModal({
      title: ds.name || '帮派',
      content: '帮派不能自己申请加入，只能被帮主邀请。需要的话让他进帮派页邀请你。',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  onShareAppMessage() {
    return { title: 'LaRoja 帮派 · 阵营与成员', path: '/pages/guilds/guilds' };
  },

  onShareTimeline() {
    return { title: 'LaRoja 帮派' };
  }
});
