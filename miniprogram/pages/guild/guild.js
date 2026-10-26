// 我的帮派：创建 / 改名换色 / 邀请 / 踢人 / 转让 / 退出 / 解散，外加收到的邀请。
//
// 一个页面塞这么多动作，是因为它们共享同一份 GET /api/guild 数据（我的角色、
// 成员、发出去的邀请、配色占用）。拆成多页就要各自再拉一遍，而且踢完人回列表
// 还得刷新 —— 网页端也是把管理动作都放在帮派卡上。
//
// 权限一律服务端说了算（lib/guild.mjs 里 GuildError），这里只做「按钮该不该出现」
// 的展示层判断；别把 isLeader 当成安全边界。
const { request, getBase, getToken } = require('../../utils/api');
const { loadOptions } = require('../../utils/options');
const { fullUrl, regionShort } = require('../../utils/format');

const FALLBACK_COLOR = '#8a8f96';

const toast = (t) => wx.showToast({ title: t, icon: 'none' });

function confirmBox(title, content, okText) {
  return new Promise((resolve) => {
    wx.showModal({
      title: title,
      content: content,
      confirmText: okText || '确定',
      confirmColor: '#b02b25',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false)
    });
  });
}

const emptyForm = () => ({
  open: false,
  mode: 'create',
  name: '',
  slogan: '',
  colorKey: '',
  error: '',
  busy: false
});

