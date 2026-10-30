// 个人信息编辑（对齐网页端 pages/profile.js 的可编辑字段）。
//
// ⚠ 只提交「改动过的字段」：PUT /api/profile 对数字字段的约定是
//   传 '' 或 null = 清空、传数字 = 覆盖、**不传** = 保持原值。
//   整表提交等于把用户没动过的字段也写一遍，一次手滑就能把天梯分清成空。
//   所以这里存一份 _base 快照，保存前逐字段比。
//
// ⚠ 留空 = 不修改（不是清空）。分数这列清空的唯一办法是填 0，
//   比「删掉就没了」更难误操作。
//
// 有意不做（去网页端）：
//   - 群昵称 / SteamID 这类「多值身份」：服务端 replaceIdentities 要求保留主号，
//     删空会导致头像、战绩、赛程集体失联；小程序不做这套交互。
//   - 擅长项用擅长项列表选（网页端有擅长项图标库），这里退化成逗号分隔的文本。
const { request } = require('../../utils/api');
const { loadOptions } = require('../../utils/options');
const session = require('../../utils/session');

const toast = (t) => wx.showToast({ title: t, icon: 'none' });

// 服务端 toList 用的同一套分隔符，反过来拼串时统一用逗号
function toArray(text) {
  return String(text || '')
    .split(/[，,、\/;；|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// '5200' / 5200 → 5200；'' / null → null（表示「这次不改」）
function toInt(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return null;
  return Number(s);
}

// 身份数组在服务端有两种历史形态：['123'] 和 [{accountId:'123', isPrimary:true}]。
// 统一成 [{accountId,isPrimary}]：既给页面显示用，也直接喂给 player-deep 试号。
function toAccounts(list, gameId) {
  const out = [];
  const seen = {};
  (Array.isArray(list) ? list : []).forEach(function (a) {
    const raw = a && typeof a === 'object' ? a.accountId : a;
    const id = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!id || seen[id]) return;
    seen[id] = 1;
    out.push({ accountId: id, isPrimary: !!(a && typeof a === 'object' && a.isPrimary) });
  });
  // 主号排前面：只有一个号时它就是主号
  out.sort(function (x, y) {
    return (y.isPrimary ? 1 : 0) - (x.isPrimary ? 1 : 0);
  });
  const gid = String(gameId === undefined || gameId === null ? '' : gameId).trim();
  if (!out.length && gid) out.push({ accountId: gid, isPrimary: true });
  return out;
}

// 群昵称同理：{nickname,isPrimary} → 纯字符串（wxml 里直接渲染，别再出现 [object Object]）
function nicknameTexts(list) {
  return (Array.isArray(list) ? list : [])
    .map(function (a) {
      return String(a && typeof a === 'object' ? a.nickname || '' : a || '').trim();
    })
    .filter(Boolean);
}

function emptyInfo() {
  return {
    nickname: '',
    gameId: '',
    guildName: '',
    steamIds: [],
    steamAccounts: [],
    groupNicknames: [],
    avatar: ''
  };
}

Page({
  data: {
    loading: true,
    error: '',
    needLogin: false,
    bound: true,
    saving: false,
    form: {
      score: '',
      peak_score: '',
      win_rate: '',
      positions: [],
      heroes: '',
      region: '',
      self_intro: '',
      synergy: '',
      enemies: ''
    },
    posChips: [],
    limits: {},
    // 战绩解读要登录（与名片页同一条规则），交给 player-deep 判断
    loggedIn: false,
    // 喂给 player-deep 的选手资料（服务端解读用，字段名按后端约定）
    insightPlayer: null,
    info: emptyInfo()
  },

  onLoad() {
    return this.load();
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  load() {
    this.setData({ loading: true, error: '', needLogin: false });
    return Promise.all([
      request('/api/profile', null, { method: 'GET' }),
      loadOptions().catch(() => null)
    ])
      .then((res) => {
        const d = res[0] || {};
        const opts = res[1] || {};
        const limits = opts.limits || {};
        const positionsAll = Array.isArray(opts.positions) ? opts.positions : [];

        if (!d.bound || !d.profile) {
          this.setData({ loading: false, bound: false, info: emptyInfo(), insightPlayer: null });
          return;
        }

        const p = d.profile;
        // 服务端返回的原始值，保存时用来做 diff
        this._base = {
          score: p.score === null || p.score === undefined ? 0 : Number(p.score),
          peak_score: p.peak_score === null || p.peak_score === undefined ? 0 : Number(p.peak_score),
          win_rate: p.win_rate === null || p.win_rate === undefined ? 0 : Number(p.win_rate),
          positions: Array.isArray(p.positions) ? p.positions.slice() : [],
          heroes: Array.isArray(p.heroes) ? p.heroes.slice() : [],
          region: p.region || '',
          self_intro: p.self_intro || '',
          synergy_players: Array.isArray(p.synergy_players) ? p.synergy_players.slice() : [],
          enemies: Array.isArray(p.enemies) ? p.enemies.slice() : []
        };

        const guild = p.guild || null;
        // 服务端给的是 [{accountId,personaName,isPrimary}]，页面要显示字符串、
        // 组件要拿结构化数组，所以两边都从这里派生，别再让 wxml 直接渲染对象。
        const steamAccounts = toAccounts(p.steamIds, p.game_id);
        this.setData({
          loading: false,
          bound: true,
          limits: limits,
          // 从登录页回来/换账号后，解读按钮的可用性要跟着变
          loggedIn: !!session.isLoggedIn(),
          info: {
            nickname: p.nickname || '未命名',
            gameId: p.game_id || '',
            guildName: guild ? guild.name || '' : '',
            // 多值身份只读展示，编辑走网页端
            steamIds: steamAccounts.map((a) => a.accountId),
            steamAccounts: steamAccounts,
            groupNicknames: nicknameTexts(p.groupNicknames),
            avatar: p.avatar || ''
          },
          // 解读用的选手资料（服务端拼 prompt 用）。默契队友这里是选手 id，
          // 个人信息页拿不到昵称映射，索性不传，免得 prompt 里出现一串数字。
          insightPlayer: {
            nickname: p.nickname || '',
            score: this._base.score || 0,
            positions: this._base.positions,
            heroes: this._base.heroes,
            win_rate: this._base.win_rate || 0,
            championships: p.championships || 0
          },
          form: {
            score: String(this._base.score || ''),
            peak_score: String(this._base.peak_score || ''),
            win_rate: String(this._base.win_rate || ''),
            positions: this._base.positions,
            heroes: this._base.heroes.join(', '),
            region: this._base.region,
            self_intro: this._base.self_intro,
            synergy: this._base.synergy_players.join(', '),
            enemies: this._base.enemies.join(', ')
          },
          posChips: this._chips(positionsAll, this._base.positions)
        });
      })
      .catch((e) => {
        const code = e && e.statusCode;
        if (code === 401) {
          this.setData({ loading: false, needLogin: true });
          return;
        }
        this.setData({ loading: false, error: (e && e.message) || '加载失败' });
      });
  },

  _chips(all, picked) {
    const chosen = (picked || []).map(String);
    return (all || []).map((name) => ({ name: name, on: chosen.indexOf(name) >= 0 }));
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const patch = {};
    patch['form.' + key] = e.detail.value;
    this.setData(patch);
  },

  onRegion(e) {
    this.setData({ 'form.region': (e.detail && e.detail.value) || '' });
  },

  // 位置是多选：点上/取消。顺序按 options 的原始顺序，避免用户点出来的顺序
  // 变成「中单,优势路」这种在群友卡片上显示不一致的排列。
  onTogglePos(e) {
    const name = e.currentTarget.dataset.name;
    const cur = this.data.form.positions.slice();
    const i = cur.indexOf(name);
    if (i >= 0) cur.splice(i, 1);
    else cur.push(name);
    this.setData({
      'form.positions': cur,
      posChips: this._chips(
        this.data.posChips.map((x) => x.name),
        cur
      )
    });
  },

  onSave() {
    if (this.data.saving) return;
    const f = this.data.form;
    const base = this._base || {};

    // ---- 数字校验：服务端拒绝小数（integer 列会 500），这里先拦一轮
    const nums = [
      { key: 'score', label: '当前天梯分', max: 20000 },
      { key: 'peak_score', label: '历史最高分', max: 20000 },
      { key: 'win_rate', label: '自报胜率', max: 100 }
    ];
    const parsed = {};
    for (let i = 0; i < nums.length; i++) {
      const { key, label, max } = nums[i];
      const raw = String(f[key] || '').trim();
      if (!raw) continue; // 留空 = 不改
      if (!/^\d+$/.test(raw)) {
        toast(label + '要填整数');
        return;
      }
      const n = Number(raw);
      if (n > max) {
        toast(label + '不能超过 ' + max);
        return;
      }
      parsed[key] = n;
    }
    if (
      parsed.peak_score > 0 &&
      parsed.score > 0 &&
      parsed.peak_score < parsed.score
    ) {
      toast('历史最高分不应低于当前分');
      return;
    }

    // ---- 组装 diff
    const payload = {};
    Object.keys(parsed).forEach((k) => {
      if (parsed[k] !== base[k]) payload[k] = parsed[k];
    });

    const pos = f.positions.slice().sort((a, b) => {
      const all = this.data.posChips.map((x) => x.name);
      return all.indexOf(a) - all.indexOf(b);
    });
    if (pos.join(',') !== (base.positions || []).join(',')) payload.positions = pos;

    const heroes = toArray(f.heroes);
    if (heroes.join(',') !== (base.heroes || []).join(',')) payload.heroes = heroes;

    const synergy = toArray(f.synergy);
    if (synergy.join(',') !== (base.synergy_players || []).join(',')) payload.synergy_players = synergy;

    const enemies = toArray(f.enemies);
    if (enemies.join(',') !== (base.enemies || []).join(',')) payload.enemies = enemies;

    const region = String(f.region || '').trim();
    if (region !== (base.region || '')) payload.region = region;

    const intro = String(f.self_intro || '').trim();
    if (intro !== (base.self_intro || '')) payload.self_intro = intro;

    if (Object.keys(payload).length === 0) {
      toast('没有改动');
      return;
    }

    this.setData({ saving: true });
    request('/api/profile', payload, { method: 'PUT' })
      .then(() => {
        this.setData({ saving: false });
        toast('已保存');
        // 重新拉一次而不是拿 PUT 的返回值：PUT 返回的是库里的原始行，
        // positions/heroes 还是逗号串，直接塞进表单会显示成一行文本。
        return this.load();
      })
      .catch((e) => {
        this.setData({ saving: false });
        toast((e && e.message) || '保存失败');
      });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  onShow() {
    // 从登录页回来：登录态要立刻反映到「看解读」按钮上（组件按 logged-in 判断）
    const li = !!session.isLoggedIn();
    if (li !== this.data.loggedIn) this.setData({ loggedIn: li });
    // 刚才 401 的，重新拉一次
    if (this.data.needLogin) this.load();
  },

  goGuild() {
    wx.navigateTo({ url: '/pages/guild/guild' });
  }
});
