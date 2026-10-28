const { request, getBase } = require('../../utils/api');
const { fullUrl, fmtDate } = require('../../utils/format');

Page({
  data: {
    list: [],
    total: 0,
    mineCount: 0,
    loading: true,
    error: '',
    // 他人帮派详情（底部弹层）。网页端 /guild/[id] 是公开页，小程序原来只弹一句
    // 「不能自己申请加入」，看不到口号/首领/成员，跟网页端不齐。
    // 这里不新拉接口：/api/guilds 已经把口号、首领、成员数、前 5 位成员头像都返回了。
    detail: null
  },

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
            // 17 位雪花号，全程字符串；空值保持空串，别塞 null 进 dataset
            leaderPlayerId: g.leaderPlayerId ? String(g.leaderPlayerId) : '',
            memberText: (g.memberCount || 0) + '/' + (g.maxMembers || 0) + ' 人',
            memberCount: Number(g.memberCount || 0),
            maxMembers: Number(g.maxMembers || 0),
            createdText: fmtDate(g.createdAt),
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
    // 别人的帮派 → 展开只读详情，对齐网页端 /guild/[id]（那一页对所有人公开）
    const g = this.data.list.filter((x) => x.id === String(ds.id))[0];
    if (g) this.setData({ detail: g });
  },

  closeDetail() {
    this.setData({ detail: null });
  },

  // 遮罩上的 catchtouchmove 要有个真函数，否则弹层开着时手指滑动会滚动底下的列表
  noop() {},

  // 弹层里点首领 / 成员头像 → 该群友的名片（网页端成员列表同样是每人都能点）
  goMember(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id) return;
    this.setData({ detail: null });
    wx.navigateTo({ url: '/pages/member/member?id=' + id });
  },

  // 帮派不能自己申请加入（服务端就没有这个接口），只能被帮主邀请。
  // 这句提示原来放在弹窗里，现在挪到详情底部，别删——删了就没人知道怎么进帮。
  copyName() {
    const d = this.data.detail;
    if (!d) return;
    wx.setClipboardData({
      data: d.name,
      success: () => wx.showToast({ title: '帮派名已复制', icon: 'none' })
    });
  },

  onShareAppMessage() {
    return { title: 'DoDo 帮派 · 阵营与成员', path: '/pages/guilds/guilds' };
  },

  onShareTimeline() {
    return { title: 'DoDo 帮派' };
  }
});
