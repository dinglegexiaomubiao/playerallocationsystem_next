const { request, getBase } = require('../../utils/api');
const { fullUrl, regionShort, fmtMonthDay } = require('../../utils/format');
const { parseAnalysis } = require('../../utils/ai-text');
const session = require('../../utils/session');

// 名次徽标：1/2/3 用品牌色系，其余中性
const rankText = (n) => {
  if (!n) return '';
  return '第 ' + n + ' 名';
};

// AI 结果本地缓存（对齐网页端 useAIAnalysis 的浏览器本地缓存）。
// ⚠ 只留最近 20 条：storage 有 10MB 上限，无限追加迟早把别的键挤掉。
const AI_CACHE_KEY = 'aiAnalysisCache';
const AI_CACHE_MAX = 20;

function readAiCache() {
  try {
    const raw = wx.getStorageSync(AI_CACHE_KEY);
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    return {};
  }
}

function saveAiCache(map) {
  try {
    const keys = Object.keys(map);
    if (keys.length > AI_CACHE_MAX) {
      // 先删最早写入的那几条（值里带 at 时间戳）
      keys
        .sort((a, b) => (map[a].at || 0) - (map[b].at || 0))
        .slice(0, keys.length - AI_CACHE_MAX)
        .forEach((k) => delete map[k]);
    }
    wx.setStorageSync(AI_CACHE_KEY, map);
  } catch (e) {
    /* 存不下就只留内存，不影响本次查看 */
  }
}

const EMPTY_STATS = { status: 'idle', error: '', data: null };
const EMPTY_AI = { status: 'idle', error: '', blocks: [], items: 0, cached: false, elapsed: 0 };

Page({
  data: {
    id: '',
    p: null,
    gameId: '',
    loading: true,
    error: '',
    loggedIn: false,
    stats: EMPTY_STATS,
    ai: EMPTY_AI
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
    // 从登录页回来要立刻能点「AI 分析」，所以每次显示都重读一次登录态
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
          // SteamID 是拉 OpenDota 战绩的唯一钥匙，也是 AI 分析的前置条件
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

        // 回到同一页时先把缓存里已有的分析摆出来，不用再等一分钟
        const key = 'player_' + String(raw.id);
        const hit = readAiCache()[key];
        if (hit && hit.text) {
          const parsed = parseAnalysis(hit.text);
          this.setData({
            ai: {
              status: 'done',
              error: '',
              blocks: parsed.blocks,
              items: parsed.items,
              cached: true,
              elapsed: 0
            }
          });
        }
      })
      .catch((e) =>
        this.setData({ loading: false, error: (e && e.message) || '加载失败' })
      );
  },

  // ---------------- 近期战绩（OpenDota，AI 分析也要用） ----------------

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

  // ---------------- AI 战力分析 ----------------

  onTapAI() {
    // 顺序有讲究：先看数据有没有（缺 SteamID 登录了也没用），再看登录态。
    // 反过来的话，用户会被赶去登录，登录回来才发现这人根本没有 SteamID。
    if (!this.data.gameId) {
      wx.showToast({ title: '这位群友没填 SteamID', icon: 'none' });
      return;
    }
    if (!session.isLoggedIn()) {
      wx.showToast({ title: '登录后才能用 AI 分析', icon: 'none' });
      setTimeout(() => wx.navigateTo({ url: '/pages/login/login' }), 600);
      return;
    }
    if (this.data.ai.status === 'running' || this.data.stats.status === 'loading') return;
    this.runAnalysis();
  },

  /** 顺序固定：没有战绩就先拉战绩，再让服务端分析（服务端 prompt 就是把 stats 喂进去的） */
  runAnalysis() {
    this.setData({ ai: Object.assign({}, EMPTY_AI, { status: 'running' }) });
    const startedAt = Date.now();

    const ensureStats = this._stats
      ? Promise.resolve(this._stats)
      : this.loadStats().catch(() => null);

    return ensureStats
      .then((stats) => {
        const raw = this._raw || {};
        const synergy = (Array.isArray(raw.synergy_players) ? raw.synergy_players : [])
          .map((id) => (this._nameMap && this._nameMap[String(id)]) || String(id))
          .filter(Boolean);
        // 只发 prompt 真正读到的字段：整包 player 里有 records 等大字段，没必要传
        const player = {
          nickname: this.data.p ? this.data.p.nickname : '',
          score: raw.score || 0,
          positions: Array.isArray(raw.positions) ? raw.positions : [],
          heroes: Array.isArray(raw.heroes) ? raw.heroes : [],
          win_rate: raw.win_rate || 0,
          championships: raw.championships || 0,
          synergy_names: synergy
        };
        return request(
          '/api/ai-analysis',
          { type: 'player', data: { player: player, stats: stats || null } },
          { method: 'POST' }
        );
      })
      .then((res) => {
        const text = (res && res.analysis) || '';
        if (!text) throw new Error('AI 返回了空内容，稍后重试');
        const parsed = parseAnalysis(text);
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        this.setData({
          ai: {
            status: 'done',
            error: '',
            blocks: parsed.blocks,
            items: parsed.items,
            cached: !!(res && res.cached),
            elapsed: elapsed
          }
        });
        const key = 'player_' + this.data.id;
        const map = readAiCache();
        map[key] = { text: text, at: Date.now() };
        saveAiCache(map);
      })
      .catch((e) => {
        const raw = (e && e.message) || '分析失败';
        // 客户端 60 秒默认超时，而服务端允许 90 秒 —— 超时是**正常路径**，
        // 此时服务端多半还在算（算完会进 30 分钟缓存），所以文案要给「再试一次」而不是「失败了」
        const isTimeout = /timeout|超时/i.test(raw);
        this.setData({
          ai: {
            status: 'error',
            error: isTimeout
              ? '等待超时了。AI 通常要 30~60 秒，服务端算完会缓存 30 分钟 —— 现在再点一次通常几秒就出来。'
              : raw,
            blocks: [],
            items: 0,
            cached: false,
            elapsed: 0
          }
        });
      });
  },

  /** 「重新分析」：清掉本地缓存后重跑（服务端仍可能命中它自己的 30 分钟缓存，页面会标出来） */
  rerunAI() {
    const key = 'player_' + this.data.id;
    const map = readAiCache();
    if (map[key]) {
      delete map[key];
      saveAiCache(map);
    }
    this._stats = null;
    this.runAnalysis();
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
