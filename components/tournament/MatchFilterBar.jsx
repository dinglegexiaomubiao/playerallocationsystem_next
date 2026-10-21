/**
 * 赛程与对阵的筛选栏。
 *
 * 这一层是「赛事内部」的筛选，和赛事列表页的筛选不是一回事：
 *   列表页筛的是「哪一届」，这里筛的是「这一届里的哪几局」。
 *
 * 三个维度互不干扰（AND）：
 *   轮次（多选）· 队伍（单选）· 是否只看有完整逐人数据的局
 * 「有数据」的判定用逐人 KDA 是否为空 —— 回放过期解析不回来的局，
 * 十个人的 kills 全是 null，这种局在列表里只是噪声。
 */
export default function MatchFilterBar({
  rounds = [],
  teams = [],
  value,
  onChange,
  total = 0,
  unparsed = 0,
}) {
  const { rounds: selRounds = [], team = '', onlyParsed = false } = value || {};
  const active = selRounds.length + (team ? 1 : 0) + (onlyParsed ? 1 : 0);

  const toggleRound = (id) => {
    const key = String(id);
    const next = selRounds.includes(key)
      ? selRounds.filter((x) => x !== key)
      : [...selRounds, key];
    onChange({ ...value, rounds: next });
  };

  return (
    <div className="t-toolbar t-mfilter">
      <div className="t-mfilter-meta">
        <span className="t-mfilter-k">轮次</span>
        {rounds.map((r) => {
          const on = selRounds.includes(String(r.id));
          return (
            <button
              type="button"
              key={r.id || 'ungrouped'}
              className={`t-mchip ${on ? 'is-on' : ''}`}
              aria-pressed={on}
              onClick={() => toggleRound(r.id)}
            >
              {r.name}
              {typeof r.count === 'number' && <i>{r.count}</i>}
            </button>
          );
        })}
      </div>

      <select
        className="t-select"
        value={team}
        onChange={(e) => onChange({ ...value, team: e.target.value })}
        aria-label="按队伍筛选"
      >
        <option value="">全部队伍</option>
        {teams.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={`t-mchip ${onlyParsed ? 'is-on' : ''}`}
        aria-pressed={onlyParsed}
        title="隐藏回放过期、拿不到逐人数据的局"
        onClick={() => onChange({ ...value, onlyParsed: !onlyParsed })}
      >
        仅完整数据
        {unparsed > 0 && <i>{unparsed} 局缺失</i>}
      </button>

      <span className="t-mfilter-sum">
        {total} 局
        {active > 0 && (
          <button
            type="button"
            className="t-mfilter-clear"
            onClick={() => onChange({ rounds: [], team: '', onlyParsed: false })}
          >
            清除
          </button>
        )}
      </span>
    </div>
  );
}
