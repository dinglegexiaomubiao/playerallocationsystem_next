const { request, getBase } = require('../../utils/api');
const { fullUrl, regionShort, fmtMonthDay } = require('../../utils/format');
const { buildInsight } = require('../../utils/insight');
const session = require('../../utils/session');

// 名次徽标：1/2/3 用品牌色系，其余中性
const rankText = (n) => {
  if (!n) return '';
  return '第 ' + n + ' 名';
};

// 战绩解读是本地按规则算的（utils/insight.js），毫秒级返回，所以不设缓存：
// 之前那套 30 分钟 storage 缓存是给服务端大模型分析用的，现在没有等待成本了。
const EMPTY_STATS = { status: 'idle', error: '', data: null };
const EMPTY_INSIGHT = { status: 'idle', error: '', blocks: [], items: 0, emptyText: '' };

Page({
  data: {
    id: '',
    p: null,
    gameId: '',
    loading: true,
    error: '',
    loggedIn: false,
    stats: EMPTY_STATS,
    insight: EMPTY_INSIGHT
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
    // 从登录页回来要立刻反映登录态（页面上有「登录后可用」之类的提示位）
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

        const records = (Array.isArray(raw.records) ? raw.records : []).slice()
          .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));

        const name = raw.nickname || raw.group_nickname || '未命名';
        const guild = raw.guild || null;

        this.setData({
          loading: false,
          // SteamID 是拉 OpenDota 战绩的唯一钥匙，也是战绩解读的前置条件
          gameId: raw.game_id ? String(raw.game_id) : '',
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

  // ---------------- 近期战绩（OpenDota，下面的战绩解读复用这份数据） ----------------

  loadStats() {
    const gid = this.data.gameId;
    if (!gid) return Promise.reject(new Error('这位群友没填 SteamID'));
    if (this.data.stats.status === 'loading') return Promise.reject(new Error('正在拉取'));
    this.setData({ stats: { status: 'loading', error: '', data: null } });

    return request('/api/player-stats?playerId=' + encodeURIComponent(gid), null, { method: 'GET' })
      .then((res) => {
        const s = (res && res.stats) || null;
        if (!s) throw new Error('接口没返回战绩');
        // 接口一次给几十场明细，这里只挑页面要显示的几项，别把整个 stats 塞进 setData
        const data = {
          total: s.recentTotal || 0,
          winRate: s.recentWinRate || 0,
          gpm: s.avgGpm || 0,
          kda: s.avgKda || '0',
          dmg: s.avgHeroDamage || 0,
          heroes: (s.mostPlayedHeroes || []).slice(0, 5).map((h) => ({
            name: h.name,
            text: h.matches + ' 场 · ' + h.winRate + '%'
          }))
        };
        this._stats = s;
        this.setData({ stats: { status: 'loaded', error: '', data: data } });
        return s;
      })
      .catch((e) => {
        const msg = (e && e.message) || '战绩加载失败';
        this.setData({ stats: { status: 'error', error: msg, data: null } });
        throw e;
      });
  },

  onTapStats() {
    if (this.data.stats.status === 'loaded') return;
    this.loadStats().catch((e) =>
      wx.showToast({ title: (e && e.message) || '战绩加载失败', icon: 'none' })
    );
  },

  // ---------------- 战绩解读（本地按规则统计，不调任何模型） ----------------

  onTapInsight() {
    if (!this.data.gameId) {
      wx.showToast({ title: '这位群友没填 SteamID', icon: 'none' });
      return;
    }
    if (this.data.stats.status === 'loading' || this.data.insight.status === 'running') return;
    this.runInsight();
  },

  /** 有战绩就直接算，没有就先拉一次再算。整段同步完成，不需要等待提示 */
  runInsight() {
    this.setData({ insight: Object.assign({}, EMPTY_INSIGHT, { status: 'running' }) });

    const compute = (stats) => {
      const raw = this._raw || {};
      const out = buildInsight(stats, {
        score: raw.score || 0,
        heroes: Array.isArray(raw.heroes) ? raw.heroes : [],
        win_rate: raw.win_rate || 0,
        positions: Array.isArray(raw.positions) ? raw.positions : []
      });
      this.setData({
        insight: {
          status: out.empty ? 'empty' : 'done',
          error: '',
          blocks: out.blocks,
          items: out.items,
          emptyText: out.emptyText
        }
      });
    };

    if (this._stats) {
      compute(this._stats);
      return Promise.resolve();
    }
    // 拉战绩失败时上面的战绩块自己会报错，这里只把解读区标成空，不重复喊
    return this.loadStats().then(compute, () => {
      this.setData({
        insight: {
          status: 'empty',
          error: '',
          blocks: [],
          items: 0,
          emptyText: '没能拉到公开战绩，暂时没有可统计的数据。'
        }
      });
    });
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
