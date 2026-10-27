// 登录态的**唯一**读写入口。
//
// 后端给的是同一个 HMAC 签名串：网页塞进 httpOnly cookie，小程序放进 storage
// 当 `Authorization: Bearer` 用（见 lib/auth.js 的 getSession）。
// storage 和 app.globalData 两处都写，是因为 app.globalData 会被热启动保留，
// 而 storage 是冷启动时的唯一真相 —— 只写一处会在「杀进程再进」时丢登录态。
const K_TOKEN = 'token';
const K_NAME = 'accountName';
const K_ADMIN = 'isAdmin';
const K_AT = 'loginAt';

function app() {
  try {
    return getApp();
  } catch (e) {
    return null;
  }
}

function getToken() {
  const a = app();
  const fromApp = a && a.globalData && a.globalData.token;
  return fromApp || wx.getStorageSync(K_TOKEN) || '';
}

function getUser() {
  const token = getToken();
  if (!token) return null;
  return {
    token: token,
    name: wx.getStorageSync(K_NAME) || '',
    isAdmin: !!wx.getStorageSync(K_ADMIN),
    loginAt: wx.getStorageSync(K_AT) || 0
  };
}

function isLoggedIn() {
  return !!getToken();
}

/** 登录成功后调用：{ token, name, isAdmin } */
function setLogin(info) {
  const token = (info && info.token) || '';
  wx.setStorageSync(K_TOKEN, token);
  wx.setStorageSync(K_NAME, (info && info.name) || '');
  wx.setStorageSync(K_ADMIN, !!(info && info.isAdmin));
  wx.setStorageSync(K_AT, Date.now());
  const a = app();
  if (a && a.globalData) {
    a.globalData.token = token;
    a.globalData.accountName = (info && info.name) || '';
    a.globalData.isAdmin = !!(info && info.isAdmin);
  }
}

function clearLogin() {
  [K_TOKEN, K_NAME, K_ADMIN, K_AT].forEach(function (k) {
    try {
      wx.removeStorageSync(k);
    } catch (e) {
      /* 忽略 */
    }
  });
  const a = app();
  if (a && a.globalData) {
    a.globalData.token = '';
    a.globalData.accountName = '';
    a.globalData.isAdmin = false;
  }
}

module.exports = { getToken, getUser, isLoggedIn, setLogin, clearLogin };
