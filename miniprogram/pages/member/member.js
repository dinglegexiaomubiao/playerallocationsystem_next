// 群友名片。
//
// 「近期战绩」和「战绩解读」两块已抽到 components/player-deep（个人信息页也在用），
// 页面只负责把账号列表和选手资料传下去。**别在这里重新实现一套**：
// 之前名片页和网页、个人信息页各写一份，口径和文案全靠人工同步，改一次漂一次。
const { request, getBase } = require('../../utils/api');
const { fullUrl, regionShort, fmtMonthDay } = require('../../utils/format');
const session = require('../../utils/session');

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
    error: '',
    loggedIn: false,
    // 组件的入参：多号时主号在前，组件自己按顺序试到第一个有对局的
    accounts: [],
    // 喂给「战绩解读」的选手资料（服务端拼 prompt 用）
    insightPlayer: null
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

  onShow() {
    // 从登录页回来要立刻反映登录态（「看解读」按钮的可用性看它）
    this.setData({ loggedIn: !!session.isLoggedIn() });
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
        this._raw = raw;
        this._nameMap = {};
        list.forEach((x) => {
          this._nameMap[String(x.id)] = x.nickname || x.group_nickname || '';
        });

        // 一个人可能有多个 Steam 号（主号 + 小号），对局是按账号分开的。
        // 网页端给的是切换器，小程序不重复那套 UI：把号按主号优先交给 player-deep，
        // 由它挨个试，并且多号时在数字旁边标出用的是哪个号。
        const accounts = (Array.isArray(raw.steamIds) ? raw.steamIds : [])
          .map((a) => (a && typeof a === 'object' ? a : { accountId: a }))
          .map((a) => ({ accountId: String(a.accountId || '').trim(), isPrimary: !!a.isPrimary }))
          .filter((a) => a.accountId);
        if (!accounts.length && raw.game_id) {
          accounts.push({ accountId: String(raw.game_id), isPrimary: true });
        }
        accounts.sort((x, y) => (y.isPrimary ? 1 : 0) - (x.isPrimary ? 1 : 0));

        const records = (Array.isArray(raw.records) ? raw.records : []).slice()
          .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));

        const name = raw.nickname || raw.group_nickname || '未命名';
        const guild = raw.guild || null;

        this.setData({
          loading: false,
          accounts: accounts,
          // 默契队友库里存的是选手 id，解读要的是名字，这里过一遍 _nameMap
          insightPlayer: {
            nickname: name,
            score: raw.score || 0,
            positions: Array.isArray(raw.positions) ? raw.positions : [],
            heroes: Array.isArray(raw.heroes) ? raw.heroes : [],
            win_rate: raw.win_rate || 0,
            championships: raw.championships || 0,
            synergy_names: (Array.isArray(raw.synergy_players) ? raw.synergy_players : []).map(
              (id) => this._nameMap[String(id)] || id
            )
          },
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
  },

  onShareAppMessage() {
    const name = this.data.p ? this.data.p.nickname : '群友';
    return { title: name + ' 的名片 · DoDo', path: '/pages/member/member?id=' + this.data.id };
  },

  onShareTimeline() {
    const name = this.data.p ? this.data.p.nickname : '群友';
    return { title: name + ' 的名片 · DoDo', query: 'id=' + this.data.id };
  }
});
