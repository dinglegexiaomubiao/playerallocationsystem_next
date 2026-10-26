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
    navigateTo: () => {},
    navigateBack: () => {},
    switchTab: () => {}
  };
  global.getApp = () => app;

  let def = null;
  global.Page = (o) => {
    def = o;
  };

  let compDef = null;
  global.Component = (o) => {
    compDef = o;
  };

  /** setData 的路径键实现，Page 与 Component 共用 */
  function attachSetData(inst) {
    inst.setData = function (patch, cb) {
      /**
       * 支持路径键（`'form.error': 'xx'`）—— 小程序里这是标准写法，页面靠它只刷一个字段。
       * 之前这里是 Object.assign 平铺，路径键会被当成字面 key 塞进 data，
       * 于是「页面提示没出现」其实是测试脚手架没实现，不是页面写错。
       */
      Object.keys(patch || {}).forEach((k) => {
        if (k.indexOf('.') < 0) {
          this.data[k] = patch[k];
          return;
        }
        const parts = k.split('.');
        let cur = this.data;
        for (let i = 0; i < parts.length - 1; i++) {
          const seg = parts[i];
          if (!cur[seg] || typeof cur[seg] !== 'object') cur[seg] = {};
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

  return { store, app, toasts, loadPage, loadComponent, wait, baseUrl };
}

module.exports = { createRuntime };
