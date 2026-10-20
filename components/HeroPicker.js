import { useEffect, useMemo, useRef, useState } from 'react';
import heroesList from '../lib/heroesData';
import { HERO_ATTRS, heroAliases, heroAttr, filterHeroes } from '../lib/hero-filters.mjs';
import HeroAvatar from './HeroAvatar';

/**
 * 擅长英雄选择弹窗。
 *
 * 和分配工具里的英雄弹窗同一套交互（搜索 + 网格多选），额外加了属性筛选，
 * 因为 126 个英雄纯靠搜名字找起来太慢。选中顺序会被保留 —— 群友卡片上
 * 只展示英雄列表的前 4 个，顺序是有意义的。
 */
export default function HeroPicker({ open, value = [], onClose, onConfirm }) {
  const [keyword, setKeyword] = useState('');
  const [attr, setAttr] = useState('all');
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  // 每次打开都以外部值为准，避免上次取消的残留
  useEffect(() => {
    if (!open) return;
    setDraft(value || []);
    setKeyword('');
    setAttr('all');
    const t = setTimeout(() => inputRef.current && inputRef.current.focus(), 60);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const list = useMemo(() => filterHeroes(heroesList, { attr, keyword }), [attr, keyword]);

  if (!open) return null;

  const toggle = (name) => {
    setDraft((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  return (
    <div className="modal-mask" onClick={onClose} role="dialog" aria-modal="true" aria-label="选择擅长英雄">
      <div className="modal-card hero-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            选择擅长英雄
            <span className="hero-modal-count">
              已选 <b>{draft.length}</b>
            </span>
          </h3>
          <button type="button" className="modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="hero-modal-bar">
          <div className="filter-search hero-modal-search">
            <input
              ref={inputRef}
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索英雄名或别称"
              className={keyword ? 'is-active' : ''}
            />
            {keyword && (
              <button
                type="button"
                className="filter-search-clear"
                aria-label="清空搜索"
                onClick={() => setKeyword('')}
              >
                ×
              </button>
            )}
          </div>
          <div className="chips hero-modal-attrs">
            <button
              type="button"
              className={'chip' + (attr === 'all' ? ' active' : '')}
              onClick={() => setAttr('all')}
            >
              全部
            </button>
            {HERO_ATTRS.map((a) => (
              <button
                type="button"
                key={a.key}
                className={'chip' + (attr === a.key ? ' active' : '')}
                onClick={() => setAttr(a.key)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <div className="hero-modal-body">
          <div className="hero-picker-grid">
            {list.map((h) => {
              const idx = draft.indexOf(h.name);
              const selected = idx >= 0;
              const alias = heroAliases(h).join(' · ');
              return (
                <button
                  type="button"
                  key={h.id + '-' + h.name}
                  className={'hero-cell' + (selected ? ' selected' : '')}
                  data-attr={heroAttr(h) || 'none'}
                  onClick={() => toggle(h.name)}
                  title={alias ? h.name + '（' + alias + '）' : h.name}
                >
                  {/* 弹窗里用 eager：126 张图配合磁盘缓存 1s 内就能全部就绪，
                      用 lazy 反而会出现「打开弹窗一片空白、滚动才陆续出图」的观感 */}
                  <HeroAvatar name={h.name} className="hero-cell-avatar" eager />
                  <span className="hero-cell-text">
                    <span className="hero-cell-name">{h.name}</span>
                    <span className="hero-cell-alias">{alias || '—'}</span>
                  </span>
                  {selected && <span className="hero-cell-order">{idx + 1}</span>}
                </button>
              );
            })}
            {list.length === 0 && (
              <div className="hero-empty">
                没有匹配的英雄
                {keyword ? `：换个关键字试试（当前「${keyword}」）` : ''}
              </div>
            )}
          </div>
        </div>

        <div className="hero-modal-foot">
          <div className="hero-picked">
            {draft.length === 0 ? (
              <span className="hero-picked-empty">还没选英雄</span>
            ) : (
              <>
                {draft.map((name, i) => (
                  <span className="hero-picked-chip" key={name}>
                    <b>{i + 1}</b>
                    <HeroAvatar name={name} className="hero-picked-avatar" />
                    {name}
                    <button
                      type="button"
                      className="hero-picked-del"
                      aria-label={`移除 ${name}`}
                      onClick={() => toggle(name)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button type="button" className="hero-clear" onClick={() => setDraft([])}>
                  清空
                </button>
              </>
            )}
          </div>
          <div className="hero-modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onConfirm && onConfirm(draft)}
            >
              确定（{draft.length}）
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
