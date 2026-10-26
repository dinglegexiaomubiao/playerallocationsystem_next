// 意见反馈 / 问题报错。
//
// 两个入口合一，是因为服务端本来就是一张表两种 kind（`feedback` / `error`），
// 用户不用先判断「我这算反馈还是算 bug」—— 切个类型就行。
//
// 「我的反馈」能查到未登录时提交的工单，靠的是 client_token：小程序生成一个
// 持久化的随机串，提交时带上，之后按 token 查（服务端 listMySupportReports
// 认 account 或 client_token 两者之一）。
const { request, getBase } = require('../../utils/api');
const { fmtDateTime } = require('../../utils/format');
const session = require('../../utils/session');

const TOKEN_KEY = 'supportClientToken';
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

const STATUS_TEXT = {
  new: '待处理',
  doing: '处理中',
  done: '已解决',
  ignored: '已忽略'
};

function randomToken() {
  // 服务端只认 [A-Za-z0-9_-]{8,64}；这里凑两个随机段，够用且不会撞
  const a = Math.random().toString(36).slice(2, 10);
  const b = Date.now().toString(36);
  return (a + b + Math.random().toString(36).slice(2, 8)).slice(0, 32);
}

function getClientToken() {
  let t = '';
  try {
    t = wx.getStorageSync(TOKEN_KEY) || '';
  } catch (e) {
    t = '';
  }
  if (!TOKEN_RE.test(t)) {
    t = randomToken();
    try {
      wx.setStorageSync(TOKEN_KEY, t);
    } catch (e) {
      /* 存不下就只在本页用 */
    }
  }
  return t;
}

Page({
  data: {
    tab: 'form',
    kind: 'feedback',
    message: '',
    contact: '',
    submitting: false,
    error: '',

    logged: false,
    reports: [],
    loadingMine: false,
    mineError: ''
  },

  onLoad() {
    this.token = getClientToken();
    this.setData({ logged: session.isLoggedIn() });
  },

  onShow() {
    const logged = session.isLoggedIn();
    if (logged !== this.data.logged) this.setData({ logged: logged });
    if (this.data.tab === 'mine') this.loadMine();
  },

  onPullDownRefresh() {
    if (this.data.tab !== 'mine') return wx.stopPullDownRefresh();
    this.loadMine().then(
      () => wx.stopPullDownRefresh(),
      () => wx.stopPullDownRefresh()
    );
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab === 'mine' ? 'mine' : 'form';
    this.setData({ tab: tab });
    if (tab === 'mine') this.loadMine();
  },

  pickKind(e) {
    const kind = e.currentTarget.dataset.kind === 'error' ? 'error' : 'feedback';
    this.setData({ kind: kind, error: '' });
  },

  onInput(e) {
    const patch = {};
    patch[e.currentTarget.dataset.k] = e.detail.value;
    this.setData(patch);
  },

  submit() {
    if (this.data.submitting) return;
    const message = String(this.data.message || '').trim();
    if (!message) {
      return this.setData({
        error: this.data.kind === 'error' ? '说一下哪里报错了' : '写点内容吧'
      });
    }

    const body = {
      kind: this.data.kind,
      // category 只是给后台粗分类用的标签，小程序侧没有更细的分法
      category: 'miniprogram',
      message: message,
      contact: String(this.data.contact || '').trim() || undefined,
      // 让「我的反馈」在未登录时也能查到刚才这条
      client_token: this.token,
      // 后台看到来源能直接定位到是哪个页面报的
      page_url: 'miniprogram://pages/feedback/feedback'
    };

    this.setData({ submitting: true, error: '' });
    request('/api/support', body, { method: 'POST' })
      .then((res) => {
        this.setData({ submitting: false, message: '', contact: '' });
        wx.showToast({
          title: res && res.deduped ? '这条已经提交过了' : '已收到，谢谢',
          icon: 'success'
        });
        // 直接切到「我的反馈」，让用户看到自己那条确实进了列表
        this.setData({ tab: 'mine' });
        this.loadMine();
      })
      .catch((e) =>
        this.setData({ submitting: false, error: (e && e.message) || '提交失败' })
      );
  },

  loadMine() {
    this.setData({ loadingMine: true, mineError: '' });
    // account 由登录态带出去，token 覆盖「没登录时提交的那几条」
    return request('/api/support?mine=1&token=' + encodeURIComponent(this.token), null, {
      method: 'GET'
    })
      .then((res) => {
        const list = (res && res.reports) || [];
        const rows = list.map((r) => {
          const st = r.status || 'new';
          return {
            id: String(r.id),
            message: r.message || '',
            timeText: fmtDateTime(r.created_at),
            statusText: STATUS_TEXT[st] || st,
            statusKey: st,
            reply: r.reply || '',
            replyText: r.replied_at ? '回复于 ' + fmtDateTime(r.replied_at) : ''
          };
        });
        this.setData({ loadingMine: false, reports: rows });
      })
      .catch((e) =>
        this.setData({
          loadingMine: false,
          mineError: (e && e.message) || '没取到反馈记录'
        })
      );
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  /** 报错类反馈带上当前后端地址，排查「接口全 500」这类问题很有用 */
  copyBase() {
    const base = getBase();
    wx.setClipboardData({
      data: base,
      success: () => wx.showToast({ title: '后端地址已复制', icon: 'none' })
    });
  }
});
