// 静默 wx.login 换 openid，**只为内容安全**。
//
// 服务端要调微信 security.msgSecCheck，而那个接口强制要求 openid（不带直接 40003，
// 2026-10-29 实测）。本项目是账号密码登录、不走 wx.login，本来就没有 openid，
// 所以这里在小程序启动时静默换一次，存下来给 utils/api.js 加请求头。
//
// 三条原则：
//   1. 全程静默：失败不弹窗、不打断任何流程，拿不到就是「没有」，服务端会跳过官方检查。
//   2. 不参与登录：openid 只进请求头，不写进 session、不用于区分账号。
//   3. 一次性 code：每次都要现调 wx.login，复用旧 code 会拿到 40163。
//      openid 本身对同一小程序+同一用户是固定值，成功一次就够，之后直接用缓存。
const KEY_OPENID = 'wxOpenid';

// ⚠ 不能 require('./api')：api.js 要 require 本文件取请求头，会形成循环依赖。
//    这里自己拼 base 发请求，逻辑跟 api.js 的 getBase 保持一致。
const DEFAULT_BASE = 'https://dota.playerallocationsystem.online';

function getBase() {
  try {
    const app = getApp();
    const fromStore = wx.getStorageSync('apiBase');
    const fromApp = app && app.globalData && app.globalData.apiBase;
    return fromStore || fromApp || DEFAULT_BASE;
  } catch (e) {
    return DEFAULT_BASE;
  }
}

/** 同步取缓存的 openid（api.js 每个请求都要读，必须同步） */
function current() {
  try {
    return String(wx.getStorageSync(KEY_OPENID) || '');
  } catch (e) {
    return '';
  }
}

let pending = null;

/**
 * 确保拿到 openid。已有缓存直接返回；否则静默换一次。
 * @returns {Promise<string>} 拿不到返回空串（不 reject，调用方不用写 catch）
 */
function ensure() {
  const cached = current();
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;

  pending = new Promise((resolve) => {
    wx.login({
      success(res) {
        const code = (res && res.code) || '';
        if (!code) {
          resolve('');
          return;
        }
        wx.request({
          url: getBase() + '/api/mp/openid',
          method: 'POST',
          header: { 'content-type': 'application/json' },
          data: { code: code },
          success(r) {
            const body = r.data || {};
            const openid = r.statusCode === 200 && body.success ? String(body.openid || '') : '';
            if (openid) {
              try {
                wx.setStorageSync(KEY_OPENID, openid);
              } catch (e) {
                /* 存不下也不影响本次请求 */
              }
            }
            resolve(openid);
          },
          fail() {
            resolve('');
          },
        });
      },
      fail() {
        resolve('');
      },
    });
  }).then((v) => {
    pending = null;
    return v;
  });

  return pending;
}

/** 缓存失效时清掉，下次请求会重新换（例如服务端换了 AppID） */
function clear() {
  try {
    wx.removeStorageSync(KEY_OPENID);
  } catch (e) {
    /* ignore */
  }
}

module.exports = { current, ensure, clear, KEY_OPENID };
