import { Html, Head, Main, NextScript } from 'next/document';
import { THEME_BOOT_SCRIPT, THEME_COLOR, THEME_DEFAULT } from '../lib/theme';

/**
 * 自定义 Document：只为两件事存在
 * 1. lang="zh-CN"（默认是 en，影响读屏与字体回退）
 * 2. 首屏内联主题脚本 —— 必须早于任何渲染，否则浅色用户每次刷新
 *    都会先看到一帧深色再跳成浅色
 */
export default function Document() {
  return (
    <Html lang="zh-CN">
      <Head>
        {/* 地址栏 / 状态栏颜色，ThemeToggle 会同步更新 */}
        <meta name="theme-color" content={THEME_COLOR[THEME_DEFAULT]} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
