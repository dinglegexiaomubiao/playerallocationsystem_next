#!/usr/bin/env node
/**
 * 登录页跳转回归测试（离线，不联网）
 *
 * 为什么需要这个脚本：真机 bug —— 登录成功后停在登录界面。
 * 根因是 `wx.navigateBack()` 在页面栈只有 1 层时静默失败，而小程序**热启动会恢复
 * 上次的页面栈**：用户上次停在登录页，再打开时栈里就一层，登录成功也回不去。
 *
 * 这个脚本用 mp-runtime 的页面栈模拟把三种场景钉死：
 *   1. 栈深 1（热启动恢复到登录页）→ 必须 reLaunch 首页
 *   2. 栈深 2（从「我的」点登录进来）→ 必须 navigateBack 回上一页
 *   3. 未登录进入登录页 → 不许乱跳
 *
 * 用法：node scripts/check-miniprogram-login.cjs
 */
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const ROOT = path.join(__dirname, '..', 'miniprogram');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) {
    pass++;
  } else {
    fails.push(name + (extra ? ' → ' + extra : ''));
  }
}

/** 每次断言用干净的运行时（storage 与页面栈互不干扰） */
function fresh(opts) {
  const rt = createRuntime({
    baseUrl: 'http://127.0.0.1:1', // 不会被请求到，只是占位
    root: ROOT,
    token: ''
  });
  // 页面栈：默认 [index]；deep=true 表示从「我的」点进来，栈是 [index, mine, login]
  if (opts.stack === 2) {
    global.wx.navigateTo({ url: '/pages/mine/mine' });
    global.wx.navigateTo({ url: '/pages/login/login' });
  } else if (opts.stack === 1) {
    // 模拟热启动恢复到登录页：栈里只有它，且没有 index
    const st = rt.pageStack;
    st.length = 0;
    st.push({ route: 'pages/login/login' });
  }
  if (opts.loggedIn) {
    global.wx.setStorageSync('token', 'fake-token-for-test');
    global.wx.setStorageSync('accountName', 'dom');
  }
  // 搭页面栈本身会产生 navigateTo 日志，属于测试脚手架噪音，不能算进页面行为的断言
  rt.navLog.length = 0;
  const page = rt.loadPage('pages/login/login.js');
  return { rt, page };
}

// ── 场景 1：热启动恢复到登录页（栈深 1），且已登录 → 必须 reLaunch 首页
{
  const { rt, page } = fresh({ stack: 1, loggedIn: true });
  page.onLoad();
  const kinds = rt.navLog.map((x) => x.kind);
  ok('栈深1+已登录：reLaunch 首页', kinds.includes('reLaunch'), kinds.join(',') || '没有发生任何跳转');
  const last = rt.navLog[rt.navLog.length - 1];
  ok('栈深1+已登录：目标是首页', last && last.url === '/pages/index/index', last && last.url);
  ok('栈深1+已登录：栈被重置为 1 层', rt.pageStack.length === 1, String(rt.pageStack.length));
}

// ── 场景 2：热启动恢复到登录页，登录成功后（goBack）→ 必须 reLaunch 首页
// 这是用户报的那个 bug 的最小复现：栈深 1 时 navigateBack 无效，只能 reLaunch
{
  const { rt, page } = fresh({ stack: 1, loggedIn: true });
  page.goBack();
  const kinds = rt.navLog.map((x) => x.kind);
  ok('栈深1 登录成功：走 reLaunch', kinds.includes('reLaunch'), kinds.join(','));
  ok('栈深1 登录成功：不依赖 navigateBack', !kinds.includes('navigateBack'), kinds.join(','));
  ok('栈深1 登录成功：落在首页', rt.pageStack[0].route === 'pages/index/index', rt.pageStack[0].route);
}

// ── 场景 3：从「我的」点登录进来（栈深 2），登录成功 → navigateBack 回上一页
{
  const { rt, page } = fresh({ stack: 2, loggedIn: true });
  const before = rt.pageStack.length;
  page.goBack();
  const kinds = rt.navLog.map((x) => x.kind);
  ok('栈深2 登录成功：走 navigateBack', kinds.includes('navigateBack'), kinds.join(','));
  ok('栈深2 登录成功：栈深减少 1', rt.pageStack.length === before - 1, before + '→' + rt.pageStack.length);
  ok('栈深2 登录成功：回到登录页之前那页', rt.pageStack[rt.pageStack.length - 1].route === 'pages/mine/mine', rt.pageStack.map((p) => p.route).join('>'));
  ok('栈深2 登录成功：没有 reLaunch 兜底误触发', !kinds.includes('reLaunch'), kinds.join(','));
}

// ── 场景 4：栈深 2 且已登录时进登录页（onLoad）→ 直接退回上一页
{
  const { rt, page } = fresh({ stack: 2, loggedIn: true });
  page.onLoad();
  const kinds = rt.navLog.map((x) => x.kind);
  ok('栈深2+已登录 onLoad：navigateBack', kinds.includes('navigateBack'), kinds.join(','));
}

// ── 场景 5：未登录进登录页 → 不许跳走（否则用户永远登不上）
{
  const { rt, page } = fresh({ stack: 2, loggedIn: false });
  page.onLoad();
  ok('未登录 onLoad：不跳转', rt.navLog.length === 0, rt.navLog.map((x) => x.kind).join(','));
  ok('未登录 onLoad：栈深不变', rt.pageStack.length === 3, String(rt.pageStack.length));
}

// ── 场景 5b：未登录 + 栈深 1（热启动恢复到登录页）→ 回首页，别一开门就要账号密码
{
  const { rt, page } = fresh({ stack: 1, loggedIn: false });
  page.onLoad();
  const kinds = rt.navLog.map((x) => x.kind);
  ok('栈深1+未登录：reLaunch 首页', kinds.includes('reLaunch'), kinds.join(',') || '卡在登录页');
  ok('栈深1+未登录：落在首页', rt.pageStack[0].route === 'pages/index/index', rt.pageStack[0].route);
}

// ── 场景 6：navigateBack 失败时必须落到 reLaunch（防真机异常分支）
{
  const { rt, page } = fresh({ stack: 2, loggedIn: true });
  // 把栈砍到 1 层但让 getCurrentPages 仍报 2 层，模拟「判断与真实栈不一致」
  const realPush = global.wx.navigateTo;
  let first = true;
  global.wx.navigateBack = (o) => {
    if (first) {
      first = false;
      rt.navLog.push({ kind: 'navigateBack-fail', url: '' });
      if (o && typeof o.fail === 'function') o.fail({ errMsg: 'simulated' });
    } else {
      rt.pageStack.pop();
      rt.navLog.push({ kind: 'navigateBack', url: '' });
    }
  };
  page.goBack();
  const kinds = rt.navLog.map((x) => x.kind);
  ok('navigateBack 失败：有 reLaunch 兜底', kinds.includes('reLaunch'), kinds.join(','));
  global.wx.navigateTo = realPush;
}

// ── 汇总
console.log('\n[登录跳转回归] ' + (fails.length ? '❌ 有失败' : '✅ 全部通过') + '（' + pass + '/' + (pass + fails.length) + '）');
if (fails.length) {
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
