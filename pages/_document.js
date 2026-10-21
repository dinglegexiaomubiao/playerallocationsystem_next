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

export default function Document() {
  return (
    <Html lang="zh-CN">
      <Head>
        {/* 地址栏 / 状态栏颜色，ThemeToggle 会同步更新 */}
        <meta name="theme-color" content={THEME_COLOR[THEME_DEFAULT]} />
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
