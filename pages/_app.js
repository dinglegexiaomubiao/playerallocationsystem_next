import { useEffect } from 'react';
import '../styles/globals.css';
import '../styles/main/index.css';
import '../styles/layout.css';
import Layout from '../components/Layout';
import FeedbackWidget from '../components/FeedbackWidget';
import { installErrorReporting } from '../lib/support-client.mjs';

function MyApp({ Component, pageProps }) {
  // 全局异常采集（加载失败 / 超时 / JS 报错 / 一直转圈），只装一次
  useEffect(() => {
    installErrorReporting();
  }, []);

  return (
    <Layout>
      <Component {...pageProps} />
      {/* 反馈浮窗挂在 Layout 外层：登录页不套 Layout，但也得能反馈 */}
      <FeedbackWidget />
    </Layout>
  );
}

export default MyApp;
