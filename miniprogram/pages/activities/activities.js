const { request, getToken } = require('../../utils/api');
const { fmtDateTime, fmtRange, dateKeyOf, regionShort } = require('../../utils/format');
const session = require('../../utils/session');

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '招募中' },
  { key: 'joined', label: '我参与' }
];

// 活动类型（对齐网页端 lib/options.mjs 的 ACTIVITY_TYPES）。小程序 require 不了 .mjs，
// 这里手抄一份；改了网页端的类型就要同步改这里（scripts/check-miniprogram-*.cjs 不查这条，手动对齐）。
const TYPES = [
  { key: 'all', label: '全部类型' },
  { key: 'meal', label: '约饭' },
  { key: 'hike', label: '爬山' },
  { key: 'sport', label: '打球' },
  { key: 'fishing', label: '钓鱼' },
  { key: 'other', label: '其他' }
];

Page({
  data: {
    tabs: TABS,
    tab: 'all',
    // list 是「最终渲染行」：未过期的活动 + 一条合成折叠条（__fold）+ 展开后的过期活动。
    // 同 party.js 的设计：卡片模板只写一遍，靠 __fold 分支区分折叠条。
    list: [],
    showExpired: false,
    expiredCount: 0,
    emptyText: '',
    total: 0,
    loading: true,
    error: '',
    busyId: '',
    busyAct: '',
    // 筛选（对齐网页端 pages/activities/index.js）
    typeOptions: TYPES,
    typeFilter: 'all',
    regionOptions: [{ value: 'all', label: '全部地区' }],
    regionFilter: 'all',
    q: '',
    dateFilter: '',
    openOnly: false
  },

  onLoad() {
    this.all = [];
    // 展开状态按活动 id 记，不按列表下标 —— 下标会随 tab 切换 / 重新加载 / 折叠区而错位。
    this.expandedIds = {};
    this.load();
  },

  // 登录态变了就重拉：iJoined / isMine 由服务端按会话算
  onShow() {
    if (this.tokenSeen !== undefined && this.tokenSeen !== getToken()) this.load();
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  // quiet=true 时不切「加载中」骨架：发布完返回、删除完刷新都走这条。
  load(quiet) {
    this.tokenSeen = getToken();
    this.setData(quiet ? { error: '' } : { loading: true, error: '' });
    return request('/api/activities', null, { method: 'GET' })
      .then((res) => {
        const posts = (res && res.posts) || [];
        const rows = posts.map((p) => {
          const need = p.need_people;
          const peopleText =
            need !== null && need !== undefined
              ? (p.joinedPeople || 0) + '/' + need + ' 人'
              : (p.joinedPeople || 0) + ' 人已报名';

          const isExpired = !!p.expired;
          const isOpen = p.status === 'open' && !isExpired;
          const isMine = !!p.isMine;
          const iJoined = !!p.iJoined;

          const statusLabel = isExpired ? '已过期' : p.status === 'open' ? '招募中' : '已关闭';

          // 按钮语义只在这里算一次，WXML 里不再写条件表达式。对齐网页端 ActivityCard：
          // 发起人 → 关闭招募 / 重新招募 + 删除；已报名 → 取消报名；开放中 → 报名；其余 → 已停止招募。
          const actions = [];
          if (isMine) {
            if (isOpen) actions.push({ key: 'close', text: '关闭招募', ghost: true });
            else if (!isExpired) actions.push({ key: 'reopen', text: '重新招募', ghost: true });
            actions.push({ key: 'delete', text: '删除', danger: true });
          } else if (iJoined) {
            actions.push({ key: 'cancel', text: '取消报名', ghost: true });
          } else if (isOpen) {
            actions.push({ key: 'join', text: '报名', primary: true });
          }

          const signups = (p.signups || []).map((s, i) => ({
            idx: i,
            initial: (s.nickname || '?').slice(0, 1),
            nickname: s.nickname || '群友',
            guestsText: s.guests > 0 ? '携 ' + s.guests + ' 人同行' : '本人参加',
            note: s.note || '',
            dayText: s.created_at ? fmtDateTime(s.created_at).slice(0, 10) : ''
          }));

          // 搜索 haystack（对齐网页端：名称 / 昵称 / 类型 / 地区 / 地点 / 备注）
          const hay = [
            p.title,
            p.creator && p.creator.nickname,
            p.typeLabel,
            p.region,
            p.location,
            p.note
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return {
            id: String(p.id),
            title: p.title || '未命名活动',
            type: p.type || '',
            typeLabel: p.typeLabel || '',
            statusLabel: statusLabel,
            isOpen: isOpen,
            isExpired: isExpired,
            isMine: isMine,
            iJoined: iJoined,
            stoppedText: isExpired ? '已过期' : '已停止招募',
            actions: actions,
            meetText: p.meet_at ? fmtRange(p.meet_at, p.duration_min) : '时间待定',
            dateKey: dateKeyOf(p.meet_at),
            region: p.region || '',
            regionText: regionShort(p.region),
            locationText: p.location || '',
            costText: p.cost || '',
            peopleText: peopleText,
            note: p.note || '',
            creatorText: (p.creator && p.creator.nickname) || '群友',
            signupCount: p.signupCount || 0,
            needText: p.need_people ? ' / 需要 ' + p.need_people + ' 人' : '',
            signups: signups,
            hay: hay,
            expanded: !!this.expandedIds[String(p.id)]
          };
        });

        // 地区下拉选项：从现有活动的 region 聚合（对齐网页端 regionOptions）
        const seen = {};
        const regions = [];
        for (const p of posts) {
          if (p.region && !seen[p.region]) {
            seen[p.region] = true;
            regions.push(p.region);
          }
        }
        regions.sort((a, b) => a.localeCompare(b, 'zh'));
        const regionOptions = [{ value: 'all', label: '全部地区' }].concat(
          regions.map((r) => ({ value: r, label: regionShort(r) }))
        );

        this.all = rows;
        this.setData(
          { loading: false, total: rows.length, regionOptions: regionOptions },
          () => this.apply()
        );
      })
      .catch((e) =>
        this.setData({ loading: false, error: (e && e.message) || '加载失败' })
      );
  },

  // 把 tab + 筛选条件算完，再按「未过期 / 已过期」分成两拨：未过期正常铺开，
  // 过期的一律折到底部折叠区（网页端 activePosts / expiredPosts 就是这个口径）。
  apply() {
    const tab = this.data.tab;
    const typeFilter = this.data.typeFilter;
    const regionFilter = this.data.regionFilter;
    const q = (this.data.q || '').trim().toLowerCase();
    const dateFilter = this.data.dateFilter;
    const openOnly = this.data.openOnly;

    let src = this.all;
    if (tab === 'open') src = src.filter((p) => p.isOpen);
    else if (tab === 'joined') src = src.filter((p) => p.iJoined);

    const filtered = src.filter((p) => {
      if (typeFilter !== 'all' && p.type !== typeFilter) return false;
      if (regionFilter !== 'all' && p.region !== regionFilter) return false;
      if (dateFilter && p.dateKey !== dateFilter) return false;
      // 不看日期时，「只看招募中」= 状态 open 且没过期
      if (!dateFilter && openOnly && !p.isOpen) return false;
      if (!q) return true;
      return p.hay.indexOf(q) >= 0;
    });

    // 展开态以 expandedIds 为准，每次重算都刷一遍（切 tab 回来不会退回旧值）
    for (const p of this.all) p.expanded = !!this.expandedIds[p.id];

    const active = [];
    const expired = [];
    for (const p of filtered) {
      if (p.isExpired) expired.push(p);
      else active.push(p);
    }

    const rows = active.slice();
    if (expired.length) {
      if (dateFilter) {
        // 按日期查记录：平铺当天全部活动（含已过期 / 已关闭），不做折叠
        rows.push.apply(rows, expired);
      } else {
        rows.push({ __fold: true, id: '__fold', foldText: '已过期活动（' + expired.length + '）' });
        if (this.data.showExpired) rows.push.apply(rows, expired);
      }
    }

    let emptyText = '';
    if (!active.length && !expired.length) {
      emptyText = '没有符合条件的活动，换个筛选条件试试';
    }

    this.setData({ list: rows, expiredCount: expired.length, emptyText: emptyText });
  },

  toggleExpired() {
    this.setData({ showExpired: !this.data.showExpired }, () => this.apply());
  },

  onTab(e) {
    const v = e.currentTarget.dataset.v || 'all';
    this.setData({ tab: v }, () => this.apply());
  },

  onType(e) {
    this.setData({ typeFilter: e.currentTarget.dataset.v || 'all' }, () => this.apply());
  },

  onRegion(e) {
    this.setData({ regionFilter: e.currentTarget.dataset.v || 'all' }, () => this.apply());
  },

  onKeyword(e) {
    this.setData({ q: e.detail.value }, () => this.apply());
  },

  onDate(e) {
    this.setData({ dateFilter: e.detail.value || '' }, () => this.apply());
  },

  onToggleOpenOnly() {
    this.setData({ openOnly: !this.data.openOnly }, () => this.apply());
  },

  onClearFilters() {
    this.setData(
      {
        typeFilter: 'all',
        regionFilter: 'all',
        q: '',
        dateFilter: '',
        openOnly: false
      },
      () => this.apply()
    );
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goNew() {
    if (!session.isLoggedIn()) {
      this.goLogin();
      return;
    }
    wx.navigateTo({ url: '/pages/activity-new/activity-new' });
  },

  onTap(e) {
    // 点卡片 = 展开 / 收起报名者名单（对齐网页端 ActivityCard 平铺）。按 id 找，不用下标。
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.id) || '');
    if (!id || id === '__fold') return;
    const cur = this.all.filter((p) => p.id === id)[0];
    if (!cur) return;
    if (!cur.signups.length) {
      wx.showToast({ title: '还没有人报名', icon: 'none' });
      return;
    }

    const on = !this.expandedIds[id];
    if (on) this.expandedIds[id] = true;
    else delete this.expandedIds[id];

    const idx = this.data.list.map((p) => p.id).indexOf(id);
    if (idx < 0) return;
    const patch = {};
    patch['list[' + idx + '].expanded'] = on;
    this.setData(patch);
  },

  // 关闭 / 重新招募 / 删除 / 报名 / 取消报名
  onAction(e) {
    const ds = e.currentTarget.dataset;
    const id = String(ds.id || '');
    const act = ds.act || '';
    if (!id || !act) return;

    if (!session.isLoggedIn()) {
      this.goLogin();
      return;
    }
    if (this.data.busyId) return;

    if (act === 'delete') {
      wx.showModal({
        title: '删除这个活动',
        content: '删除后活动和下方的报名记录都会消失，不能恢复。',
        confirmText: '删除',
        confirmColor: '#b02b25',
        success: (r) => {
          if (r.confirm) this.doDelete(id);
        }
      });
      return;
    }

    if (act === 'close') {
      wx.showModal({
        title: '关闭招募',
        content: '关闭后这个活动不再接受报名，已报名的人不受影响。',
        confirmText: '关闭',
        confirmColor: '#b02b25',
        success: (r) => {
          if (r.confirm) this.doPatch(id, 'closed');
        }
      });
      return;
    }

    if (act === 'reopen') {
      this.doPatch(id, 'open');
      return;
    }

    if (act === 'cancel') {
      wx.showModal({
        title: '取消报名',
        content: '取消后要把名额让出来，确定吗？',
        confirmText: '取消报名',
        confirmColor: '#b02b25',
        success: (r) => {
          if (r.confirm) this.doJoin(id, 'DELETE');
        }
      });
      return;
    }
    this.doJoin(id, 'POST');
  },

  // 关闭 / 重新招募（PATCH status）
  doPatch(id, status) {
    this.setData({ busyId: id, busyAct: status === 'closed' ? 'close' : 'reopen' });
    request('/api/activities/' + id, { status: status }, { method: 'PATCH' })
      .then(() => {
        this.setData({ busyId: '', busyAct: '' });
        wx.showToast({ title: status === 'closed' ? '已关闭' : '已重新招募', icon: 'success' });
        this.load(true);
      })
      .catch((err) => this.fail('没能完成', err));
  },

  // 删除活动（DELETE /api/activities/{id}）。只有发起人能删。
  doDelete(id) {
    this.setData({ busyId: id, busyAct: 'delete' });
    request('/api/activities/' + id, null, { method: 'DELETE' })
      .then(() => {
        this.setData({ busyId: '', busyAct: '' });
        delete this.expandedIds[id];
        wx.showToast({ title: '已删除', icon: 'success' });
        this.load(true);
      })
      .catch((err) => this.fail('没能删除', err));
  },

  doJoin(id, method) {
    this.setData({ busyId: id, busyAct: method === 'DELETE' ? 'cancel' : 'join' });
    request('/api/activities/' + id + '/join', {}, { method: method })
      .then(() => {
        this.setData({ busyId: '', busyAct: '' });
        wx.showToast({ title: method === 'DELETE' ? '已取消报名' : '报名成功', icon: 'success' });
        this.load(true);
      })
      .catch((err) => this.fail('没能完成', err));
  },

  fail(title, err) {
    this.setData({ busyId: '', busyAct: '' });
    wx.showModal({
      title: title,
      content: (err && err.message) || '稍后再试',
      showCancel: false
    });
  },

  onShareAppMessage() {
    return { title: 'DoDo 活动招募 · 约饭爬山', path: '/pages/activities/activities' };
  },

  onShareTimeline() {
    return { title: 'DoDo 活动招募' };
  }
});
