const { request, getBase } = require('../../utils/api');
const { fullUrl, regionShort, fmtMonthDay } = require('../../utils/format');
const stat = require('../../utils/match-stat');
const session = require('../../utils/session');

// 名次徽标：1/2/3 用品牌色系，其余中性
const rankText = (n) => {
  if (!n) return '';
  return '第 ' + n + ' 名';
};

// 战绩解读 = 服务器调用大模型生成（POST /api/ai-analysis），小程序只负责拉取并展示，
// 自己不跑模型、也不存模型 key（算力在哪不影响审核判定，详见 小程序项目档案 提审记录）。
// 要走网络且可能耗时几秒，insight 有 idle / running / done / error / empty 五个态。
const EMPTY_STATS = { status: 'idle', error: '', data: null };
const EMPTY_INSIGHT = { status: 'idle', error: '', analysis: '', lines: [], emptyText: '', idleHint: '', idleBtn: '' };

// 「看解读」按钮的三种空闲态文案：无 SteamID / 未登录 / 可分析
function idleOf(gameId, loggedIn) {
  if (!gameId) return { idleHint: '这位群友还没填 SteamID，无法分析', idleBtn: '无 SteamID' };
  if (!loggedIn) return { idleHint: '解读会消耗接口额度，登录后可用', idleBtn: '登录后可用' };
  return { idleHint: '从服务器读取解读，仅供参考', idleBtn: '看解读' };
}

