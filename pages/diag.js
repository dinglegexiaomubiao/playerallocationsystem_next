import Head from 'next/head';

/**
 * /diag —— 手机端「页面能打开但取不到数据」的现场诊断页。
 *
 * 为什么是这样一个页面：这类故障只出现在特定网络/特定设备上，服务端日志
 * 看不出来（请求可能压根没到，也可能到了但打了 404）。让用户手机打开这一页，
 * 它会自己把「HTML 是不是旧的、接口能不能通、静态资源能不能拿」逐条测一遍，
 * 并把结论直接写在屏幕上，截图就能定位。
 *
 * 两个容易踩的地方：
 * 1. 逻辑必须写在**内联脚本**里，不能依赖 React chunk。主站 JS 挂了的时候，
 *    这里也要照跑 —— 这正是它存在的意义。
 * 2. 结果**不能渲染进 React 管理的节点**。内联脚本先于 hydration 改 DOM，
 *    React 会报 #418/#423 并把它清掉（第一版就栽在这，页面永远停在
 *    「正在检测…」）。所以脚本自己创建一个容器挂到 body 末尾，
 *    落在 #__next 之外，React 完全不碰。
 */

const DIAG_SCRIPT = `
(function () {
  function boot() {
    var host = document.createElement('div');
    host.style.cssText = 'max-width:860px;margin:0 auto;padding:0 18px 44px;font-size:14px;line-height:1.7';
    host.innerHTML =
      '<div id="dg-state" style="margin:4px 0 14px;font-weight:600"></div>' +
      '<ol id="dg-list" style="list-style:none;padding:0;margin:0"></ol>' +
      '<pre id="dg-raw" style="margin:18px 0 0;font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-all;opacity:.6"></pre>';
    document.body.appendChild(host);

    var list = host.querySelector('#dg-list');
    var state = host.querySelector('#dg-state');
    var raw = host.querySelector('#dg-raw');
    var findings = [];
    var t0 = Date.now();

    function line(text, kind, detail) {
      var li = document.createElement('li');
      li.style.cssText = 'margin:7px 0;font-size:13px;line-height:1.65;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all';
      var badge = kind === 'ok' ? '\\u2705 ' : kind === 'bad' ? '\\u274c ' : '\\u23f3 ';
      li.textContent = badge + text + (detail ? '\\u3000' + detail : '');
      li.dataset.text = text;
      list.appendChild(li);
      return li;
    }
    function done(li, kind, detail) {
      li.textContent = (kind === 'ok' ? '\\u2705 ' : '\\u274c ') + li.dataset.text + (detail ? '\\u3000' + detail : '');
    }
    function note(text) { findings.push(text); }

    /* ---- 1. 环境 ---- */
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
    line('环境', 'ok',
      (c.effectiveType || '?') + ' / ' + (c.downlink || '?') + 'Mbps / ' +
      window.innerWidth + 'x' + window.innerHeight);
    line('浏览器', 'ok', navigator.userAgent.slice(0, 76));

    /* ---- 2/3. 小接口 + buildId 对比 ---- */
    var htmlBuild = (window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId) || '?';
    var liBuild = line('页面版本', 'wait', '待比对');
    var liSmall = line('小接口 /api/version', 'wait');
    var tSmall = Date.now();

    function compare(srvBuild, ok, ms) {
      if (!ok) {
        done(liBuild, 'bad', '无法比对（版本接口没通）');
      } else if (htmlBuild === 'development') {
        // 本地 npm run dev：HTML 里的 buildId 就是字符串 development，
        // 与 .next/BUILD_ID 必然不同，别据此误报「旧版页面」
        done(liBuild, 'ok', 'development（跳过比对）');
      } else if (srvBuild === htmlBuild) {
        done(liBuild, 'ok', htmlBuild);
      } else {
        done(liBuild, 'bad', '页面 ' + htmlBuild + ' / 服务器 ' + srvBuild);
        note('你手上是旧版页面（' + htmlBuild + '），服务器已经更新到 ' + srvBuild +
          '。旧页面引用的 JS 已被替换，所以只剩骨架、取不到数据。清缓存或点下面按钮重进就好。');
      }
      next();
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/version?ts=' + Date.now(), true);
    xhr.timeout = 15000;
    xhr.onload = function () {
      var ms = Date.now() - tSmall;
      var srv = '?';
      var ok = xhr.status === 200;
      try { srv = JSON.parse(xhr.responseText).buildId || '?'; } catch (e) { ok = false; }
      done(liSmall, ok ? 'ok' : 'bad', ok ? ms + 'ms' : 'HTTP ' + xhr.status);
      if (!ok) note('连 /api/version 都拿不到（HTTP ' + xhr.status + '），说明这个网络访问本站接口本身就有问题。');
      compare(srv, ok, ms);
    };
    xhr.onerror = function () {
      done(liSmall, 'bad', '请求失败（网络层）');
      note('接口请求在浏览器里直接失败。HTML 能打开但接口打不开，通常是 DNS 污染、运营商拦截或 HTTPS 被中间设备掐断。');
      compare('?', false, 0);
    };
    xhr.ontimeout = function () {
      done(liSmall, 'bad', '超时 15s');
      note('小接口都超时，链路质量很差。');
      compare('?', false, 0);
    };
    xhr.send();

    /* ---- 4. 大接口 ---- */
    function next() {
      var li = line('大接口 /api/players（约 200KB）', 'wait');
      var t = Date.now();
      var x = new XMLHttpRequest();
      x.open('GET', '/api/players?ts=' + Date.now(), true);
      x.timeout = 30000;
      x.onload = function () {
        var ms = Date.now() - t;
        var bytes = x.responseText ? x.responseText.length : 0;
        var ok = x.status === 200 && bytes > 1000;
        done(li, ok ? 'ok' : 'bad', 'HTTP ' + x.status + ' / ' + (bytes / 1024).toFixed(0) + 'KB / ' + ms + 'ms');
        if (!ok) {
          note('群友列表接口异常（HTTP ' + x.status + '，' + bytes + ' 字节）。页面上的数据就是从这里来的，它一挂就全空。');
        } else if (ms > 8000) {
          note('群友列表接口能通但慢到 ' + (ms / 1000).toFixed(1) + ' 秒，弱网下前端可能先超时了。');
        }
        asset();
      };
      x.onerror = function () {
        done(li, 'bad', '请求失败（网络层）');
        note('群友列表接口在浏览器里直接失败 —— 这就是「页面能开、数据全无」的直接原因。');
        asset();
      };
      x.ontimeout = function () {
        done(li, 'bad', '超时 30s');
        note('群友列表接口 30 秒没返回，数据当然出不来。');
        asset();
      };
      x.send();
    }

    /* ---- 5. 主站 JS 是否还能取到 ---- */
    function asset() {
      var scripts = document.querySelectorAll('script[src*="/_next/static/"]');
      if (!scripts.length) {
        line('主站 JS 引用', 'bad', '页面里一个都没有（HTML 被裁过）');
        note('页面里没有任何主站 JS 引用，React 不可能跑起来。');
        return wrap();
      }
      var src = scripts[0].getAttribute('src');
      var li = line('主站 JS 文件', 'wait');
      var t = Date.now();
      var x = new XMLHttpRequest();
      x.open('GET', src, true);
      x.timeout = 15000;
      x.onload = function () {
        var bytes = x.responseText ? x.responseText.length : 0;
        var ok = x.status === 200 && bytes > 0;
        done(li, ok ? 'ok' : 'bad', 'HTTP ' + x.status + ' / ' + bytes + ' 字节 / ' + (Date.now() - t) + 'ms');
        if (!ok) {
          note('页面引用的 JS 文件已经 404（HTTP ' + x.status + '）。React 起不来 → 页面只剩预渲染的骨架，一个数据请求都不会发出。旧版页面的典型表现。');
        }
        wrap();
      };
      x.onerror = function () { done(li, 'bad', '请求失败（网络层）'); wrap(); };
      x.ontimeout = function () { done(li, 'bad', '超时'); wrap(); };
      x.send();
    }

    /* ---- 6. 结论 ---- */
    function wrap() {
      var box = document.createElement('div');
      box.style.cssText = 'margin:20px 0 0;padding:14px 16px;border-radius:8px;background:rgba(127,127,127,.12)';
      if (findings.length === 0) {
        box.innerHTML = '<strong>结论：全部通过</strong><br>当前网络下本站接口是通的。' +
          '如果主站还是空白，多半是那一次加载被打断了，重新进一次即可。';
      } else {
        box.innerHTML = '<strong>结论：发现 ' + findings.length + ' 处问题</strong><br>' +
          findings.map(function (f, i) { return (i + 1) + '. ' + f; }).join('<br>');
      }
      state.appendChild(box);

      var btn = document.createElement('button');
      btn.textContent = '重新加载（绕过缓存）';
      btn.style.cssText = 'margin-top:16px;padding:11px 20px;border-radius:8px;border:1px solid rgba(127,127,127,.6);background:transparent;color:inherit;font-size:14px;cursor:pointer';
      btn.onclick = function () { location.replace(location.pathname + '?ts=' + Date.now()); };
      state.appendChild(btn);

      raw.textContent = 'htmlBuild=' + htmlBuild + '\\nua=' + navigator.userAgent + '\\ntotal=' + (Date.now() - t0) + 'ms';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`;

export default function DiagPage() {
  return (
    <>
      <Head>
        <title>网络诊断 · 深圳LaRoja Dota2社区</title>
        <meta name="robots" content="noindex" />
      </Head>
      <section className="page-hero">
        <div className="wrap" style={{ paddingTop: 28, paddingBottom: 8 }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>网络诊断</h1>
          <p style={{ fontSize: 14, opacity: 0.75, margin: 0, lineHeight: 1.75, maxWidth: 620 }}>
            这一页会自己测一遍「能不能拿到本站的数据」，大约 5 秒。
            如果打开主站看不到群友信息，把下面的结论截图发给 dom 就能定位原因。
          </p>
        </div>
      </section>
      <script dangerouslySetInnerHTML={{ __html: DIAG_SCRIPT }} />
    </>
  );
}
