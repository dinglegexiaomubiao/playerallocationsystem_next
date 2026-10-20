import { useEffect } from 'react';
import { useRouter } from 'next/router';
import '../styles/globals.css';
import '../styles/main/index.css';
import '../styles/layout.css';
// 深色外壳与各页样式，必须排在 layout.css 之后才能覆盖旧外观
import '../styles/shell.css';
import '../styles/home.css';
import '../styles/tournament-dark.css';
import Layout from '../components/Layout';
import FeedbackWidget from '../components/FeedbackWidget';
import { installErrorReporting } from '../lib/support-client.mjs';

function MyApp({ Component, pageProps }) {
  const router = useRouter();

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
      <Component {...pageProps} />
      {/* 反馈浮窗挂在 Layout 外层：登录页不套 Layout，但也得能反馈 */}
      <FeedbackWidget />
    </Layout>
  );
}

export default MyApp;
