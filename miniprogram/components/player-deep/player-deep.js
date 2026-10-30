// 近期战绩 + 战绩解读（个人信息页 / 名片页共用的可复用组件）
//
// 入参：
//   accounts  [{ accountId, isPrimary }]  该选手的 Steam 号（多号时按顺序试，第一个有对局的胜出）
//   gameId    单个账号 ID（accounts 为空时的兜底，等价于只填一个号的 accounts）
//   player    选手资料（喂给服务端解读：nickname/score/positions/heroes/win_rate/championships）
//   loggedIn  是否已登录（解读要登录；未登录点按钮引导去登录页）
//
// 组件自己负责：拉 /api/player-matches、算汇总、调 /api/ai-analysis、渲染两块。
// 页面只管把参数传进来，不复制这套逻辑。
//
// 数据源口径：与网页成员页「最近比赛」同一个接口、同一个窗口（最多 200 场），
// 只吃 /api/player-matches，**不要**改成 /api/player-stats 的 recentMatches（最近 20 场）——
// 实测同一个号两边胜率能差 35 个百分点（25% vs 60%）。
// GPM / 英雄伤害只有近 20 场那个窗口有，接口单独打包成 recent20，页面上必须标「近 20 场」。
const { request } = require('../../utils/api');
const stat = require('../../utils/match-stat');

// 逐场明细一屏放 10 条，点「展开更多」再放 10 条（网页端一页 20 条，竖屏放不下）
const MATCH_STEP = 10;
// 近 20 场色块：与「近 20 场最高」同一个窗口
const TILE_COUNT = 20;

const EMPTY_STATS = { status: 'idle', error: '', data: null };
const EMPTY_INSIGHT = { status: 'idle', error: '', analysis: '', lines: [], emptyText: '', idleHint: '', idleBtn: '' };

// 「看解读」按钮的三种空闲态文案：没 SteamID / 未登录 / 可分析
function idleOf(hasAcc, loggedIn) {
  if (!hasAcc) return { idleHint: '还没填 SteamID，无法读取解读', idleBtn: '无 SteamID' };
  if (!loggedIn) return { idleHint: '解读会消耗接口额度，登录后可用', idleBtn: '登录后可用' };
  return { idleHint: '从服务器读取解读，仅供参考', idleBtn: '看解读' };
}

// 账号列表归一化：兼容 ['123'] / [{accountId:'123', isPrimary:true}] 两种历史形态，
// 主号排前面；一个都没有时退回 gameId。
function normAccounts(accounts, gameId) {
  const out = [];
  const seen = {};
  (Array.isArray(accounts) ? accounts : []).forEach(function (a) {
    const raw = a && typeof a === 'object' ? a.accountId : a;
    const id = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!id || seen[id]) return;
    seen[id] = 1;
    out.push({ accountId: id, isPrimary: !!(a && typeof a === 'object' && a.isPrimary) });
  });
  out.sort(function (x, y) {
    const a = x.isPrimary ? 1 : 0;
    const b = y.isPrimary ? 1 : 0;
    return b - a;
  });
  const gid = String(gameId === undefined || gameId === null ? '' : gameId).trim();
  if (!out.length && gid) out.push({ accountId: gid, isPrimary: true });
  return out;
}

function sigOf(list) {
  return list
    .map(function (a) {
      return (a.isPrimary ? 'P' : 'S') + a.accountId;
    })
    .join(',');
}

