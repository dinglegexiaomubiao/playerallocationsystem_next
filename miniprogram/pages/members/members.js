// 群友列表：搜索 + 六维筛选（段位 / 分数区间 / 位置 / 地区 / 英雄 / 排序）。
//
// 筛选逻辑在 utils/member-filter.js（移植自 lib/member-filter.mjs，口径必须一致）。
// 这里只负责：拉一次全量 → 建一次搜索索引 → 之后每次改筛选都在本地算，
// 不发请求（168 条数据本地筛是毫秒级，每次改条件就打一次接口纯属浪费）。
const { request, getBase } = require('../../utils/api');
const { fullUrl } = require('../../utils/format');
const { loadOptions } = require('../../utils/options');
const mf = require('../../utils/member-filter');

Page({
  data: {
    loading: true,
    error: '',
    total: 0,
    shown: 0,
    list: [],
    filters: mf.emptyFilters(),
    activeCount: 0,
    open: false,
    // picker 用的纯文本数组 + 当前下标
    tierLabels: ['不限段位'],
    tierIndex: 0,
    scoreLabels: ['不限分数'],
    scoreIndex: 0,
    sortLabels: [],
    sortIndex: 0,
    regionLabels: ['全部地区'],
    regionIndex: 0,
    // 英雄与位置都是**多选**（网页端是多选下拉，单选会让「会 A 或 B」问不出来）
    heroChips: [],
    heroCount: 0,
    posChips: [],
    keyword: ''
  },

  onLoad() {
    this._filters = mf.emptyFilters();
    return Promise.all([this.load(), loadOptions().catch(() => null)]).then((res) => {
      const opts = res[1] || {};
      const positions = Array.isArray(opts.positions) ? opts.positions : [];
      this._positionsAll = positions;
      this.setData({
        sortLabels: mf.SORTS.map((x) => x.label),
        posChips: positions.map((name) => ({ name: name, on: false }))
      });
    });
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
        this._players = players;
        this._base = base;
        this._index = mf.buildSearchIndex(players);

        // 维度可选项都从真实数据生成（英雄池上百种，写死会漏）
        const facet = mf.buildRegionHeroFacets(players);
        const tiers = mf.buildTierFacets(players);
        const scores = mf.buildScoreFacets(players);

        this._tiers = [{ key: 'all', label: '不限段位', count: players.length }].concat(tiers);
        this._scores = mf.SCORE_RANGES.map((r) => ({ value: r.value, label: r.label })).map((r, i) => ({
          value: r.value,
          label: r.label,
          count: scores[i] ? scores[i].count : 0
        }));
        this._regions = [{ value: '全部', label: '全部地区', count: players.length }].concat(
          facet.region.map((x) => ({ value: x.value, label: x.value + '（' + x.count + '）', count: x.count }))
        );
        // 英雄按出现次数降序排（buildCountFacet 已排好），点开面板第一屏就是最常见的
        this._heroes = facet.hero.map((x) => ({ name: x.value, count: x.count }));

        this.setData({
          loading: false,
          total: players.length,
          tierLabels: this._tiers.map((x) => x.label + '（' + x.count + '）'),
          scoreLabels: this._scores.map((x) => x.label + '（' + x.count + '）'),
          regionLabels: this._regions.map((x) => x.label),
          heroChips: this._heroes.map((x) => ({ name: x.name, count: x.count, on: false }))
        });
        this.apply();
      })
      .catch((e) => this.setData({ loading: false, error: (e && e.message) || '加载失败' }));
  },

  /** 本地筛选 + 渲染。改任何筛选条件都走这里 */
  apply() {
    const base = this._base || '';
    const filtered = mf.filterMembers(this._players || [], this._filters, this._index);
    const list = filtered.map((p) => {
      const heroes = Array.isArray(p.heroes) ? p.heroes : [];
      const positions = Array.isArray(p.positions) ? p.positions : [];
      const name = p.nickname || p.group_nickname || '未命名';
      const meta = [mf.regionShort(p.region), p.group_nickname ? '群昵称 ' + p.group_nickname : '']
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
    this.setData({
      list: list,
      shown: filtered.length,
      activeCount: mf.countActiveFilters(this._filters),
      filters: this._filters
    });
  },

  onKeyword(e) {
    this._filters.keyword = e.detail.value;
    this.setData({ keyword: e.detail.value });
    this.apply();
  },

  onClearKeyword() {
    this._filters.keyword = '';
    this.setData({ keyword: '' });
    this.apply();
  },

  togglePanel() {
    this.setData({ open: !this.data.open });
  },

  onTier(e) {
    const i = Number(e.detail.value) || 0;
    this._filters.tier = this._tiers[i] ? this._tiers[i].key : 'all';
    this.setData({ tierIndex: i });
    this.apply();
  },

  onScore(e) {
    const i = Number(e.detail.value) || 0;
    this._filters.score = this._scores[i] ? this._scores[i].value : 'all';
    this.setData({ scoreIndex: i });
    this.apply();
  },

  onSort(e) {
    const i = Number(e.detail.value) || 0;
    this._filters.sort = (mf.SORTS[i] || mf.SORTS[0]).value;
    this.setData({ sortIndex: i });
    this.apply();
  },

  onRegion(e) {
    const i = Number(e.detail.value) || 0;
    this._filters.region = this._regions[i] ? this._regions[i].value : '全部';
    this.setData({ regionIndex: i });
    this.apply();
  },

  onHero(e) {
    const name = e.currentTarget.dataset.name;
    const cur = this._filters.hero.slice();
    const i = cur.indexOf(name);
    if (i >= 0) cur.splice(i, 1);
    else cur.push(name);
    this._filters.hero = cur;
    this.setData({
      heroCount: cur.length,
      heroChips: (this._heroes || []).map((x) => ({ name: x.name, count: x.count, on: cur.indexOf(x.name) >= 0 }))
    });
    this.apply();
  },

  onTogglePos(e) {
    const name = e.currentTarget.dataset.name;
    const cur = this._filters.position.slice();
    const i = cur.indexOf(name);
    if (i >= 0) cur.splice(i, 1);
    else cur.push(name);
    this._filters.position = cur;
    this.setData({
      posChips: (this._positionsAll || []).map((n) => ({ name: n, on: cur.indexOf(n) >= 0 }))
    });
    this.apply();
  },

  reset() {
    this._filters = mf.emptyFilters();
    this.setData({
      keyword: '',
      tierIndex: 0,
      scoreIndex: 0,
      sortIndex: 0,
      regionIndex: 0,
      heroCount: 0,
      posChips: (this._positionsAll || []).map((n) => ({ name: n, on: false })),
      heroChips: (this._heroes || []).map((x) => ({ name: x.name, count: x.count, on: false }))
    });
    this.apply();
  },

  onTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    // id 是 17 位雪花号，拼 URL 时保持字符串，别 Number()（会丢最后一位）
    wx.navigateTo({ url: '/pages/member/member?id=' + String(id) });
  },

  onShareAppMessage() {
    return { title: 'LaRoja 群友名录 · 战绩与名片', path: '/pages/members/members' };
  },

  onShareTimeline() {
    return { title: 'LaRoja 群友名录' };
  }
});
