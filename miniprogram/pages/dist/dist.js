// 群友分布：按行政区逐级下钻的排行榜。
//
// 与网页端的差别是**故意的**：网页画的是自绘 SVG 行政区地图，小程序既没有 SVG
// 也没有 canvas 优势，而原生 `map` 组件要用腾讯地图底图 + 自绘边界，涉及地图数据
// 合规与 key 管理 —— 为一张「谁住哪」的图不值得。所以这里用「排行 + 比例条 + 下钻」：
// 信息一样全（每级每个区多少人、点进去是谁），但没有地图标的合规负担。
//
// 数据：/api/map 落到默认层级（深圳市），下钻走 /api/map/geo?adcode=。
// 两个接口都带重字段（areas[].path 是 SVG 路径、每个区还挂着完整 players 数组），
// ⚠ 千万别整包 setData —— 一次 53KB 的响应直接塞进 data 很容易顶到 1MB 上限。
const { request } = require('../../utils/api');

Page({
  data: {
    loading: true,
    error: '',
    notice: '',
    crumbs: [],
    scopeName: '',
    isRoot: false,
    stats: [],
    areas: [],
    // 未填地区名单（只有首屏 /api/map 才有，下钻接口不返回）
    missing: [],
    // ⚠ WXML 里不能写 missing.slice(0, 12)（表达式不支持方法调用），预览截断在这里算好
    missingPreview: [],
    missingTotal: 0,
    missingOpen: false,
    loadingDrill: false
  },

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
    this.setData({ loading: true, error: '', notice: '' });
    return request('/api/map', null, { method: 'GET' })
      .then((res) => this.apply(res, true))
      .catch((e) => this.setData({ loading: false, error: (e && e.message) || '加载失败' }));
  },

  /** 下钻 / 回上级：都走同一个接口，只是 adcode 不同 */
  drill(adcode) {
    const code = String(adcode || '');
    if (!/^\d{6}$/.test(code)) return;
    if (this.data.loadingDrill) return;
    this.setData({ loadingDrill: true, notice: '' });

    return request('/api/map/geo?adcode=' + code, null, { method: 'GET' })
      .then((res) => {
        // 「东莞市」这类不设区县的地方返回 ok:false + reason:no-children，
        // 属于正常业务结果，不是错误 —— 给提示，别当失败弹红字
        if (res && res.ok === false) {
          this.setData({ loadingDrill: false, notice: res.error || '这一级没有下级行政区' });
          return;
        }
        this.apply(res, false);
        wx.pageScrollTo ? wx.pageScrollTo({ scrollTop: 0, duration: 200 }) : null;
      })
      .catch((e) =>
        this.setData({ loadingDrill: false, error: (e && e.message) || '下钻失败' })
      );
  },

  onTapCrumb(e) {
    const code = e.currentTarget.dataset.adcode;
    if (!code || String(code) === String(this._adcode)) return;
    this.drill(code);
  },

  /** 把接口返回装配成页面数据。withMissing=true 只在首屏为真（下钻接口没有 missing） */
  apply(res, withMissing) {
    const scope = (res && res.scope) || {};
    this._adcode = scope.adcode || '';

    const ancestors = Array.isArray(scope.ancestors) ? scope.ancestors : [];
    const crumbs = ancestors
      .map((a) => ({ name: a.name, adcode: a.adcode }))
      .concat([{ name: scope.name || '全国', adcode: scope.adcode || '' }]);

    const raw = (res && res.areas) || [];
    const max = raw.reduce((m, a) => Math.max(m, a.playerCount || 0), 0) || 1;

    const areas = raw
      .map((a) => {
        const n = a.playerCount || 0;
        // 有人的区最少给 4% 宽度，否则「1 个人」和「0 个人」在条上看不出区别
        const pct = n > 0 ? Math.max(4, Math.round((n / max) * 100)) : 0;
        const players = (a.players || []).map((p) => ({
          id: String(p.id),
          // 昵称可能很长，列表里只显示前 8 个字，点进名片看全名
          name: String(p.nickname || '未命名').slice(0, 8),
          initial: String(p.nickname || '?').charAt(0)
        }));
        return {
          name: a.name,
          adcode: String(a.adcode || ''),
          count: n,
          pct: pct,
          level: pct > 60 ? 3 : pct > 30 ? 2 : pct > 0 ? 1 : 0,
          canDrill: !!a.canDrill,
          isMine: !!a.isMine,
          foodCount: a.foodCount || 0,
          open: false,
          players: players
        };
      })
      .sort((a, b) => b.count - a.count || b.foodCount - a.foodCount || (a.name < b.name ? -1 : 1));

    const stats = (res && res.stats) || {};
    const missing = withMissing
      ? (res.missing || []).map((p) => ({
          id: String(p.id),
          name: String(p.nickname || '未命名').slice(0, 8),
          initial: String(p.nickname || '?').charAt(0)
        }))
      : this.data.missing;

    this.setData({
      loading: false,
      loadingDrill: false,
      error: '',
      notice: (res && res.notice) || '',
      crumbs: crumbs,
      scopeName: scope.name || '全国',
      isRoot: !!scope.isRoot,
      areas: areas,
      missing: missing,
      missingPreview: missing.slice(0, 12),
      missingTotal: withMissing ? (res.missing || []).length : this.data.missingTotal,
      stats: [
        { key: 'players', label: '群友总数', value: stats.players || 0 },
        { key: 'filled', label: '已填地区', value: stats.filled || 0 },
        { key: 'missing', label: '未填地区', value: stats.missing || 0 }
      ]
    });
  },

  /** 有下级就下钻，没有就展开本区名单 */
  onTapArea(e) {
    const i = Number(e.currentTarget.dataset.index);
    const a = this.data.areas[i];
    if (!a) return;
    if (a.canDrill) {
      this.drill(a.adcode);
      return;
    }
    this.toggleArea(i);
  },

  /** 点人数：展开/收起这个区的群友（不重新请求，数据接口已经给了） */
  onTapCount(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.toggleArea(i);
  },

  toggleArea(i) {
    const cur = this.data.areas[i];
    if (!cur || !cur.players.length) return;
    const patch = {};
    patch['areas[' + i + '].open'] = !cur.open;
    this.setData(patch);
  },

  onTapPlayer(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/member/member?id=' + String(id) });
  },

  toggleMissing() {
    this.setData({ missingOpen: !this.data.missingOpen });
  },

  onShareAppMessage() {
    return { title: 'DoDo 群友分布 · ' + this.data.scopeName, path: '/pages/dist/dist' };
  },

  onShareTimeline() {
    return { title: 'DoDo 群友分布 · ' + this.data.scopeName };
  }
});
