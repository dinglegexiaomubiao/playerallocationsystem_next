import { Html, Head, Main, NextScript } from 'next/document';
import { THEME_BOOT_SCRIPT, THEME_COLOR, THEME_DEFAULT } from '../lib/theme';

/**
 * 自定义 Document：只为三件事存在
 * 1. lang="zh-CN"（默认是 en，影响读屏与字体回退）
 * 2. 首屏内联主题脚本 —— 必须早于任何渲染，否则浅色用户每次刷新
 *    都会先看到一帧深色再跳成浅色
 * 3. 静态资源自愈 —— 见下面 ASSET_SELFHEAL_SCRIPT 的说明
 */

/**
 * 部署后「页面能打开但一条数据都没有」的自愈脚本。
 *
 * 故障链：手机浏览器缓存了旧 HTML → 我们重新部署重建了 .next →
 * 旧 HTML 引用的 /_next/static/<旧buildId>/*.js 已经是 404 → React 没能
 * hydrate → 页面只剩预渲染的骨架，客户端 fetch 一次都没发出。
 *
 * 服务端已经给 HTML 加了 Cache-Control: no-cache（见 Nginx 的 laroja-proxy.conf），
 * 这里再加一道客户端兜底：捕获 script 加载失败就重新拉页面，拿到新 HTML 即恢复。
 * 60 秒内只自愈一次，避免极端情况下反复刷新。
 */
const ASSET_SELFHEAL_SCRIPT = `
(function () {
  var KEY = 'laroja-asset-selfheal';
  function lastTry() {
    try { return Number(sessionStorage.getItem(KEY) || 0); } catch (e) { return 0; }
  }
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (!t || t.tagName !== 'SCRIPT' || !t.src) return;
    if (t.src.indexOf('/_next/static/') === -1) return;
    if (Date.now() - lastTry() < 60000) return;
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e2) {}
    location.reload();
  }, true);
})();
`;

/**
 * 启动期错误探针（必须早于 React 加载，所以写成内联脚本）。
 *
 * 背景：2026-10-22 线上出现「iPhone 打开站点只有骨架、没有数据、也没有任何提示，
 * 管理后台还查不到这次访问」。查 Nginx 日志发现：这些 iPhone（集中在 iOS 16.x）
 * 把 /_next/static/*.js 全下下来了（都是 200），却一次 /api/* 都没发过 ——
 * 说明 JS 是「下载成功但执行阶段挂了」，React 压根没接管页面。
 *
 * 这类失败发生在 installErrorReporting() 之前（那玩意儿挂在 _app 的 useEffect 里，
 * 只有水合成功才会跑），所以原有采集一条都收不到。这里在 <head> 最前面装一个
 * ES5 写的兜底探针：
 *   1. window.error / unhandledrejection → 拿到真实报错与堆栈；
 *   2. 6 秒后探测 React 有没有接管 #__next（水合失败的静默场景也能报上来）。
 *
 * 全部用 ES5 语法（var / 普通函数 / 无模板字符串）：探针自己要是用了老 Safari
 * 不认的语法，就正好在最需要它的时候先挂掉。
 */
const BOOT_PROBE_SCRIPT = `
(function () {
  var sent = 0, MAX = 3, ENDPOINT = '/api/support';

  function send(category, message, detail) {
    if (sent >= MAX) return;
    sent++;
    var payload;
    try {
      payload = JSON.stringify({
        kind: 'error',
        category: category,
        message: String(message || '未知错误').slice(0, 1200),
        page_url: String(location.href).slice(0, 400),
        detail: {
          ua: String(navigator.userAgent).slice(0, 300),
          viewport: window.innerWidth + 'x' + window.innerHeight,
          lang: String(navigator.language || ''),
          online: navigator.onLine,
          boot: true,
          name: (detail && detail.name) || null,
          stack: String((detail && detail.stack) || '').slice(0, 600),
          source: String((detail && detail.source) || '').slice(0, 200),
          line: (detail && detail.line) || null,
          col: (detail && detail.col) || null
        }
      });
    } catch (e) { return; }

    // sendBeacon 优先（页面正在跳转/关闭也发得出去），失败退回 XHR
    try {
      if (navigator.sendBeacon && window.Blob) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
        return;
      }
    } catch (e1) {}
    try {
      var x = new XMLHttpRequest();
      x.open('POST', ENDPOINT, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(payload);
    } catch (e2) {}
  }

  window.addEventListener('error', function (e) {
    if (!e) return;
    var t = e.target;
    // 资源加载失败没有 message，用 target 区分（脚本 404 会触发上面的自愈刷新）
    if (t && t !== window && t.tagName) {
      var tag = String(t.tagName).toUpperCase();
      if (tag === 'SCRIPT' || tag === 'LINK') {
        send('resource', tag + ' 加载失败：' + (t.src || t.href || ''), { name: tag });
      }
      return;
    }
    var err = e.error;
    send('boot', 'JS 启动失败：' + ((err && err.message) || e.message || '未知'), {
      name: (err && err.name) || 'Error',
      stack: (err && err.stack) || '',
      source: e.filename || '',
      line: e.lineno || null,
      col: e.colno || null
    });
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    send('boot', '未捕获的异步异常：' + ((r && (r.message || r.toString())) || ''), {
      name: (r && r.name) || 'UnhandledRejection',
      stack: (r && r.stack) || ''
    });
  });

  // React 18 水合成功后会给根容器挂 __reactContainer$xxx 之类的内部属性。
  // 6 秒后一个都没有 = JS 没跑起来（或跑了一半），这是「没抛异常但页面还是死的」的唯一信号。
  window.setTimeout(function () {
    var el = document.getElementById('__next');
    var ok = false;
    try {
      for (var k in el) {
        if (k && k.indexOf('__react') === 0) { ok = true; break; }
      }
    } catch (e) { ok = false; }
    if (!ok) {
      send('boot', '水合未完成：6 秒后 React 仍未接管页面', { name: 'HydrationTimeout' });
    }
  }, 6000);
})();
`;

export default function Document() {
  return (
    <Html lang="zh-CN">
      <Head>
        {/* 地址栏 / 状态栏颜色，ThemeToggle 会同步更新 */}
        <meta name="theme-color" content={THEME_COLOR[THEME_DEFAULT]} />
        {/* 必须排在最前：要能抓到后续任何脚本的报错 */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_PROBE_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: ASSET_SELFHEAL_SCRIPT }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
