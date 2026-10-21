import { useMemo } from 'react';

/**
 * 赛事列表筛选栏。
 *
 * 两组筛选是正交的：**同组内多选 = OR，跨组 = AND**。
 *   例如「进行中 + 我进队的」= 我参赛中；
 *        「进行中 + 我报名的」= 报名了但还没分组。
 * 所以不额外造「报名中/参赛中」字段，用组合表达，再给快捷按钮一键选好。
 *
 * @param {object}   props
 * @param {object}   props.value     { status: string[], rel: string[], q: string }
 * @param {function} props.onChange  收到新 value
 * @param {object}   props.counts     { status: {planning, live, finished}, rel: {...} } 用于 chip 后的数字
 * @param {number}   props.total     筛出条数
 * @param {boolean}  props.showRel   是否显示「我的」这组（未登录 / 我的赛事 Tab 里不需要）
 */
const STATUS_OPTIONS = [
  { key: 'planning', label: '筹备中' },
  { key: 'live', label: '进行中' },
  { key: 'finished', label: '已结束' },
];

const REL_OPTIONS = [
  { key: 'signed', label: '我报名的', hint: '本届报名名单里有我' },
  { key: 'joined', label: '我进队的', hint: '已被分到某支队伍' },
  { key: 'captain', label: '我当队长', hint: '我是队伍队长' },
  { key: 'placed', label: '有名次', hint: '我的队伍拿到前三' },
];

const toggle = (arr, key) =>
  arr.includes(key) ? arr.filter((x) => x !== key) : [...arr, key];

export default function TournamentFilterBar({
  value,
  onChange,
  counts = {},
  total = 0,
  showRel = false,
  hiddenByDate = 0,
}) {
  const { status = [], rel = [], q = '' } = value || {};

  const activeCount = status.length + rel.length + (q ? 1 : 0);

  /* 快捷预设：点一下就把两组都设好，再点一下还原。
     判定标准是「当前是否正好等于这个组合」，这样按钮的亮灭与 chip 永远一致。 */
  const presets = useMemo(
    () => [
      {
        key: 'playing',
        label: '我参赛中',
        status: ['live'],
        rel: ['joined'],
        hint: '进行中 + 我已进队',
      },
      {
        key: 'signing',
        label: '报名中',
        status: ['live'],
        rel: ['signed'],
        hint: '进行中 + 我已报名（可能还没分组）',
      },
    ],
    []
  );

  const isPresetActive = (p) =>
    status.length === p.status.length &&
    rel.length === p.rel.length &&
    p.status.every((x) => status.includes(x)) &&
    p.rel.every((x) => rel.includes(x));

  const applyPreset = (p) => {
    if (isPresetActive(p)) {
      onChange({ status: [], rel: [], q });
    } else {
      onChange({ status: [...p.status], rel: [...p.rel], q });
    }
  };

  const reset = () => onChange({ status: [], rel: [], q: '' });

  /* 计数与清除抽出来复用：没有「我的」这组时（我的赛事 Tab），
     它应该落在第一行末尾，否则第二行只剩一句话，看着像断了。 */
  const summaryNode = (
    <span className="tf-summary">
      已筛出 <b>{total}</b> 届
      {activeCount > 0 && (
        <button type="button" className="tf-clear" onClick={reset}>
          清除筛选
        </button>
      )}
    </span>
  );

  return (
    <div className="tf-bar">
      <div className="tf-row">
        <input
          className="tf-search"
          type="search"
          placeholder="搜索赛事名，如「第十届」"
          value={q}
          onChange={(e) => onChange({ ...value, q: e.target.value })}
          aria-label="搜索赛事"
        />

        <div className="tf-group" role="group" aria-label="赛事状态">
          <span className="tf-group-label">状态</span>
          {STATUS_OPTIONS.map((o) => {
            const on = status.includes(o.key);
            const n = counts.status ? counts.status[o.key] : undefined;
            return (
              <button
                type="button"
                key={o.key}
                className={`tf-chip ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                onClick={() => onChange({ ...value, status: toggle(status, o.key) })}
              >
                {o.label}
                {typeof n === 'number' && <i className="tf-chip-n">{n}</i>}
              </button>
            );
          })}
        </div>

        {showRel && (
          <div className="tf-group" role="group" aria-label="我与赛事的关系">
            <span className="tf-group-label">我的</span>
            {REL_OPTIONS.map((o) => {
              const on = rel.includes(o.key);
              const n = counts.rel ? counts.rel[o.key] : undefined;
              return (
                <button
                  type="button"
                  key={o.key}
                  className={`tf-chip ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  title={o.hint}
                  onClick={() => onChange({ ...value, rel: toggle(rel, o.key) })}
                >
                  {o.label}
                  {typeof n === 'number' && <i className="tf-chip-n">{n}</i>}
                </button>
              );
            })}
          </div>
        )}

        {!showRel && summaryNode}
      </div>

      {showRel && (
        <div className="tf-row tf-row-sub">
          <div className="tf-group">
            <span className="tf-group-label">预设</span>
            {presets.map((p) => (
              <button
                type="button"
                key={p.key}
                className={`tf-chip tf-chip-preset ${isPresetActive(p) ? 'is-on' : ''}`}
                title={p.hint}
                aria-pressed={isPresetActive(p)}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {summaryNode}
        </div>
      )}

      {hiddenByDate > 0 && (
        <span className="tf-warn">
          另有 {hiddenByDate} 届缺少起止时间，按状态筛选时可能被漏掉
        </span>
      )}
    </div>
  );
}
