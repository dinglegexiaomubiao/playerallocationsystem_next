import { useEffect, useRef, useState } from 'react';

/**
 * 多选筛选下拉。
 *
 * 为什么不直接平铺 chip：擅长英雄的选项能到几十上百个（英雄池），
 * 平铺会把工具栏撑成一面墙。所以用「一个按钮 + 展开面板」，
 * 面板内部滚动，选中项在按钮上汇总显示。
 *
 * 语义：**同组内 OR** —— 选了「中单、劣单」= 会打其中任意一个的人都算。
 *
 * @param {string}   label        字段名（位置 / 擅长英雄）
 * @param {Array}    options      [{ value, count }]
 * @param {string[]} value        已选值
 * @param {function} onChange     收到新的 string[]
 * @param {string}   allLabel     空选择时的按钮文案
 * @param {string}   unit         面板底部计数单位，如「位群友」
 */
export default function MultiSelectFilter({
  label,
  options = [],
  value = [],
  onChange,
  allLabel = '全部',
  unit = '人',
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  /* 点击外部 / Esc 关闭 —— 面板是绝对定位的，不关会一直挂在页面上 */
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (v) =>
    value.includes(v) ? onChange(value.filter((x) => x !== v)) : onChange([...value, v]);

  const summary =
    value.length === 0
      ? allLabel
      : value.length === 1
        ? value[0]
        : `${value[0]} 等 ${value.length} 项`;

  return (
    <div className="msf" ref={boxRef}>
      <button
        type="button"
        className={`msf-btn ${value.length > 0 ? 'is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value.length > 0 ? value.join(' / ') : allLabel}
      >
        <span className="msf-summary">{summary}</span>
        <span className="msf-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="msf-panel" role="listbox" aria-label={label} aria-multiselectable="true">
          <div className="msf-panel-head">
            <span>{label}</span>
            {value.length > 0 && (
              <button type="button" className="msf-reset" onClick={() => onChange([])}>
                清空
              </button>
            )}
          </div>

          <div className="msf-list">
            <button
              type="button"
              className={`msf-opt ${value.length === 0 ? 'is-on' : ''}`}
              onClick={() => onChange([])}
            >
              <span className="msf-box" aria-hidden="true">
                {value.length === 0 ? '✓' : ''}
              </span>
              <span className="msf-opt-text">全部</span>
            </button>

            {options.map((o) => {
              const on = value.includes(o.value);
              return (
                <button
                  type="button"
                  key={o.value}
                  className={`msf-opt ${on ? 'is-on' : ''}`}
                  onClick={() => toggle(o.value)}
                  aria-selected={on}
                >
                  <span className="msf-box" aria-hidden="true">
                    {on ? '✓' : ''}
                  </span>
                  <span className="msf-opt-text">{o.value}</span>
                  {typeof o.count === 'number' && <span className="msf-opt-n">{o.count}</span>}
                </button>
              );
            })}
          </div>

          <div className="msf-panel-foot">
            {value.length === 0 ? `共 ${options.length} 项可选` : `已选 ${value.length} 项`}
          </div>
        </div>
      )}
    </div>
  );
}
