/**
 * 主题（日间 / 夜间）唯一入口。
 *
 * 机制：<html data-theme="light">，深色是默认态（不带属性）。
 * 样式侧只有 [data-theme='light'] 一块覆盖令牌，见 styles/tokens.css。
 *
 * 三个地方会用到：
 * 1. pages/_document.js 的首屏内联脚本 —— 在 hydration 之前把属性贴上，避免刷新闪一下深色
 * 2. components/ThemeToggle.js —— 用户手动切换
 * 3. 任何需要读当前主题的地方（如 <meta name="theme-color">）
 */

export const THEME_KEY = 'laroja-theme';
export const THEME_DARK = 'dark';
export const THEME_LIGHT = 'light';
/** 默认深色：社区本来就是按夜间使用场景设计的 */
export const THEME_DEFAULT = THEME_DARK;

/** 各主题对应的浏览器 UI 颜色（地址栏、状态栏） */
export const THEME_COLOR = {
  [THEME_DARK]: '#15171a',
  [THEME_LIGHT]: '#f5f6f8',
};

/**
 * 首屏引导脚本：必须内联在 <head>，早于任何渲染。
 * 线上 CSP 的 script-src 含 'unsafe-inline'（Next 自身也依赖它），可以执行。
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='${THEME_LIGHT}'){var d=document.documentElement;d.setAttribute('data-theme','${THEME_LIGHT}');d.style.colorScheme='${THEME_LIGHT}';}}catch(e){}})();`;

// 切换时临时加过渡类的定时器（模块级，避免连续点击堆叠）
let animTimer = null;

/** 读当前生效的主题（以 DOM 为准，避免 state 与 DOM 不同步） */
export function currentTheme() {
  if (typeof document === 'undefined') return THEME_DEFAULT;
  return document.documentElement.getAttribute('data-theme') === THEME_LIGHT
    ? THEME_LIGHT
    : THEME_DARK;
}

/** 应用主题：写 DOM + 记 localStorage + 同步地址栏颜色 */
export function applyTheme(theme) {
  if (typeof document === 'undefined') return THEME_DEFAULT;
  const next = theme === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
  const root = document.documentElement;

  // 只在「用户手动切换」时加过渡：首屏加载不加，否则会看到整页颜色渐变
  root.classList.add('theme-anim');
  clearTimeout(animTimer);
  animTimer = setTimeout(() => root.classList.remove('theme-anim'), 240);

  if (next === THEME_LIGHT) {
    root.setAttribute('data-theme', THEME_LIGHT);
    root.style.colorScheme = THEME_LIGHT;
  } else {
    // 深色是默认态，不挂属性，避免出现 [data-theme='dark'] 这个空壳
    root.removeAttribute('data-theme');
    root.style.colorScheme = THEME_DARK;
  }

  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* 隐私模式下 localStorage 可能不可写，主题仍在本次会话内生效 */
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[next]);

  return next;
}
