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
    const u = session.getUser();
    if (u && u.token) {
      // 已经登录了，直接回去，别让用户看着一个还能再登一次的表格
      wx.navigateBack();
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
            content: '当前是管理员重置的临时密码，请先到网页端「个人信息」里改成自己的密码。',
            showCancel: false
          });
        }

        this.setData({ submitting: false });
        wx.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch((e) => {
        const code = (e && e.code) || '';
        let hint = '';
        if (code === 'USER_NOT_FOUND') {
          hint = '账号由网页端注册，小程序暂不支持注册。';
        } else if (code === 'PASSWORD_NOT_SET') {
          hint = '这个账号还没有密码，请联系管理员在后台重置。';
        } else if (e && e.statusCode === 429) {
          hint = '连续输错太多次会被锁一段时间，等一会儿再试。';
        } else if (e && e.code === 'NETWORK') {
          hint = '连不上服务器，检查网络或「我的 → 开发者设置」里的后端地址。';
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
