const { request, getBase } = require('../../utils/api');
const { fullUrl, regionShort } = require('../../utils/format');

Page({
  data: { list: [], loading: true, error: '', total: 0 },

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
    const base = getBase();
    return request('/api/players', null, { method: 'GET' })
      .then((res) => {
        const players = (res && res.players) || [];
        const list = players.map((p) => {
          const heroes = Array.isArray(p.heroes) ? p.heroes : [];
          const positions = Array.isArray(p.positions) ? p.positions : [];
          const name = p.nickname || p.group_nickname || '未命名';
          const meta = [regionShort(p.region), p.group_nickname ? '群昵称 ' + p.group_nickname : '']
            .filter(Boolean)
            .join(' · ');
          return {
            id: String(p.id),
            nickname: name,
            initial: name.charAt(0),
            meta: meta,
            score: p.score || 0,
            positions: positions,
            heroesText: heroes.slice(0, 4).join('、'),
            heroesMore: heroes.length > 4 ? heroes.length - 4 : 0,
            championships: p.championships || 0,
            guildName: (p.guild && p.guild.name) || '',
            avatar: fullUrl(base, p.avatar || p.avatar_url || '')
          };
        });
        this.setData({ loading: false, list, total: list.length });
      })
      .catch((e) => this.setData({ loading: false, error: (e && e.message) || '加载失败' }));
  },

  onTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    // id 是 17 位雪花号，拼 URL 时保持字符串，别 Number()（会丢最后一位）
    wx.navigateTo({ url: '/pages/member/member?id=' + String(id) });
  }
});