// 逐场明细一屏放 10 条，点「展开更多」再放 10 条。
// 网页端是每页 20 条（大屏够放），小程序竖屏 10 条刚好一屏，再多就得一直滑。
const MATCH_STEP = 10;
// 近 20 场色块：与网页端「近 20 场最高」同一个窗口
const TILE_COUNT = 20;

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
    if (this.data.gameId) this.syncInsightIdle();
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  load() {
    const base = getBase();
    // 下拉刷新会把名片重读一遍，战绩也得跟着重来（SteamID 可能刚改过），
    // 否则上面是新人、下面还是旧人的战绩。
    this._stats = null;
    this._rows = null;
    this.setData({
      loading: true,
      error: '',
      stats: Object.assign({}, EMPTY_STATS),
      insight: Object.assign({}, EMPTY_INSIGHT)
    });
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
        // 网页端给的是切换器，这里不重复那套 UI，只按「主号优先」自动挑一个能拉到数据的，
        // 页面标题上标出用的是哪个号——否则主号没数据的人在小程序里会显示成「没有战绩」。
        const accounts = (Array.isArray(raw.steamIds) ? raw.steamIds : [])
          .map((a) => (a && typeof a === 'object' ? a : { accountId: a }))
          .map((a) => ({ accountId: String(a.accountId || '').trim(), isPrimary: !!a.isPrimary }))
          .filter((a) => a.accountId);
        if (!accounts.length && raw.game_id) {
          accounts.push({ accountId: String(raw.game_id), isPrimary: true });
        }
        this._accounts = accounts;

        const gameId = accounts.length ? accounts[0].accountId : '';
        const idle = idleOf(gameId, !!session.isLoggedIn());

        const records = (Array.isArray(raw.records) ? raw.records : []).slice()
          .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));

        const name = raw.nickname || raw.group_nickname || '未命名';
        const guild = raw.guild || null;

        this.setData({
          loading: false,
          // SteamID 是拉 OpenDota 战绩的唯一钥匙，也是战绩解读的前置条件
          gameId: gameId,
          // 进入页面先把「看解读」按钮的空闲态文案算好（含未登录/无 SteamID 分支）
          insight: Object.assign({}, EMPTY_INSIGHT, idle),
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
  //
  // 数据源与网页成员页「最近比赛」同一个接口、同一个窗口（最多 200 场），
  // 这样两边的场次/胜率/KDA 才是同一个数字。
  // 之前用的是 /api/player-stats 的 recentMatches（最近 20 场），实测同一个号
  // 能差 35 个百分点（25% vs 60%），属于「看着都在算战绩，其实算的不是一回事」。
  //
  // GPM 和英雄伤害只有近 20 场那个窗口有，接口把它们单独打包成 recent20，
  // 页面上必须标「近 20 场」，不能和 200 场的胜率并排放在一起不看口径。

  /**
   * 按顺序试每个 Steam 号，第一个能拉到对局的胜出。
   * 全都没有（或全失败）时把最后一个错误抛出去。
   */
  fetchMatchesByAccounts(accounts, i) {
    const idx = i || 0;
    if (idx >= accounts.length) return Promise.resolve(null);
    const acc = accounts[idx];
    return request('/api/player-matches?accountId=' + encodeURIComponent(acc.accountId), null, {
      method: 'GET'
    }).then(
      (res) => {
        if (res && res.success !== false && Array.isArray(res.matches) && res.matches.length) {
          return { res: res, acc: acc };
        }
        return this.fetchMatchesByAccounts(accounts, idx + 1);
      },
      (e) => {
        // 主号挂了（未公开数据 / OpenDota 超时）不该让整个块报错，先试下一个号
        if (idx + 1 < accounts.length) return this.fetchMatchesByAccounts(accounts, idx + 1);
        throw e;
      }
    );
  },

  loadStats() {
    const accounts = this._accounts || [];
    if (!accounts.length) return Promise.reject(new Error('这位群友没填 SteamID'));
    if (this.data.stats.status === 'loading') return Promise.reject(new Error('正在拉取'));
    this.setData({ stats: { status: 'loading', error: '', data: null } });

    return this.fetchMatchesByAccounts(accounts, 0)
      .then((hit) => {
        if (!hit) {
          // 号是有的，但 OpenDota 上一场都没抓到（未公开比赛数据是最常见的原因）
          this._stats = null;
          this.setData({
            stats: {
              status: 'empty',
              error: '',
              data: null
            }
          });
          return null;
        }
        const s = hit.res;
        const sum = stat.summarize(s.matches);
        const best = stat.bestOf(s.matches);
        const r20 = s.recent20 || null;

        /* 逐场明细：一次把 200 场映射好放内存（this._rows），setData 只推当前要显示的那几条。
           直接 setData 200 条会把 200~300KB 塞进视图层，切页会卡。 */
        const rows = (Array.isArray(s.matches) ? s.matches : []).map(function (m, i) {
          return {
            key: m.matchId || 'm' + i,
            hero: m.hero || '未知',
            isWin: !!m.isWin,
            kdaText: (m.kills || 0) + '/' + (m.deaths || 0) + '/' + (m.assists || 0),
            kda: m.kda || '0.0',
            mode: m.modeLabel || '其他',
            durText: stat.fmtDuration(m.duration),
            patch: m.patch || '',
            rank: m.rankLabel || '',
            ago: stat.fmtAgo(m.startTime)
          };
        });
        this._rows = rows;

        // 模式分布：网页端是 tab + 计数，小程序不做筛选（竖屏下拉太重），只把分布摊开
        const modes = stat.modeBreakdown(s.matches)
          .slice(0, 4)
          .map(function (x) {
            return {
              label: x.label,
              total: x.total,
              pct: sum.total ? Math.round((x.total / sum.total) * 100) : 0
            };
          });

        // 接口一次给 200 场明细，这里只挑页面要显示的几项，别把整个响应塞进 setData
        const data = {
          total: sum.total,
          wins: sum.wins,
          losses: sum.losses,
          winRate: sum.winRate,
          kda: sum.kda,
          durationText: stat.fmtDuration(sum.avgDuration),
          bestKills: best.kills,
          bestAssists: best.assists,
          bestKda: best.kda,
          modes: modes,
          // GPM 与伤害是近 20 场口径，单独一行显示
          gpm: r20 ? r20.avgGpm : 0,
          dmg: r20 ? r20.avgHeroDamage : 0,
          gpmTotal: r20 ? r20.total : 0,
          lifetimeText: s.lifetime
            ? s.lifetime.win + ' 胜 / ' + s.lifetime.lose + ' 负 · ' + s.lifetime.winRate + '%'
            : '',
          // 多号时标出这是哪个号，避免和网页上主号的数字对不上时说不清
          accountLabel:
            accounts.length > 1
              ? (hit.acc.isPrimary ? '主号 ' : '小号 ') + hit.acc.accountId
              : '',
          heroes: stat.heroStatsOf(s.matches).slice(0, 5),
          // 近 20 场色块：按时间顺序（最新在前），胜/负 + 英雄名
          tiles: rows.slice(0, TILE_COUNT),
          // 逐场明细：先给一屏，剩下的点「展开更多」
          list: rows.slice(0, MATCH_STEP),
          listShown: Math.min(MATCH_STEP, rows.length),
          listMore: rows.length > MATCH_STEP
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

  /** 逐场明细「展开更多」：每次多放一屏，不动内存里的全量 */
  onTapMoreMatches() {
    const data = this.data.stats.data;
    const rows = this._rows || [];
    if (!data || !rows.length) return;
    const shown = Math.min(rows.length, (data.listShown || 0) + MATCH_STEP);
    this.setData({
      'stats.data.list': rows.slice(0, shown),
      'stats.data.listShown': shown,
      'stats.data.listMore': shown < rows.length
    });
  },

  // ---------------- 战绩解读：服务器调大模型，小程序拉取展示 ----------------

  /** 刷新「看解读」按钮的空闲态文案（无 SteamID / 未登录 / 可分析） */
  syncInsightIdle() {
    const idle = idleOf(this.data.gameId, !!session.isLoggedIn());
    this.setData({ 'insight.idleHint': idle.idleHint, 'insight.idleBtn': idle.idleBtn });
  },

  onTapInsight() {
    if (!this.data.gameId) {
      wx.showToast({ title: '这位群友没填 SteamID', icon: 'none' });
      return;
    }
    // AI 分析要消耗接口额度，与网页端一致：必须登录。未登录直接引导去登录页。
    if (!session.isLoggedIn()) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }
    if (this.data.insight.status === 'running') return;
    this.runAI();
  },

  /** 调服务端 /api/ai-analysis（type=player），服务端内部拉 stats 再生成；结果缓存 30 分钟 */
  runAI() {
    this.setData({ insight: Object.assign({}, EMPTY_INSIGHT, { status: 'running' }) });

    const raw = this._raw || {};
    const player = {
      nickname: (this.data.p && this.data.p.nickname) || '',
      score: raw.score || 0,
      positions: Array.isArray(raw.positions) ? raw.positions : [],
      heroes: Array.isArray(raw.heroes) ? raw.heroes : [],
      win_rate: raw.win_rate || 0,
      championships: raw.championships || 0,
      synergy_names: (Array.isArray(raw.synergy_players) ? raw.synergy_players : []).map(
        (id) => this._nameMap[String(id)] || id
      ),
      // 服务器靠这个去 OpenDota 拉战绩统计，再喂给大模型
      game_id: this.data.gameId
    };

    return request('/api/ai-analysis', { type: 'player', data: { player: player, stats: null } }, { method: 'POST' })
      .then((res) => {
        if (res && res.success && res.analysis) {
          const text = String(res.analysis);
          // ** 是模型输出的加粗标记，原样保留；按行拆开逐行渲染更稳（<text> 不保证保留换行）
          const lines = text
            .split('\n')
            .map((s) => s.replace(/\s+$/, ''))
            .filter((s, i, arr) => !(s === '' && (i === 0 || i === arr.length - 1)));
          this.setData({
            insight: { status: 'done', error: '', analysis: text, lines: lines, emptyText: '' }
          });
        } else {
          this.setData({
            insight: {
              status: 'error',
              error: (res && res.error) || '分析失败',
              analysis: '',
              lines: [],
              emptyText: ''
            }
          });
        }
      })
      .catch((e) => {
        this.setData({
          insight: {
            status: 'error',
            error: (e && e.message) || '网络错误，请稍后重试',
            analysis: '',
            lines: [],
            emptyText: ''
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