Page({
  data: {
    loading: true,
    needLogin: false,
    // bound=false：账号没绑选手资料。帮派是挂在选手身上的，先补资料才能建/加
    unbound: false,
    error: '',
    guild: null,
    myInvites: [],
    sentInvites: [],
    colors: [],
    form: emptyForm(),
    limits: { name: 12, slogan: 40 }
  },

  onLoad() {
    this._palette = [];
    // 先记住当前 token：onShow 紧接着就会跑，靠它区分「首次进入」和「登录完回来」
    this._lastToken = getToken();
    this.loadColors();
    this.load();
  },

  onShow() {
    // 从「邀请群友」页回来要重拉：发出去的邀请列表变了。
    // 首次进入 onLoad 已经拉过一次，靠 token 比较避免重复请求。
    const app = getApp();
    const dirty = !!(app && app.globalData && app.globalData.guildDirty);
    if (dirty || getToken() !== this._lastToken) {
      if (app && app.globalData) app.globalData.guildDirty = false;
      this.load();
    }
  },

  onPullDownRefresh() {
    this.load().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  /** 配色表来自 /api/options（唯一来源是 lib/guild-colors.mjs） */
  loadColors() {
    loadOptions()
      .then((opt) => {
        const list = (opt && opt.guildColors) || [];
        this._palette = list.map((c) => ({ key: c.key, label: c.label, solid: c.solid }));
        const lim = (opt && opt.limits) || {};
        this.setData({
          limits: {
            name: lim.guildName || 12,
            slogan: lim.guildSlogan || 40
          }
        });
        this._renderColors(this.data.guild, this._used);
      })
      .catch(() => {
        // 配色表取不到就让选择器空着，页面其余部分照常可用
        this._palette = [];
        this.setData({ colors: [] });
      });
  },

  /**
   * 配色置灰规则和网页一致：被别的帮派占了就不能选，自己帮派那个仍然可点。
   * used 是 { key: 帮派名 } —— 服务端 colorUsage() 的结果。
   */
  _renderColors(guild, used) {
    const map = used || {};
    const myName = guild ? guild.name : '';
    const colors = (this._palette || []).map((c) => {
      const owner = map[c.key] || '';
      const taken = !!owner && owner !== myName;
      return {
        key: c.key,
        label: c.label,
        solid: c.solid,
        taken: taken,
        takenText: taken ? '已被「' + owner + '」占用' : ''
      };
    });
    this.setData({ colors: colors });
  },

  load() {
    const token = getToken();
    this._lastToken = token;
    if (!token) {
      this.setData({
        loading: false,
        needLogin: true,
        unbound: false,
        error: '',
        guild: null,
        myInvites: [],
        sentInvites: []
      });
      return Promise.resolve();
    }
    this.setData({ loading: true, error: '' });
    return request('/api/guild', null, { method: 'GET' })
      .then((res) => {
        this._apply(res || {});
      })
      .catch((e) => {
        const expired = e && (e.statusCode === 401 || e.code === 'SESSION_EXPIRED');
        if (expired) {
          this.setData({ loading: false, needLogin: true, guild: null });
          return;
        }
        this.setData({ loading: false, error: (e && e.message) || '加载失败' });
      });
  },

  _apply(res) {
    const base = getBase();
    const g = res.guild || null;
    const meId = res.playerId ? String(res.playerId) : '';

    let guild = null;
    if (g) {
      const members = Array.isArray(g.members) ? g.members : [];
      guild = {
        id: String(g.id),
        name: g.name || '未命名帮派',
        slogan: g.slogan || '',
        colorKey: g.colorKey || '',
        // color 可能是 null（色板改过、旧 key 已不在表里）→ 退回中性灰
        color: (g.color && g.color.solid) || FALLBACK_COLOR,
        memberText: (g.memberCount || members.length) + '/' + (g.maxMembers || 0) + ' 人',
        isLeader: !!g.isLeader,
        roleText: g.isLeader ? '帮主' : '成员',
        members: members.map((m) => {
          const pid = String(m.playerId || '');
          return {
            playerId: pid,
            nickname: m.nickname || '未命名',
            initial: (m.nickname || '群').charAt(0),
            avatar: fullUrl(base, m.avatar || ''),
            isLeader: m.role === 'leader',
            isMe: !!meId && pid === meId,
            metaText: [m.region ? regionShort(m.region) : '', m.score ? m.score + ' 分' : '']
              .filter(Boolean)
              .join(' · ')
          };
        })
      };
    }

    const myInvites = (res.myInvites || []).map((i) => {
      const gg = i.guild || {};
      return {
        id: String(i.id),
        guildName: gg.name || '未命名帮派',
        color: (gg.color && gg.color.solid) || FALLBACK_COLOR,
        inviterName: i.inviterName || '',
        memberText: (gg.memberCount || 0) + '/' + (gg.maxMembers || 0) + ' 人',
        slogan: gg.slogan || '',
        message: i.message || ''
      };
    });

    const sentInvites = (res.sentInvites || []).map((x) => ({
      id: String(x.id),
      playerId: String(x.playerId || ''),
      nickname: x.nickname || '未命名',
      initial: (x.nickname || '群').charAt(0),
      avatar: fullUrl(base, x.avatar || ''),
      message: x.message || ''
    }));

    // ⚠ 接口里 colors 是 { used: { 配色key: 帮派名 }, free: [key] } 两层结构，
    // 不是「key → 帮派名」的扁平 map。当扁平 map 用会让 taken 永远 false，
    // 于是把已被占用的配色当成可选，提交时才被服务端打回来。
    const usage = res.colors || {};
    this._used = usage.used || {};
    this.setData({
      loading: false,
      needLogin: false,
      unbound: !res.bound,
      error: '',
      guild: guild,
      myInvites: myInvites,
      sentInvites: sentInvites
    });
    this._renderColors(guild, this._used);
  },

  /** 写操作统一在这里收口：成功 → 提示 → 重拉 → 通知列表页 */
  _act(path, body, method, okText) {
    return request(path, body, { method: method })
      .then((res) => {
        this._markListDirty();
        if (okText) wx.showToast({ title: okText, icon: 'success' });
        return this.load().then(() => res);
      })
      .catch((e) => {
        toast((e && e.message) || '操作失败');
        throw e;
      });
  },

  _markListDirty() {
    const app = getApp();
    if (app && app.globalData) app.globalData.guildListDirty = true;
  },

  // ---------- 表单 ----------
  openCreate() {
    this.setData({
      form: Object.assign(emptyForm(), {
        open: true,
        mode: 'create',
        colorKey: ''
      })
    });
  },

  openEdit() {
    const g = this.data.guild;
    if (!g) return;
    this.setData({
      form: {
        open: true,
        mode: 'edit',
        name: g.name,
        slogan: g.slogan,
        colorKey: g.colorKey,
        error: '',
        busy: false
      }
    });
  },

  closeForm() {
    this.setData({ form: emptyForm() });
  },

  onName(e) {
    this.setData({ 'form.name': e.detail.value, 'form.error': '' });
  },

  onSlogan(e) {
    this.setData({ 'form.slogan': e.detail.value, 'form.error': '' });
  },

  pickColor(e) {
    const key = e.currentTarget.dataset.key;
    // dataset 里的布尔值在个别基础库上会退化成字符串，'false' 是 truthy —— 显式比
    const taken = e.currentTarget.dataset.taken;
    if (taken === true || taken === 'true') return toast('这支配色已经被别的帮派用了');
    this.setData({ 'form.colorKey': key, 'form.error': '' });
  },

  submitForm() {
    const f = this.data.form;
    if (f.busy) return;
    const name = String(f.name || '').trim();
    if (name.length < 2) return this.setData({ 'form.error': '帮派名至少 2 个字' });
    if (!f.colorKey) return this.setData({ 'form.error': '选一支配色' });

    // slogan 一律带上：编辑时清空口号也要能清掉（服务端靠 undefined 区分「不改」）
    const body = { name: name, slogan: String(f.slogan || '').trim(), colorKey: f.colorKey };
    const isEdit = f.mode === 'edit';

    this.setData({ 'form.busy': true, 'form.error': '' });
    request('/api/guild', body, { method: isEdit ? 'PATCH' : 'POST' })
      .then(() => {
        this._markListDirty();
        this.setData({ form: emptyForm() });
        wx.showToast({ title: isEdit ? '已保存' : '帮派建好了', icon: 'success' });
        return this.load();
      })
      .catch((e) => {
        this.setData({ 'form.busy': false, 'form.error': (e && e.message) || '提交失败' });
      });
  },

  // ---------- 帮主动作 ----------
  goInvite() {
    wx.navigateTo({ url: '/pages/guild-invite/guild-invite' });
  },

  dissolve() {
    const g = this.data.guild;
    if (!g) return;
    confirmBox('解散帮派', '解散后「' + g.name + '」的成员和发出的邀请都会清掉，不可恢复。', '解散').then(
      (ok) => {
        if (!ok) return;
        this._act('/api/guild', {}, 'DELETE', '已解散')
          .catch(() => {});
      }
    );
  },

  removeMember(e) {
    const ds = e.currentTarget.dataset;
    const pid = String(ds.id || '');
    const nick = ds.nick || '这位群友';
    if (!pid) return;
    confirmBox('移出帮派', '确定把「' + nick + '」移出帮派？他可以再被邀请回来。', '移出').then((ok) => {
      if (!ok) return;
      this._act('/api/guild/members/' + pid, {}, 'DELETE', '已移出')
        .catch(() => {});
    });
  },

  transferTo(e) {
    const ds = e.currentTarget.dataset;
    const pid = String(ds.id || '');
    const nick = ds.nick || '这位群友';
    if (!pid) return;
    confirmBox(
      '转让帮主',
      '把帮主位子交给「' + nick + '」？转让后你自己变成普通成员，不能再管理帮派。',
      '转让'
    ).then((ok) => {
      if (!ok) return;
      this._act('/api/guild/transfer', { playerId: pid }, 'POST', '已转让')
        .catch(() => {});
    });
  },

  cancelInvite(e) {
    const id = String(e.currentTarget.dataset.id || '');
    if (!id) return;
    this._act('/api/guild/invites/' + id, {}, 'DELETE', '已撤回').catch(() => {});
  },

  // ---------- 成员动作 ----------
  leave() {
    const g = this.data.guild;
    if (!g) return;
    confirmBox('退出帮派', '确定退出「' + g.name + '」？', '退出').then((ok) => {
      if (!ok) return;
      this._act('/api/guild/leave', {}, 'POST', '已退出')
        .catch(() => {});
    });
  },

  // ---------- 收到的邀请 ----------
  respondInvite(e) {
    const ds = e.currentTarget.dataset;
    const id = String(ds.id || '');
    const action = ds.action;
    const gname = ds.name || '这个帮派';
    if (!id || (action !== 'accept' && action !== 'reject')) return;
    const accept = action === 'accept';
    const run = () =>
      this._act('/api/guild/invites/' + id, { action: action }, 'POST', accept ? '已加入' : '已拒绝');
    if (accept) {
      confirmBox(
        '加入帮派',
        '接受邀请后你就是「' + gname + '」的成员了。想退出随时可以在帮派页退出。',
        '加入'
      ).then((ok) => {
        if (ok) run().catch(() => {});
      });
    } else {
      run().catch(() => {});
    }
  },

  // ---------- 跳转 ----------
  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goProfile() {
    wx.showToast({ title: '请在网页版「个人信息」补填选手资料', icon: 'none' });
  }
});
