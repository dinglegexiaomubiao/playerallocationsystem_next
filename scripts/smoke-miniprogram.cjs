#!/usr/bin/env node
/**
 * 小程序页面「联调沙箱」：不开 DevTools，用真实线上接口把每个页面的
 * 数据装配逻辑跑一遍，看它有没有把字段映射错。
 *
 * 做法：垫一层最小 `Page` / `wx` / `getApp`（storage 用真内存 Map），
 * 把 wx.request 代理到 https，然后调生命周期，检查 setData 之后的数据。
 *
 * 用法：
 *   node scripts/smoke-miniprogram.cjs
 *   MP_TOKEN=<服务器签发的 token> node scripts/smoke-miniprogram.cjs
 *
 * MP_TOKEN 那份 token 用：
 *   在服务器上 cp lib/auth.js /tmp/a.mjs，source .env.local 后
 *   node --input-type=module -e "import('/tmp/a.mjs').then(m=>process.stdout.write(m.createToken('dom')))"
 * 传进来后会额外验证「带身份」与「登录态渲染」两条链路。
 */
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const BASE = process.argv[2] || 'https://dota.playerallocationsystem.online';
const ROOT = path.join(__dirname, '..', 'miniprogram');
const MP_TOKEN = process.env.MP_TOKEN || '';

// ---------- 1) 伪造小程序运行时 ----------
function fakeRequest(opts) {
  const u = new URL(opts.url);
  const lib = u.protocol === 'http:' ? http : https;
  const method = String(opts.method || 'GET').toUpperCase();
  const body =
    opts.data === undefined || opts.data === null
      ? ''
      : typeof opts.data === 'string'
        ? opts.data
        : JSON.stringify(opts.data);
  const headers = Object.assign({}, opts.header);
  if (body) headers['content-length'] = Buffer.byteLength(body);

  const req = lib.request(
    { hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method, headers },
    (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        let data = d;
        try {
          data = JSON.parse(d);
        } catch (e) {
          /* 非 JSON 原样交给页面逻辑暴露问题 */
        }
        opts.success && opts.success({ statusCode: r.statusCode, data: data });
      });
    }
  );
  req.on('error', (e) => opts.fail && opts.fail({ errMsg: e.message }));
  if (body) req.write(body);
  req.end();
}

// storage 用真 Map：session.js 会写 token/accountName/isAdmin，必须真的落住才能测登录态
const store = new Map();
const app = { globalData: { apiBase: BASE, token: '', accountName: '', isAdmin: false } };
const toasts = [];

global.wx = {
  request: fakeRequest,
  getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
  setStorageSync: (k, v) => store.set(k, v),
  removeStorageSync: (k) => store.delete(k),
  stopPullDownRefresh: () => {},
  showToast: (o) => toasts.push(o && o.title),
  showModal: () => {},
  navigateTo: () => {},
  navigateBack: () => {},
  switchTab: () => {}
};
global.getApp = () => app;

let pageDef = null;
global.Page = (o) => {
  pageDef = o;
};

function loadPage(rel) {
  pageDef = null;
  const file = path.join(ROOT, rel);
  delete require.cache[require.resolve(file)];
  require(file);
  if (!pageDef) throw new Error(rel + ' 没有调用 Page()');
  const inst = Object.assign({}, pageDef);
  inst.data = JSON.parse(JSON.stringify(pageDef.data || {}));
  inst.setData = function (patch, cb) {
    Object.assign(this.data, patch);
    if (typeof cb === 'function') cb();
  };
  return inst;
}

const briefly = (v, n = 120) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + '…' : s;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let fail = 0;
async function run(title, rel, query, inspect) {
  try {
    const p = loadPage(rel);
    p.onLoad && p.onLoad(query || {});
    p.onShow && p.onShow();
    await wait(3500);
    if (p.data.error) throw new Error('页面报错: ' + p.data.error);
    const line = inspect(p.data);
    if (line instanceof Error) throw line;
    console.log('  ✓ ' + title + ' → ' + line);
  } catch (e) {
    console.log('  ✗ ' + title + ' → ' + e.message);
    fail++;
  }
}

