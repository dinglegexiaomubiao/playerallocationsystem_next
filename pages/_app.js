import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
// 设计令牌必须最先加载：其余样式表都引用这里的 CSS 变量
import '../styles/tokens.css';
import '../styles/globals.css';
import '../styles/main/index.css';
import '../styles/layout.css';
// 深色外壳与各页样式，必须排在 layout.css 之后才能覆盖旧外观
import '../styles/shell.css';
import '../styles/home.css';
import '../styles/tournament-dark.css';
// 群友回忆：新增页自己的样式层，只作用于 .mem-* 命名空间
import '../styles/memories.css';
// 后台自己的样式层，放最后：它只作用于 .adm-* 命名空间，但需要压过上面的通用规则
import '../styles/admin.css';
import Layout from '../components/Layout';
import FeedbackWidget from '../components/FeedbackWidget';
import QuoteTicker from '../components/QuoteTicker';
import ForcePasswordChange from '../components/ForcePasswordChange';
import { installErrorReporting } from '../lib/support-client.mjs';

function MyApp({ Component, pageProps }) {
  const router = useRouter();

  // 服务端已经记过这次访问（getServerSideProps 里的服务端埋点）时，客户端这条要跳过，
  // 否则同一次访问会被算两遍。用 ref 而非 state：render 阶段就写好，下面的 effect 立刻读得到。
  const serverTrackedPath = useRef(null);
  if (pageProps && pageProps.__pageViewTracked) serverTrackedPath.current = router.pathname;

  // 全局异常采集（加载失败 / 超时 / JS 报错 / 一直转圈），只装一次
  useEffect(() => {
    installErrorReporting();
  }, []);

  // 访问埋点：每次路由切换上报一次路径。
  // 用 sendBeacon 是为了在用户快速跳走、页面卸载时也能把数据发出去；
  // 不支持时退化成 keepalive fetch。整段包在 try 里，埋点永远不打扰用户。
  useEffect(() => {
    const report = (url) => {
      if (!url || typeof url !== 'string') return;
      // 命中服务端已记的那一次就抵掉，之后的跳转照常上报
      if (serverTrackedPath.current === url) {
        serverTrackedPath.current = null;
        return;
      }
      try {
        const payload = JSON.stringify({ path: url });
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon('/api/track', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch('/api/track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        /* 埋点失败静默处理 */
      }
    };

    report(router.pathname);
    router.events.on('routeChangeComplete', report);
    return () => router.events.off('routeChangeComplete', report);
  }, [router]);

  return (
    <Layout>
      {/* 被重置过密码的人，去任何页面都会被推回改密页 */}
      <ForcePasswordChange />
      <Component {...pageProps} />
      {/* 反馈浮窗挂在 Layout 外层：登录页不套 Layout，但也得能反馈 */}
      <FeedbackWidget />
      {/* 底部语录栏：自己判断该不该出现（登录页 / 后台 / 语录页都不显示） */}
      <QuoteTicker />
    </Layout>
  );
}

export default MyApp;
