import OrderedChips from './OrderedChips';
import { POSITIONS } from '../lib/options.mjs';

/**
 * 擅长位置：多选 + 排序。
 * 未选的位置以「+ xxx」按钮呈现，点一下追加到末尾；已选的用 OrderedChips 调顺序。
 */
export default function PositionPicker({ value = [], onChange, options = POSITIONS, hint }) {
  const rest = options.filter((p) => !value.includes(p));

  return (
    <div className="pos-picker">
      <OrderedChips
        items={value}
        onChange={onChange}
        empty="还没选位置，点下面的按钮添加"
        label="擅长位置（按顺序）"
      />

      {rest.length > 0 && (
        <div className="pos-add">
          {rest.map((p) => (
            <button
              type="button"
              key={p}
              className="chip pos-add-btn"
              onClick={() => onChange([...value, p])}
            >
              + {p}
            </button>
          ))}
        </div>
      )}

      <div className="pos-hint">
        {hint || '可多选。第 1 位是主位置，群友卡片上会按这个顺序展示。'}
      </div>
    </div>
  );
}
