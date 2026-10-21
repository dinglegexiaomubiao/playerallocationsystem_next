import { useMemo } from 'react';

/**
 * 「一或多」身份列表编辑器（SteamID / 群昵称共用）。
 *
 * 一个群友可能有多个 Steam 号（小号、换号），群昵称也可能有好几个（改过群名片）。
 * 这里做成「一行一个 + 单选主号」：主号决定头像、战绩、卡片上显示哪一个。
 *
 * 约束由后端兜底（一个 SteamID 只能归一个人；自助场景主号不能删空），
 * 前端只做即时的空值和数字格式提示，避免用户填完才被拒。
 */
export default function IdentityEditor({
  items = [],
  onChange,
  kind = 'steam', // 'steam' | 'nickname'
  hint = '',
  addLabel = '',
}) {
  const isSteam = kind === 'steam';

  const rows = useMemo(
    () => items.map((it) => ({ value: String(it.value ?? ''), isPrimary: !!it.isPrimary })),
    [items]
  );

  const emit = (next) => {
    // 保证「有内容时恰好一个主号」：全都没标就默认第一个
    if (next.length > 0 && !next.some((r) => r.isPrimary)) next[0].isPrimary = true;
    onChange(next);
  };

  const setAt = (i, patch) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    emit(next);
  };

  const setPrimary = (i) => emit(rows.map((r, idx) => ({ ...r, isPrimary: idx === i })));

  const remove = (i) => {
    const next = rows.filter((_, idx) => idx !== i);
    if (next.length > 0 && !next.some((r) => r.isPrimary)) next[0].isPrimary = true;
    onChange(next);
  };

  const add = () => emit([...rows, { value: '', isPrimary: rows.length === 0 }]);

  const badFormat = (v) => isSteam && v.trim() !== '' && !/^\d+$/.test(v.trim());

  return (
    <div className="id-editor">
      {rows.length === 0 && (
        <p className="id-empty">{isSteam ? '还没有登记 SteamID' : '还没有登记群昵称'}</p>
      )}

      {rows.map((row, i) => (
        <div className={row.isPrimary ? 'id-row id-row-main' : 'id-row'} key={i}>
          <label className="id-primary" title="主号决定头像、战绩和卡片上显示哪一个">
            <input type="radio" name={'id-primary-' + kind} checked={row.isPrimary} onChange={() => setPrimary(i)} />
            主
          </label>
          <input
            className="id-input"
            value={row.value}
            inputMode={isSteam ? 'numeric' : 'text'}
            placeholder={isSteam ? 'Steam 数字好友码' : '微信群昵称'}
            onChange={(e) => setAt(i, { value: e.target.value })}
          />
          <button type="button" className="id-del" onClick={() => remove(i)} title="删除这一条">
            ×
          </button>
          {badFormat(row.value) && <span className="id-warn">只能是数字</span>}
        </div>
      ))}

      <button type="button" className="id-add" onClick={add}>
        ＋ {addLabel || (isSteam ? '添加 SteamID' : '添加群昵称')}
      </button>

      {hint && <p className="id-hint">{hint}</p>}
    </div>
  );
}
