const session = require('../../utils/session');
const { getBase } = require('../../utils/api');
const { fmtDateTime } = require('../../utils/format');

Page({
  data: {
    logged: false,
    name: '',
    initial: '',
    isAdmin: false,
    loginAtText: '',
    base: '',
    version: '0.2.0'
  },

  // 用 onShow 而不是 onLoad：从登录页返回时页面不会重建，只有 onShow 会再跑
  onShow() {
    const user = session.getUser();
    this.setData({
      base: getBase(),
      logged: !!user,
      name: (user && user.name) || '',
      initial: ((user && user.name) || '?').charAt(0).toUpperCase(),
      isAdmin: !!(user && user.isAdmin),
      loginAtText: user && user.loginAt ? fmtDateTime(user.loginAt) : ''
    });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  goGuild() {
    wx.navigateTo({ url: '/pages/guild/guild' });
  },

  goFeedback() {
    wx.navigateTo({ url: '/pages/feedback/feedback' });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后发开黑、报名活动这些操作就不能用了，看内容不受影响。',
      confirmText: '退出',
      confirmColor: '#b02b25',
      success: (r) => {
        if (!r.confirm) return;
        session.clearLogin();
        this.onShow();
        wx.showToast({ title: '已退出', icon: 'success' });
      }
    });
  },

  onBase(e) {
    this.setData({ base: e.detail.value });
  },

  save() {
    const app = getApp();
    const base = String(this.data.base || '').trim();
    if (base && !/^https?:\/\//.test(base)) {
      wx.showToast({ title: '地址要以 http(s):// 开头', icon: 'none' });
      return;
    }
    if (base) wx.setStorageSync('apiBase', base);
    else wx.removeStorageSync('apiBase');
    if (app && app.globalData) app.globalData.apiBase = base || 'https://dota.playerallocationsystem.online';
    this.setData({ base: getBase() });
    wx.showToast({ title: '已保存', icon: 'success' });
  }
});
