// 小程序统一后端调用封装
// - 后端与 Web 共用同一套 /api/*
// - 小程序没有 cookie：登录接口返回 token，存 storage，这里用 Authorization: Bearer 带过去
//   （后端 getSession 两条通道都认，见 lib/auth.js）
// - 域名需在小程序后台「request 合法域名」里加入 apiBase；
//   开发期可在开发者工具勾选「不校验合法域名」
const session = require('./session.js');

function getBase() {
  const app = getApp();
  const fromStore = wx.getStorageSync('apiBase');
  const fromApp = app && app.globalData && app.globalData.apiBase;
  return fromStore || fromApp || 'https://dota.playerallocationsystem.online';
}

function getToken() {
  return session.getToken();
}

function request(path, data, options) {
  const opts = options || {};
  const base = getBase();
  const url = /^https?:\/\//.test(path) ? path : base + path;
  const token = getToken();
  const header = Object.assign(
    { 'content-type': 'application/json' },
    token ? { Authorization: 'Bearer ' + token } : {},
    opts.header || {}
  );

  return new Promise((resolve, reject) => {
    wx.request({
      url: url,
      method: opts.method || 'POST',
      data: data,
      header: header,
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }

        const err = new Error(body.error || body.message || 'HTTP ' + res.statusCode);
        err.statusCode = res.statusCode;
        err.code = body.code || '';

        // 登录态失效：把本地那个已经没用的 token 清掉，免得后面每个请求都带着它白跑。
        // ⚠ 登录/注册接口的 401 是「账号或密码不对」，不是登录态失效，不能当成掉线处理。
        const isAuthEntry = path.indexOf('/api/login') === 0 || path.indexOf('/api/register') === 0;
        if (res.statusCode === 401 && !isAuthEntry && token) {
          session.clearLogin();
          err.code = err.code || 'SESSION_EXPIRED';
        }
        reject(err);
      },
      fail(err) {
        const e = new Error((err && err.errMsg) || '网络请求失败');
        e.code = 'NETWORK';
        reject(e);
      }
    });
  });
}

module.exports = { request, getBase, getToken };
