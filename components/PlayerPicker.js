import { useState, useEffect, useRef } from 'react';

// 可搜索选择器：用于「默契队友」「仇人」，输入昵称/steamid 模糊搜索，选中成标签
export default function PlayerPicker({ label, hint, value, onChange, placeholder }) {
  const [kw, setKw] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!kw.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch('/api/players/search?q=' + encodeURIComponent(kw.trim()));
        const d = await r.json();
        if (alive) setResults(d.players || []);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [kw]);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const add = (p) => {
    if (!value.some((x) => String(x.id) === String(p.id))) {
      onChange([...value, { id: String(p.id), nickname: p.nickname || p.group_nickname || p.game_id }]);
    }
    setKw('');
    setOpen(false);
  };

  const remove = (id) => {
    onChange(value.filter((x) => String(x.id) !== String(id)));
  };

  return (
    <div className="picker" ref={boxRef}>
      <div className="picker-label">
        {label}
        {hint && <span className="picker-hint">{hint}</span>}
      </div>
      <div className="picker-tags">
        {value.map((x) => (
          <span className="picker-tag" key={x.id}>
            {x.nickname}
            <button type="button" className="picker-remove" onClick={() => remove(x.id)} aria-label="移除">
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="picker-input"
          value={kw}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => {
            setKw(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && kw.trim() && (
        <div className="picker-dropdown">
          {loading && <div className="picker-empty">搜索中…</div>}
          {!loading && results.length === 0 && <div className="picker-empty">无匹配选手</div>}
          {!loading &&
            results.map((p) => (
              <button type="button" key={p.id} className="picker-option" onClick={() => add(p)}>
                <span className="picker-option-name">{p.nickname}</span>
                <span className="picker-option-sub">
                  {p.group_nickname && p.group_nickname !== p.nickname ? p.group_nickname + ' · ' : ''}
                  steamID {p.game_id}
                  {p.score ? ' · ' + p.score + ' 分' : ''}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
