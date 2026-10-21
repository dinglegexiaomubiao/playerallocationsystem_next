import { useEffect, useState } from 'react';
import { applyTheme, currentTheme, THEME_DARK, THEME_LIGHT } from '../lib/theme';

/**
 * 日间 / 夜间切换按钮。
 *
 * 放在导航右上角（.nav-right 的第一个元素），窄屏抽屉里也复用一份。
 * 图标显示的是**当前**状态：月亮=夜间，太阳=日间。
 *
 * 为什么 state 要等 useEffect 才初始化：服务端渲染时读不到 localStorage，
 * 直接渲染会与首屏内联脚本贴上的主题不一致，触发 hydration 警告。
 * 所以先渲染占位（同尺寸，无跳动），挂载后再对齐真实主题。
 */
export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  const toggle = () => {
    const next = theme === THEME_LIGHT ? THEME_DARK : THEME_LIGHT;
    setTheme(applyTheme(next));
  };

  const isLight = theme === THEME_LIGHT;
  // aria-label 写「点击后会变成什么」，因为读屏是按操作语义播报的；
  // 可见文案写「当前是什么」，与图标（太阳=日间 / 月亮=夜间）保持一致。
  const label = isLight ? '切换到夜间模式' : '切换到日间模式';
  const shortLabel = isLight ? '日间模式' : '夜间模式';

  return (
    <button
      type="button"
      className={'theme-toggle' + (isLight ? ' is-light' : '') + (className ? ' ' + className : '')}
      onClick={toggle}
      title={label}
      aria-label={label}
      // 主题未就绪前不可点，避免把用户的选择覆盖成默认值
      disabled={theme === null}
    >
      {isLight ? (
        // 太阳：亮核 + 八道光芒
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M10 1.4v2.2M10 16.4v2.2M1.4 10h2.2M16.4 10h2.2" />
            <path d="M3.9 3.9l1.6 1.6M14.5 14.5l1.6 1.6M16.1 3.9l-1.6 1.6M5.5 14.5l-1.6 1.6" />
          </g>
        </svg>
      ) : (
        // 月亮：实心月牙，靠一个偏移的挖空圆做出缺口
        <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" focusable="false">
          <path
            d="M16.3 12.4a6.9 6.9 0 1 1-8.7-8.7 5.6 5.6 0 0 0 8.7 8.7z"
            fill="currentColor"
          />
        </svg>
      )}
      <span className="theme-toggle-label">{shortLabel}</span>
    </button>
  );
}