Component({
  properties: {
    accounts: { type: Array, value: [] },
    gameId: { type: String, value: '' },
    player: { type: Object, value: null },
    loggedIn: { type: Boolean, value: false }
  },

  data: {
    hasAcc: false,
    stats: EMPTY_STATS,
    insight: EMPTY_INSIGHT
  },

  lifetimes: {
    attached() {
      // 页面可能在挂载前就把账号填好了，这里先按当前入参算一遍
      this._reset(this.data.accounts, this.data.gameId, this.data.loggedIn);
    }
  },

  observers: {
    'accounts, gameId, loggedIn': function (accounts, gameId, loggedIn) {
      this._reset(accounts, gameId, loggedIn);
    }
  },

  methods: {
    // 账号集合没变时（只是登录态变了 / 页面重渲染），不把已经拉到的战绩清掉
    _reset(accounts, gameId, loggedIn) {
      const accs = normAccounts(accounts, gameId);
      const sig = sigOf(accs);
      const changed = sig !== this._sig;
      this._sig = sig;
      this._accounts = accs;
      const hasAcc = accs.length > 0;

      if (!changed) {
        const patch = {};
        if (this.data.hasAcc !== hasAcc) patch.hasAcc = hasAcc;
        if (this.data.insight.status === 'idle') {
          const idle = idleOf(hasAcc, !!loggedIn);
          patch['insight.idleHint'] = idle.idleHint;
          patch['insight.idleBtn'] = idle.idleBtn;
        }
        if (Object.keys(patch).length) this.setData(patch);
        return;
      }

      this._rows = null;
      this._stats = null;
      this._hitAcc = null;
      this.setData({
        hasAcc: hasAcc,
        stats: Object.assign({}, EMPTY_STATS),
        insight: Object.assign({}, EMPTY_INSIGHT, idleOf(hasAcc, !!loggedIn))
      });
    },

    // ---------------- 近期战绩（OpenDota，最多 200 场） ----------------

    onTapStats() {
      if (this.data.stats.status === 'loaded') return;
      this.loadStats().catch(function (e) {
        wx.showToast({ title: (e && e.message) || '战绩加载失败', icon: 'none' });
      });
    },

    // 按顺序试每个 Steam 号，第一个能拉到对局的胜出；全挂了把最后一个错误抛出去
    fetchByAccounts(list, i) {
      const idx = i || 0;
      const self = this;
      if (idx >= list.length) return Promise.resolve(null);
      const acc = list[idx];
      return request('/api/player-matches?accountId=' + encodeURIComponent(acc.accountId), null, {
        method: 'GET'
      }).then(
        function (res) {
          if (res && res.success !== false && Array.isArray(res.matches) && res.matches.length) {
            return { res: res, acc: acc };
          }
          return self.fetchByAccounts(list, idx + 1);
        },
        function (e) {
          // 主号挂了（未公开比赛数据 / OpenDota 超时）不该让整块报错，先试下一个号
          if (idx + 1 < list.length) return self.fetchByAccounts(list, idx + 1);
          throw e;
        }
      );
    },

    loadStats() {
      const accs = this._accounts || [];
      if (!accs.length) return Promise.reject(new Error('这个账号还没填 SteamID'));
      if (this.data.stats.status === 'loading') return Promise.reject(new Error('正在拉取'));
      const self = this;
      this.setData({ stats: { status: 'loading', error: '', data: null } });

      return this.fetchByAccounts(accs, 0)
        .then(function (hit) {
          if (!hit) {
            // 号是有的，但 OpenDota 上一场都没抓到（未公开比赛数据是最常见的原因）
            self._stats = null;
            self.setData({ stats: { status: 'empty', error: '', data: null } });
            return null;
          }
          const s = hit.res;
          const sum = stat.summarize(s.matches);
          const best = stat.bestOf(s.matches);
          const r20 = s.recent20 || null;

          /* 逐场明细一次映射好放内存（this._rows），setData 只推当前显示的那几条。
             直接把 200 条塞进视图层是 200~300KB，切页会卡。 */
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
          self._rows = rows;

          // 模式分布：网页端是可点的筛选 tab，竖屏放不下筛选条，摊成一行分布
          const modes = stat.modeBreakdown(s.matches)
            .slice(0, 4)
            .map(function (x) {
              return {
                label: x.label,
                total: x.total,
                pct: sum.total ? Math.round((x.total / sum.total) * 100) : 0
              };
            });

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
            // GPM 与伤害是近 20 场口径，单独一行标清
            gpm: r20 ? r20.avgGpm : 0,
            dmg: r20 ? r20.avgHeroDamage : 0,
            gpmTotal: r20 ? r20.total : 0,
            lifetimeText: s.lifetime
              ? s.lifetime.win + ' 胜 / ' + s.lifetime.lose + ' 负 · ' + s.lifetime.winRate + '%'
              : '',
            // 多号时标出用的是哪个号，避免和网页上主号的数字对不上时说不清
            accountLabel:
              accs.length > 1 ? (hit.acc.isPrimary ? '主号 ' : '小号 ') + hit.acc.accountId : '',
            heroes: stat.heroStatsOf(s.matches).slice(0, 5),
            // 近 20 场色块：最新在前，胜/负 + 英雄名
            tiles: rows.slice(0, TILE_COUNT),
            // 逐场明细：先给一屏，剩下点「展开更多」
            list: rows.slice(0, MATCH_STEP),
            listShown: Math.min(MATCH_STEP, rows.length),
            listMore: rows.length > MATCH_STEP
          };
          self._stats = s;
          // 解读优先用真正拉到数据的那个号
          self._hitAcc = hit.acc;
          self.setData({ stats: { status: 'loaded', error: '', data: data } });
          return s;
        })
        .catch(function (e) {
          const msg = (e && e.message) || '战绩加载失败';
          self.setData({ stats: { status: 'error', error: msg, data: null } });
          throw e;
        });
    },

    // 逐场明细「展开更多」：每次多放一屏，不动内存里的全量
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

    // ---------------- 战绩解读（服务器读取，需登录） ----------------

    onTapInsight() {
      if (!this._accounts || !this._accounts.length) {
        wx.showToast({ title: '还没填 SteamID', icon: 'none' });
        return;
      }
      // 与网页端一致：解读要消耗接口额度，必须登录。未登录直接引导去登录页。
      if (!this.data.loggedIn) {
        wx.navigateTo({ url: '/pages/login/login' });
        return;
      }
      if (this.data.insight.status === 'running') return;
      this.runAI();
    },

    // 调服务端 /api/ai-analysis（type=player），stats 传 null 让服务端自己去拉，
    // 小程序不碰模型、不存 key。服务端结果缓存 30 分钟。
    runAI() {
      const self = this;
      this.setData({ insight: Object.assign({}, EMPTY_INSIGHT, { status: 'running' }) });

      const src = this.data.player || {};
      const acc = this._hitAcc || (this._accounts && this._accounts[0]) || null;
      const player = {
        nickname: src.nickname || '',
        score: src.score || 0,
        positions: Array.isArray(src.positions) ? src.positions : [],
        heroes: Array.isArray(src.heroes) ? src.heroes : [],
        win_rate: src.win_rate || 0,
        championships: src.championships || 0,
        synergy_names: Array.isArray(src.synergy_names) ? src.synergy_names : [],
        // 服务端拿这个去拉战绩统计，再喂给模型
        game_id: acc ? acc.accountId : ''
      };

      return request(
        '/api/ai-analysis',
        { type: 'player', data: { player: player, stats: null } },
        { method: 'POST' }
      )
        .then(function (res) {
          if (res && res.success && res.analysis) {
            const text = String(res.analysis);
            // ** 是模型输出的加粗标记，原样保留；按行拆开渲染更稳（<text> 不保证保留换行）
            const lines = text
              .split('\n')
              .map(function (s) {
                return s.replace(/\s+$/, '');
              })
              .filter(function (s, i, arr) {
                return !(s === '' && (i === 0 || i === arr.length - 1));
              });
            self.setData({
              insight: { status: 'done', error: '', analysis: text, lines: lines, emptyText: '' }
            });
          } else {
            self.setData({
              insight: {
                status: 'error',
                error: (res && res.error) || '读取失败',
                analysis: '',
                lines: [],
                emptyText: ''
              }
            });
          }
        })
        .catch(function (e) {
          self.setData({
            insight: {
              status: 'error',
              error: (e && e.message) || '网络错误，请稍后重试',
              analysis: '',
              lines: [],
              emptyText: ''
            }
          });
        });
    }
  }
});
