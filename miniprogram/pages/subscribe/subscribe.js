// 「消息提醒」设置页。
//
// 这一页要解决一个很容易让人误解的事：小程序的订阅消息**不是开关**。
// 用户每点一次授权，我们只拿到 1 次推送机会（一次性订阅），推一条扣一条。
// 所以页面上必须老实写清楚「还剩几次」，否则用户会觉得「我明明开了，怎么还收不到」。
//
// 三板斧：绑微信（换 openid）→ 选关心的类别 → 领额度（requestSubscribeMessage）。
const api = require('../../utils/api');
const session = require('../../utils/session');

Page({
  data: {
    logged: false,
    loading: true,
    error: '',
    busy: '',

    linked: false,
    openidCount: 0,
    canLogin: false,
    canPush: false,
    missingTemplates: [],
    missingText: '',
    categories: [],
    templates: []
  },

  onShow() {
    const user = session.getUser();
    this.setData({ logged: !!user });
    if (!user) {
      this.setData({ loading: false });
      return;
    }
    this.load();
  },

  load() {
    this.setData({ loading: true, error: '' });
    return api
      .request('/api/mp/status', null, { method: 'GET' })
      .then((d) => {
        const interests = (d && d.interests) || [];
        const cats = ((d && d.categories) || []).map((c) => ({
          key: c.key,
          label: c.label,
          desc: c.desc || '',
          on: interests.indexOf(c.key) >= 0
        }));
        const conf = (d && d.configured) || {};
        const missing = conf.missingTemplates || [];
        this.setData({
          loading: false,
          linked: !!(d && d.linked),
          openidCount: (d && d.openidCount) || 0,
          canLogin: !!conf.canLogin,
          canPush: !!conf.canPush,
          missingTemplates: missing,
          // 数组直接插进 WXML 会渲染成 a,b（没有空格），拼成一句话更好读
          missingText: missing.join('、'),
          categories: cats,
          templates: ((d && d.templates) || []).map((t) => ({
            key: t.key,
            label: t.label,
            desc: t.desc || '',
            ready: !!t.ready,
            tmplId: t.tmplId || '',
            remaining: t.remaining || 0,
            rejected: !!t.rejected
          }))
        });
        return d;
      })
      .catch((e) => {
        if (e && e.code === 'SESSION_EXPIRED') {
          this.setData({ logged: false, loading: false });
          return null;
        }
        this.setData({ loading: false, error: (e && e.message) || '加载失败' });
        return null;
      });
  },

  /* ---------------- 绑定微信 ---------------- */
  bindWechat() {
    if (this.data.busy) return;
    if (!this.data.canLogin) {
      wx.showModal({
        title: '暂时绑不了',
        content: '服务端还没配置小程序密钥（AppSecret）。配好后重进这一页就能绑。',
        showCancel: false
      });
      return;
    }
    this.setData({ busy: 'bind' });
    wx.login({
      success: (r) => {
        if (!r.code) {
          this.setData({ busy: '' });
          wx.showToast({ title: '没拿到微信登录凭证', icon: 'none' });
          return;
        }
        api
          .request('/api/mp/link', { code: r.code })
          .then((d) => {
            this.setData({ busy: '' });
            if (d && d.linked) {
              wx.showToast({ title: '已绑定', icon: 'success' });
            } else {
              wx.showModal({ title: '没绑上', content: (d && d.message) || '请稍后重试', showCancel: false });
            }
            this.load();
          })
          .catch((e) => {
            this.setData({ busy: '' });
            wx.showModal({ title: '绑定失败', content: (e && e.message) || '请稍后重试', showCancel: false });
          });
      },
      fail: () => {
        this.setData({ busy: '' });
        wx.showToast({ title: '微信登录失败，请重试', icon: 'none' });
      }
    });
  },

  /* ---------------- 关注类别 ---------------- */
  toggleCategory(e) {
    const key = e.currentTarget.dataset.key;
    const cats = this.data.categories.map((c) => (c.key === key ? Object.assign({}, c, { on: !c.on }) : c));
    this.setData({ categories: cats });
    const keys = cats.filter((c) => c.on).map((c) => c.key);
    api
      .request('/api/mp/interests', { interests: keys })
      .then((d) => {
        const saved = (d && d.interests) || [];
        this.setData({
          categories: cats.map((c) => Object.assign({}, c, { on: saved.indexOf(c.key) >= 0 }))
        });
      })
      .catch((err) => {
        // 保存失败要把开关回滚，否则界面显示的和他真实订阅的不一致
        this.setData({ categories: this.data.categories.map((c) => (c.key === key ? Object.assign({}, c, { on: !c.on }) : c)) });
        wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
      });
  },

  /* ---------------- 领订阅额度 ---------------- */
  requestSubscribe() {
    if (this.data.busy) return;
    if (!this.data.linked) {
      wx.showModal({
        title: '先绑定微信',
        content: '微信要先知道「这条消息发给哪个微信号」才能授权。点「绑定微信」一步就好。',
        confirmText: '去绑定',
        success: (r) => {
          if (r.confirm) this.bindWechat();
        }
      });
      return;
    }
    // 只有「有效」的模板才能进 tmplIds。
    // valid === false 是后台自检确认微信返回 40037 的无效 id，混进去会让整批请求
    // 失败、只报笼统的 20001（2026-10-28 就这样：报名模板 id 贴错，把汇总一起拖死）。
    // valid === null 表示还没查过，照常发，靠下面的 20001 重试兜底。
    const all = this.data.templates || [];
    const ready = all.filter((t) => t.ready && t.tmplId && t.valid !== false);
    const broken = all.filter((t) => t.ready && t.tmplId && t.valid === false);

    if (!ready.length) {
      const content = broken.length
        ? '后台自检发现提醒模板配置有问题（' + broken.map((t) => t.label).join('、') + '），所以微信不让授权。请联系管理员在后台「推送」页点「检查模板」。这段时间可以先看「消息」页的站内信，那边不受影响。'
        : '服务端还没配好订阅消息模板，现在领不了额度。可以先去「消息」页看站内信，那边不受影响。';
      wx.showModal({ title: '提醒还没开通', content: content, showCancel: false });
      return;
    }

    this.doRequestSubscribe(ready, broken, 0);
  },

  /**
   * attempt=0 首次请求；微信报 20001 且模板多于 1 个时，用「只留第一个」重试一次。
   * 代价是用户会看到第二次授权弹窗，但比「整批失败、一个都领不到」好。
   */
  doRequestSubscribe(ready, broken, attempt) {
    const ids = ready.map((t) => t.tmplId);
    const byId = {};
    ready.forEach((t) => {
      byId[t.tmplId] = t;
    });

    this.setData({ busy: 'sub' });
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res) => {
        const items = ids.map((id) => {
          const t = byId[id];
          return { key: t ? t.key : '', accept: res[id] === 'accept' };
        }).filter((x) => x.key);
        api
          .request('/api/mp/subscribe', { items: items })
          .then(() => {
            this.setData({ busy: '' });
            const got = items.filter((x) => x.accept).length;
            // 有模板被跳过时要说出来，否则用户不知道「为什么少领了一项」
            const skip = broken.length ? '（' + broken.map((t) => t.label).join('、') + ' 配置异常已跳过）' : '';
            if (got > 0) {
              wx.showToast({ title: '已领 ' + got + ' 次提醒' + skip, icon: 'none' });
            } else {
              wx.showToast({ title: '没勾选，暂时收不到通知' + skip, icon: 'none' });
            }
            this.load();
          })
          .catch((e) => {
            this.setData({ busy: '' });
            wx.showToast({ title: (e && e.message) || '记录失败', icon: 'none' });
          });
      },
      fail: (err) => {
        const code = (err && err.errCode) || 0;
        // 20001 通常是「这批 id 里有一个无效」。剔掉第一个再试一次，能抢救回剩下的。
        if (code === 20001 && attempt === 0 && ids.length > 1) {
          this.setData({ busy: '' });
          this.doRequestSubscribe([ready[0]], broken.concat(ready.slice(1)), 1);
          return;
        }
        this.setData({ busy: '' });
        let msg = (err && err.errMsg) || '授权失败';
        if (code === 20004) msg = '你在微信里把「订阅消息」总开关关掉了，去 小程序右上角 → 设置 里打开';
        else if (code === 20001) {
          msg = '微信说模板 id 无效（20001）。管理员可以在后台「推送」页点「检查模板」，一眼看出是哪个模板配错了。';
          if (attempt > 0) msg = msg.replace('模板 id 无效', '「' + ready[0].label + '」的模板 id 无效');
        } else if (code === 20002) msg = '模板数量超过上限';
        wx.showModal({ title: '没授权成功', content: msg, showCancel: false });
      }
    });
  },

  goMessages() {
    wx.navigateTo({ url: '/pages/messages/messages' });
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  }
});