(async () => {
  console.log('\n[小程序联调] ' + BASE + '\n');
  if (MP_TOKEN) store.set('token', MP_TOKEN);

  console.log('— 只读页面 —');
  await run('首页', 'pages/index/index.js', {}, (d) => {
    if (d.modules.some((m) => !m.path)) return new Error('有模块没有 path');
    if (!d.quotes.length) return new Error('语录轮播为空');
    return d.modules.length + ' 个模块 / 轮播 ' + d.quotes.length + ' 条，首条「' + briefly(d.quotes[0].content, 30) + '」';
  });

  await run('群友列表', 'pages/members/members.js', {}, (d) => {
    if (!d.list.length) return new Error('列表为空');
    if (!d.list[0].initial || d.list[0].initial === 'undefined') return new Error('initial 没算出来');
    return d.total + ' 人，首行「' + d.list[0].nickname + ' / ' + d.list[0].score + '」';
  });

  await run('群友名片', 'pages/member/member.js', { id: '17924949338839183' }, (d) => {
    const p = d.p;
    if (!p) return new Error('没取到人');
    const r = p.records[0] || {};
    return p.nickname + '：胜率 ' + p.winRate + '% · 冠军 ' + p.championships + ' · 参赛 ' + p.recordCount + ' 届 · 首条记录「' + r.tournament + ' ' + r.dateText + ' ' + r.rankText + '」';
  });

  await run('赛事', 'pages/tournaments/tournaments.js', {}, (d) => {
    if (!d.list.length) return new Error('列表为空');
    return d.list.length + ' 届，首条「' + d.list[0].name + ' / ' + d.list[0].statusText + '」';
  });

  await run('语录', 'pages/quotes/quotes.js', {}, (d) => {
    if (!d.groups.length) return new Error('分组为空');
    return d.total + ' 条 → ' + d.groups.length + ' 个月份组，首组「' + d.groups[0].label + '」' + d.groups[0].items.length + ' 条';
  });

  await run('美食', 'pages/foods/foods.js', {}, (d) => {
    if (!d.list.length) return new Error('列表为空');
    if (d.list[0].ratingStars.indexOf('★') < 0) return new Error('星级没生成');
    return d.total + ' 家 / 菜系 ' + d.cuisines.length + ' 类，首行「' + d.list[0].name + ' ' + d.list[0].ratingStars + '」';
  });

  await run('活动', 'pages/activities/activities.js', {}, (d) => d.total + ' 个活动（0 条也算通过）');

  await run('开黑', 'pages/party/party.js', {}, (d) => {
    if (!d.list.length) return new Error('列表为空');
    return d.total + ' 条组队，首条「' + briefly(d.list[0].title, 20) + ' / ' + d.list[0].peopleText + '」';
  });

  await run('帮派', 'pages/guilds/guilds.js', {}, (d) => {
    if (!d.list.length) return new Error('列表为空');
    const g = d.list[0];
    if (String(g.color).indexOf('object') >= 0) return new Error('color 是对象，没取 solid');
    if (!/^#|^rgb|^var/.test(String(g.color))) return new Error('color 不像色值: ' + g.color);
    return d.total + ' 个，首个「' + g.name + ' ' + g.memberText + ' 色 ' + g.color + '」';
  });

  await run('分布', 'pages/dist/dist.js', {}, (d) => {
    if (!d.areas.length) return new Error('没有区');
    if (d.areas[0].pct < 1) return new Error('pct 没算出来');
    return d.scopeName + ' ' + d.areas.length + ' 区，最多「' + d.areas[0].name + ' ' + d.areas[0].playerCount + ' 人」';
  });

  // ---------- 登录与会话 ----------
  console.log('\n— 登录与会话 —');
  const session = require(path.join(ROOT, 'utils', 'session.js'));
  const api = require(path.join(ROOT, 'utils', 'api.js'));

  // 1) 登录失败路径（真打 /api/login，用一个绝不存在的账号，不产生任何数据）
  try {
    session.clearLogin();
    const p = loadPage('pages/login/login.js');
    p.onLoad({});
    p.onUsername({ detail: { value: '__probe_not_exist__' } });
    p.onPassword({ detail: { value: 'x' } });
    p.submit();
    await wait(3000);
    const d = p.data;
    if (!d.error) throw new Error('失败了却没报错');
    if (!d.showRegisterHint) throw new Error('USER_NOT_FOUND 没给出注册提示');
    if (session.getToken()) throw new Error('失败却写进了 token');
    console.log('  ✓ 登录失败路径 → 「' + d.error + '」提示「' + briefly(d.hint, 24) + '」，未写入 token');
  } catch (e) {
    console.log('  ✗ 登录失败路径 → ' + e.message);
    fail++;
  }

  // 2) 登录成功路径：需要真实密码，靠 deploy/probe-account.cjs 临时建的 _mp_probe
  if (process.env.MP_PROBE_USER && process.env.MP_PROBE_PASS) {
    try {
      session.clearLogin();
      const p = loadPage('pages/login/login.js');
      p.onLoad({});
      p.onUsername({ detail: { value: process.env.MP_PROBE_USER } });
      p.onPassword({ detail: { value: process.env.MP_PROBE_PASS } });
      p.submit();
      await wait(4000);
      if (p.data.error) throw new Error('登录失败: ' + p.data.error);
      const token = session.getToken();
      if (!token) throw new Error('登录成功但没存下 token');
      if (session.getUser().name !== process.env.MP_PROBE_USER) throw new Error('存下的账号名不对');

      // token 到底认不认？POST /api/party 若被当成未登录会 401；
      // 探针账号没绑选手，所以预期是 400「请先补填选手资料」—— 400 就说明会话已经认出来了。
      let status = 0;
      try {
        await api.request('/api/party', {}, { method: 'POST' });
        status = 200;
      } catch (e) {
        status = e.statusCode;
      }
      if (status === 401) throw new Error('登录后仍被判未登录');
      console.log('  ✓ 登录成功路径 → 存下 token（' + token.length + ' 字符），带它请求被服务端认出（HTTP ' + status + '，非 401）');
      session.clearLogin();
    } catch (e) {
      console.log('  ✗ 登录成功路径 → ' + e.message);
      fail++;
    }
  } else {
    console.log('  · 跳过登录成功路径（未传 MP_PROBE_USER / MP_PROBE_PASS）');
  }

  // 3) 登录态渲染（我的页要能认出登录的人）
  if (MP_TOKEN) {
    try {
      session.setLogin({ token: MP_TOKEN, name: 'dom', isAdmin: true });
      const mine = loadPage('pages/mine/mine.js');
      mine.onShow();
      const d = mine.data;
      if (!d.logged) throw new Error('我的页没认出登录态');
      if (d.name !== 'dom') throw new Error('账号名不对: ' + d.name);
      if (!d.isAdmin) throw new Error('管理员标记丢了');
      if (!d.initial) throw new Error('首字母没算出来');
      console.log('  ✓ 我的页登录态 → ' + d.name + '（管理员 ' + d.isAdmin + '）首字母 ' + d.initial + ' / 登录于 ' + d.loginAtText);
    } catch (e) {
      console.log('  ✗ 我的页登录态 → ' + e.message);
      fail++;
    }

    // 3) 带 token 请求，服务端要认得出人
    try {
      const res = await api.request('/api/party', null, { method: 'GET' });
      if (!res.me || !res.me.bound) throw new Error('服务端没认出来: ' + JSON.stringify(res.me));
      console.log('  ✓ Bearer 身份识别 → ' + res.me.nickname + ' / ' + res.me.playerId);
    } catch (e) {
      console.log('  ✗ Bearer 身份识别 → ' + e.message);
      fail++;
    }
  } else {
    console.log('  · 跳过登录态验证（未传 MP_TOKEN）');
  }

  // 4) 401 自动清 token（POST /api/party 在鉴权闸门就被拒，不会写库）
  try {
    // ⚠ 头值必须是 ASCII：Node 的 http 客户端会直接拒掉非 ASCII 头，
    //    请求发不出去，测到的会是 NETWORK 而不是 401。
    store.set('token', 'bogus-token-1234');
    app.globalData.token = 'bogus-token-1234';
    let code = '';
    try {
      await api.request('/api/party', {}, { method: 'POST' });
      throw new Error('坏 token 居然请求成功了');
    } catch (e) {
      code = e.code;
      if (e.statusCode !== 401) throw new Error('期望 401，实际 ' + e.statusCode);
    }
    if (store.get('token')) throw new Error('401 后 token 没被清掉');
    console.log('  ✓ 401 自动清 token → code=' + code + '，storage 已清空');
  } catch (e) {
    console.log('  ✗ 401 自动清 token → ' + e.message);
    fail++;
  }

  console.log('\n' + (fail ? '❌ ' + fail + ' 项没通过\n' : '✅ 全部通过\n'));
  process.exit(fail ? 1 : 0);
})();
