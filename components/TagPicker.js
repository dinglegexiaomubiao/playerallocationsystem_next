import { useState } from 'react';
import { SUGGESTED_TAGS, MAX_TAGS, TAG_LIMIT, normalizeTags } from '../lib/memories-tags.mjs';

/**
 * 标签选择器：发布和编辑文案两处共用，交互必须完全一样 ——
 * 同一件事在两个地方有两种点法，是最容易让人放弃使用的那类设计。
 *
 * 候选标签当开关用（点一下选中、再点取消），不做下拉菜单：只有 6 个，
 * 摆出来比藏起来快。想打别的再点「+ 自定义」。
 *
 * `draft` / `onDraftChange` 故意由父组件持有：用户在输入框里打了字但没回车
 * 就直接点「发布」时，父组件要能把这段没提交的文字一起带上，
 * 组件自己管 draft 就做不到（父组件读不到）。
 */
export default function TagPicker({ value = [], onChange, draft = '', onDraftChange, hideLabel = false }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  const tags = Array.isArray(value) ? value : [];
  const has = (t) => tags.some((x) => x.toLowerCase() === t.toLowerCase());

  const toggle = (t) => {
    if (has(t)) {
      setErr('');
      onChange(tags.filter((x) => x.toLowerCase() !== t.toLowerCase()));
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setErr(`最多 ${MAX_TAGS} 个标签`);
      return;
    }
    setErr('');
    onChange([...tags, t]);
  };

  /** 回车 / 逗号收下。重复或超长的会被 normalizeTags 吃掉，那就提示一句。 */
  const commit = () => {
    const raw = String(draft || '').trim();
    if (!raw) {
      setOpen(false);
      return;
    }
    const next = normalizeTags([...tags, ...raw.split(/[,，、\s]+/)]);
    if (next.length === tags.length) {
      setErr(tags.length >= MAX_TAGS ? `最多 ${MAX_TAGS} 个标签` : `每个标签最多 ${TAG_LIMIT} 个字`);
      onDraftChange('');
      return;
    }
    setErr('');
    onChange(next);
    onDraftChange('');
  };

  return (
    <div className="mem-tagrow">
      {!hideLabel && <span className="mem-taglabel">标签</span>}
      <div className="mem-tagpick">
        {tags.map((t) => (
          <button
            key={'on-' + t}
            type="button"
            className="chip active mem-tag"
            onClick={() => toggle(t)}
            title="点一下取消"
          >
            {t}
            <span className="mem-tag-x" aria-hidden="true">
              ×
            </span>
          </button>
        ))}
        {SUGGESTED_TAGS.filter((t) => !has(t)).map((t) => (
          <button key={'off-' + t} type="button" className="chip mem-tag" onClick={() => toggle(t)}>
            {t}
          </button>
        ))}
        {open ? (
          <input
            className="mem-tag-input"
            value={draft}
            maxLength={TAG_LIMIT}
            autoFocus
            placeholder="打一个，回车"
            onChange={(e) => onDraftChange(e.target.value)}
            onBlur={() => {
              if (!String(draft || '').trim()) setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') {
                onDraftChange('');
                setOpen(false);
              }
            }}
          />
        ) : (
          tags.length < MAX_TAGS && (
            <button
              type="button"
              className="chip mem-tag mem-tag-add"
              onClick={() => {
                setErr('');
                setOpen(true);
              }}
            >
              + 自定义
            </button>
          )
        )}
        {err && <span className="mem-tag-err">{err}</span>}
      </div>
    </div>
  );
}
