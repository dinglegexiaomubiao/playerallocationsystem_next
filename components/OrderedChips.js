/**
 * 有序标签组：每一项带序号，支持「前移 / 后移 / 移除」。
 *
 * 为什么需要排序：群的选手卡片上位置和英雄都只展示前几个
 * （英雄是 slice(0, 4)），数组顺序直接决定谁排在最前面，
 * 所以「擅长位置」「擅长英雄」都必须让用户自己调顺序。
 */
export default function OrderedChips({ items = [], onChange, empty = '还没有选择', label = '' }) {
  const move = (from, dir) => {
    const to = from + dir;
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const tmp = next[from];
    next[from] = next[to];
    next[to] = tmp;
    onChange(next);
  };

  const remove = (index) => onChange(items.filter((_, i) => i !== index));

  if (!items.length) {
    return <span className="ord-empty">{empty}</span>;
  }

  return (
    <div className="ord-chips" role="list" aria-label={label || '已选'}>
      {items.map((item, i) => (
        <span className="ord-chip" role="listitem" key={item}>
          <b className="ord-no" aria-hidden="true">
            {i + 1}
          </b>
          <span className="ord-text">{item}</span>
          <span className="ord-btns">
            <button
              type="button"
              className="ord-btn"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              title="前移"
              aria-label={`${item} 前移`}
            >
              ‹
            </button>
            <button
              type="button"
              className="ord-btn"
              onClick={() => move(i, 1)}
              disabled={i === items.length - 1}
              title="后移"
              aria-label={`${item} 后移`}
            >
              ›
            </button>
            <button
              type="button"
              className="ord-btn ord-del"
              onClick={() => remove(i)}
              title="移除"
              aria-label={`移除 ${item}`}
            >
              ×
            </button>
          </span>
        </span>
      ))}
    </div>
  );
}
