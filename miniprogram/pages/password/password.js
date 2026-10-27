// 改密码。POST /api/account/change-password { oldPassword, newPassword }
//
// 两件事容易踩：
// ① 旧密码也要验 —— 服务端把这接口当「免限流的密码爆破器」防，所以旧密码错会 401
//    并且计入限流；错太多次会 429，别以为是网络问题。
// ② 改完 token 仍然有效（token 只签账号名，不含密码），所以不用重新登录。
const { request } = require('../../utils/api');

const toast = (t) => wx.showToast({ title: t, icon: 'none' });

Page({
  data: {
    oldPassword: '',
    newPassword: '',
    confirm: '',
    error: '',
    busy: false
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const patch = {};
    patch[key] = e.detail.value;
    this.setData(patch);
  },

  onSubmit() {
    if (this.data.busy) return;
    const oldP = String(this.data.oldPassword || '');
    const newP = String(this.data.newPassword || '');
    const cf = String(this.data.confirm || '');

    // 前端先挡一遍明显的错，省一个来回；规则与服务端 checkPasswordStrength 一致
    if (!oldP) return this.setData({ error: '请填原密码' });
    if (newP.length < 6) return this.setData({ error: '新密码至少 6 位' });
    if (newP.length > 64) return this.setData({ error: '新密码不能超过 64 个字符' });
    if (newP === oldP) return this.setData({ error: '新密码不能和原密码相同' });
    if (newP !== cf) return this.setData({ error: '两次输入的新密码不一致' });

    this.setData({ error: '', busy: true });
    request(
      '/api/account/change-password',
      { oldPassword: oldP, newPassword: newP },
      { method: 'POST' }
    )
      .then(() => {
        this.setData({ busy: false, oldPassword: '', newPassword: '', confirm: '' });
        wx.showModal({
          title: '密码已更新',
          content: '下次登录用新密码。当前登录状态不受影响。',
          showCancel: false,
          success: () => wx.navigateBack()
        });
      })
      .catch((e) => {
        const msg = (e && e.message) || '修改失败';
        this.setData({ busy: false, error: msg });
        toast(msg);
      });
  }
});
