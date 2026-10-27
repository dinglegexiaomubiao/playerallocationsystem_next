/**
 * 小程序运行时最小实现（测试脚手架，不参与打包）。
 *
 * 目的：在 Node 里跑小程序的 Page 逻辑 —— 真 wx.request 打到线上接口，
 * storage 用真 Map（session.js 要能读回自己写的 token），Page/setData 按
 * 小程序语义实现（setData 合并 + 回调）。
 *
 * ⚠ 一个进程只建一个 runtime：Page/getApp 是全局单例，建两个会互相覆盖。
 */
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

function createRuntime(opts) {
  const baseUrl = opts.baseUrl;
  const root = opts.root;

  const store = new Map();
  if (opts.token) store.set('token', opts.token);

  const app = {
    globalData: {
      apiBase: baseUrl,
      token: opts.token || '',
      accountName: '',
      isAdmin: false,
      foodsDirty: false
    }
  };
  const toasts = [];

  function fakeRequest(req) {
    const u = new URL(req.url);
    const lib = u.protocol === 'http:' ? http : https;
    const method = String(req.method || 'GET').toUpperCase();
    const body =
      req.data === undefined || req.data === null
        ? ''
        : typeof req.data === 'string'
          ? req.data
          : JSON.stringify(req.data);
    const headers = Object.assign({}, req.header);
    if (body) headers['content-length'] = Buffer.byteLength(body);

    const r = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: method,
        headers: headers
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          let data = d;
          try {
            data = JSON.parse(d);
          } catch (e) {
            /* 非 JSON 原样交给页面逻辑 */
          }
          req.success && req.success({ statusCode: res.statusCode, data: data });
        });
      }
    );
    r.on('error', (e) => req.fail && req.fail({ errMsg: e.message }));
    if (body) r.write(body);
    r.end();
  }

  // 页面栈：navigateTo 压栈、navigateBack 弹栈、reLaunch 重置为 1 层。
  // 这一层必须真实实现，否则「登录成功后停在登录页」这类栈深相关的 bug 测不出来：
  // 真机上热启动会恢复到上次页面，栈深可能只有 1，navigateBack 会静默失败。
  const pageStack = [{ route: 'pages/index/index' }];
  const navLog = []; // 每次跳转按顺序记录，测试断言「去了哪」
  const record = (kind, url) => navLog.push({ kind: kind, url: url || '' });

  global.wx = {
    request: fakeRequest,
    getStorageSync: (k) => (store.has(k) ? store.get(k) : ''),
    setStorageSync: (k, v) => store.set(k, v),
    removeStorageSync: (k) => store.delete(k),
    stopPullDownRefresh: () => {},
    showToast: (o) => toasts.push(o && o.title),
    showModal: (o) => {
      // 默认按「确定」处理，这样二次确认的流程也能跑下去
      if (o && typeof o.success === 'function') o.success({ confirm: true });
    },
    navigateTo: (o) => {
      const url = (o && o.url) || '';
      record('navigateTo', url);
      pageStack.push({ route: url.replace(/^\//, '').split('?')[0] });
    },
    navigateBack: (o) => {
      if (pageStack.length > 1) {
        record('navigateBack', pageStack[pageStack.length - 1].route);
        pageStack.pop();
      } else {
        // 真机行为：栈底再返回是无效操作，只是静默失败（有 fail 回调才通知）
        record('navigateBack-fail', '');
        if (o && typeof o.fail === 'function') o.fail({ errMsg: 'navigateBack:fail cannot navigate back at first page' });
      }
    },
    reLaunch: (o) => {
      const url = (o && o.url) || '';
      record('reLaunch', url);
      pageStack.length = 0;
      pageStack.push({ route: url.replace(/^\//, '').split('?')[0] });
    },
    switchTab: (o) => {
      const url = (o && o.url) || '';
      record('switchTab', url);
      pageStack.length = 0;
      pageStack.push({ route: url.replace(/^\//, '').split('?')[0] });
    }
  };
  global.getApp = () => app;
  global.getCurrentPages = () => pageStack;

  let def = null;
  global.Page = (o) => {
    def = o;
  };

  let compDef = null;
  global.Component = (o) => {
    compDef = o;
  };

  /**
   * 路径键拆段：'teams[0].open' → ['teams', 0, 'open']。
   * 数组下标是小程序的标准写法（列表里只刷一项，避免重发整个数组），
   * 这里必须认，否则测试里的「点了没反应」其实是脚手架没实现。
   */
  function resolveSegments(pathStr) {
    const out = [];
    String(pathStr)
      .split('.')
      .forEach((part) => {
        const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
        if (!m) {
          out.push(part);
          return;
        }
        out.push(m[1]);
        const idxs = m[2].match(/\d+/g) || [];
        idxs.forEach((n) => out.push(Number(n)));
      });
    return out;
  }

  /** setData 的路径键实现，Page 与 Component 共用 */
  function attachSetData(inst) {
    inst.setData = function (patch, cb) {
      Object.keys(patch || {}).forEach((k) => {
        if (k.indexOf('.') < 0 && k.indexOf('[') < 0) {
          this.data[k] = patch[k];
          return;
        }
        const parts = resolveSegments(k);
        let cur = this.data;
        for (let i = 0; i < parts.length - 1; i++) {
          const seg = parts[i];
          const needArray = typeof parts[i + 1] === 'number';
          if (cur[seg] === undefined || cur[seg] === null || typeof cur[seg] !== 'object') {
            cur[seg] = needArray ? [] : {};
          }
          cur = cur[seg];
        }
        cur[parts[parts.length - 1]] = patch[k];
      });
      if (typeof cb === 'function') cb();
    };
  }

  function loadPage(rel) {
    def = null;
    const file = path.join(root, rel);
    delete require.cache[require.resolve(file)];
    require(file);
    if (!def) throw new Error(rel + ' 没有调用 Page()');
    const inst = Object.assign({}, def);
    inst.data = JSON.parse(JSON.stringify(def.data || {}));
    attachSetData(inst);
    return inst;
  }

  /**
   * 加载自定义组件。
   *
   * 只实现测试真正会用到的部分：properties 初值 → observer → attached → methods。
   * `triggerEvent` 把 detail 存到 `inst.events[name]`，测试直接断言它 ——
   * 组件不往外 emit 的话，页面那边永远拿不到值，这类问题必须在这里暴露。
   */
  function loadComponent(rel, props) {
    compDef = null;
    const file = path.join(root, rel);
    delete require.cache[require.resolve(file)];
    require(file);
    if (!compDef) throw new Error(rel + ' 没有调用 Component()');

    const inst = {};
    inst.data = JSON.parse(JSON.stringify(compDef.data || {}));
    inst.events = {};

    const propDefs = compDef.properties || {};
    Object.keys(propDefs).forEach((k) => {
      const p = propDefs[k];
      const given = props && Object.prototype.hasOwnProperty.call(props, k) ? props[k] : undefined;
      inst.data[k] = given !== undefined ? given : p && typeof p === 'object' ? p.value : undefined;
    });

    attachSetData(inst);
    inst.triggerEvent = function (name, detail) {
      this.events[name] = detail;
    };

    // methods 挂到实例上，调用时 this 就是 inst（和真机一致）
    Object.keys(compDef.methods || {}).forEach((k) => {
      inst[k] = compDef.methods[k];
    });

    // observer 先跑一次（真机上 properties 初值也会触发）
    Object.keys(propDefs).forEach((k) => {
      const p = propDefs[k];
      if (p && typeof p.observer === 'function') p.observer.call(inst, inst.data[k]);
    });

    if (compDef.lifetimes && typeof compDef.lifetimes.attached === 'function') {
      compDef.lifetimes.attached.call(inst);
    }
    return inst;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  return { store, app, toasts, loadPage, loadComponent, wait, baseUrl, navLog, pageStack };
}

module.exports = { createRuntime };
