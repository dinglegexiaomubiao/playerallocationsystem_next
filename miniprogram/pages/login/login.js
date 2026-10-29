const { request } = require('../../utils/api');
const session = require('../../utils/session');

Page({
  data: {
    username: '',
    password: '',
    submitting: false,
    error: '',
    hint: '',
    // USER_NOT_FOUND 时给「去网页注册」的说明，别的错误不给
    showRegisterHint: false
  },

  onLoad() {
    const pages = getCurrentPages();
    const u = session.getUser();

    if (u && u.token) {
      // 已经登录了，直接走。别让用户看着一个还能再登一次的表格。
      // 注意栈深：小程序热启动会恢复上次的页面栈，上次停在登录页时栈里只有 1 层，
      // navigateBack 没有上一页可回、会静默失败 —— 所以补 reLaunch 兜底。
      if (pages.length > 1) {
        wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
      } else {
        wx.reLaunch({ url: '/pages/index/index' });
      }
      return;
    }

    // 未登录 + 栈底就是登录页 = 热启动恢复到上次的登录页（登录页不是入口页）。
    // 直接回首页，别让用户一打开小程序就面对账号密码 —— 首页不登录也能看。
    if (pages.length <= 1) {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  /** 登录成功后的跳转：有上一页就回，没有（热启动恢复到本页）就回首页 */
  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
    } else {
      wx.reLaunch({ url: '/pages/index/index' });
    }
  },

  onUsername(e) {
    this.setData({ username: e.detail.value, error: '' });
  },
  onPassword(e) {
    this.setData({ password: e.detail.value, error: '' });
  },

  submit() {
    if (this.data.submitting) return;

    const username = String(this.data.username || '').trim();
    const password = String(this.data.password || '').trim();
    if (!username) return this.setData({ error: '请填用户名' });
    if (!password) return this.setData({ error: '请填密码' });

    this.setData({ submitting: true, error: '', hint: '', showRegisterHint: false });

    request('/api/login', { username: username, password: password }, { method: 'POST' })
      .then((res) => {
        session.setLogin({
          token: res.token,
          name: res.name || username,
          isAdmin: !!res.isAdmin
        });

        // 管理员重置出来的临时密码：网页端会强制改密，小程序没有改密页，先把话说明白
        if (res.mustChangePassword) {
          wx.showModal({
            title: '密码需要修改',
            content: '当前是临时密码，请先到「我的 → 修改密码」设置自己的密码。',
            showCancel: false
          });
        }

        this.setData({ submitting: false });
        wx.showToast({ title: '登录成功', icon: 'success' });
        // toast 是全局层，跳页后依然显示，不用等它走完
        this.goBack();
      })
      .catch((e) => {
        const code = (e && e.code) || '';
        let hint = '';
        if (code === 'USER_NOT_FOUND') {
          hint = '账号不存在，请确认用户名或联系开发者开通。';
        } else if (code === 'PASSWORD_NOT_SET') {
          hint = '这个账号还没有密码，请联系开发者重置。';
        } else if (e && e.statusCode === 429) {
          hint = '连续输错太多次会被锁一段时间，等一会儿再试。';
        } else if (e && e.code === 'NETWORK') {
          hint = '连不上服务器，请检查网络后重试。';
        }
        this.setData({
          submitting: false,
          error: (e && e.message) || '登录失败',
          hint: hint,
          showRegisterHint: code === 'USER_NOT_FOUND'
        });
      });
  }
});
