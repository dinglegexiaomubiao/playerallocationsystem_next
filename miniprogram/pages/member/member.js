const { request, getBase } = require('../../utils/api');
const { fullUrl, regionShort, fmtMonthDay } = require('../../utils/format');

// 名次徽标：1/2/3 用品牌色系，其余中性
const rankText = (n) => {
  if (!n) return '';
  return '第 ' + n + ' 名';
};

Page({
  data: {
    id: '',
    p: null,
    loading: true,
    error: ''
  },

  onLoad(query) {
    const id = String((query && query.id) || '');
    this.setData({ id: id });
    if (!id) {
      this.setData({ loading: false, error: '缺少群友 id' });
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  load() {
    const base = getBase();
    this.setData({ loading: true, error: '' });
    // 没有 /api/players/{id}，和网页详情页一样拉全量再按 id 找。
    // ⚠ 两边都按字符串比：雪花号转 Number 会丢最后一位，找出来是另一个人。
    return request('/api/players', null, { method: 'GET' })
      .then((res) => {
        const list = (res && res.players) || [];
        const raw = list.filter((x) => String(x.id) === this.data.id)[0];
        if (!raw) {
          this.setData({ loading: false, error: '没找到这位群友' });
          return;
        }

        const records = (Array.isArray(raw.records) ? raw.records : []).slice()
          .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));

        const name = raw.nickname || raw.group_nickname || '未命名';
        const guild = raw.guild || null;

        this.setData({
          loading: false,
          p: {
            nickname: name,
            initial: name.charAt(0),
            avatar: fullUrl(base, raw.avatar || ''),
            groupNickname: raw.group_nickname || '',
            regionText: regionShort(raw.region),
            selfIntro: raw.self_intro || '',
            score: raw.score || 0,
            winRate: raw.win_rate || 0,
            championships: raw.championships || 0,
            runnerUp: raw.runner_up || 0,
            recordCount: raw.record_count || 0,
            bestRank: raw.best_rank || 0,
            guildName: guild ? guild.name : '',
            guildSlogan: guild ? guild.slogan || '' : '',
            positions: Array.isArray(raw.positions) ? raw.positions : [],
            heroesText: (Array.isArray(raw.heroes) ? raw.heroes : []).join('、'),
            synergyText: (Array.isArray(raw.synergy_players) ? raw.synergy_players : []).join('、'),
            enemiesText: (Array.isArray(raw.enemies) ? raw.enemies : []).join('、'),
            records: records.map((r) => ({
              key: String(r.team_id) + '-' + String(r.tournament_id),
              tournament: r.tournament_name || '未命名赛事',
              team: r.team_name || '',
              // ⚠ start_date 是 date 列，pg 按本地零点转成 Date 再序列化成
              // 2026-01-22T16:00:00.000Z（+08 的 01-23）。必须走 Date 取本地日，
              // 直接截字符串会整体差一天。
              dateText: r.start_date ? fmtMonthDay(r.start_date) : '',
              rankText: rankText(r.team_rank),
              rank: r.team_rank || 0
            }))
          }
        });
      })
      .catch((e) =>
        this.setData({ loading: false, error: (e && e.message) || '加载失败' })
      );
  }
});
