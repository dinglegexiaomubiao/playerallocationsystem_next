import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { LIMITS } from '../lib/moderation.mjs';

const QUOTE_LIMIT = LIMITS.quote;

/**
 * 收录一条语录。
 *
 * 出处是两段式而不是一个输入框：语录本质是引用，手写名字最容易出问题
 * （要么写错字，要么直接冒名）。默认落在「选群友」，只有明确切到「自己写」
 * 才能填泛称，而且服务端还会再拦一次重名。
 *
 * 日期用原生 date input：点开就是日历面板，手机上会调系统日期选择器。
 * max 卡在今天 —— 填未来日期没有意义，服务端也挡。
 */

const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export default function QuoteForm({ onCreated, onClose }) {
  const [mode, setMode] = useState('player'); // player | text
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null); // { playerId, nickname, avatar }
  const [sourceText, setSourceText] = useState('');
  const [saidAt, setSaidAt] = useState(todayStr);
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef(null);

  // 搜索防抖：每敲一个字就请求一次会把 /api/players/search 打满
  useEffect(() => {
    if (mode !== 'player' || picked) return;
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch('/api/players/search?q=' + encodeURIComponent(term), {
          cache: 'no-store',
        });
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        setResults((d.players || []).slice(0, 8));
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, mode, picked]);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNotice('');
    if (next === 'text') setPicked(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!content.trim()) return setError('先写一句吧');
    if (mode === 'player' && !picked) return setError('选一位群友，或者切到「自己写」');
    if (mode === 'text' && !sourceText.trim()) return setError('这句是谁说的？写一下出处');

    setBusy(true);
    try {
      const r = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          saidAt,
          sourcePlayerId: mode === 'player' && picked ? picked.playerId : '',
          sourceText: mode === 'text' ? sourceText : '',
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setError(d.error || `提交失败（HTTP ${r.status}）`);
        return;
      }
      if (d.duplicate) {
        // 不算失败：把已有那条翻到眼前比报个错有用
        setNotice('这句已经有人收过了，给你翻到那一条');
        if (onCreated) onCreated(null, d.id);
        return;
      }
      setContent('');
      setQ('');
      setPicked(null);
      setSourceText('');
      if (onCreated) onCreated(d.quote);
    } catch (err) {
      setError((err && err.message) || '网络异常，再点一次试试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="quote-form" onSubmit={submit}>
      <div className="quote-form-head">
        <h2>收一句</h2>
        <button type="button" className="quote-form-x" onClick={onClose} aria-label="收起">
          ×
        </button>
      </div>

      <div className="quote-modes" role="tablist" aria-label="出处方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'player'}
          className={'quote-mode' + (mode === 'player' ? ' is-on' : '')}
          onClick={() => switchMode('player')}
        >
          选群友
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'text'}
          className={'quote-mode' + (mode === 'text' ? ' is-on' : '')}
          onClick={() => switchMode('text')}
        >
          自己写
        </button>
      </div>

      {mode === 'player' ? (
        <div className="form-field">
          <label htmlFor="quote-who">谁说的</label>
          {picked ? (
            <div className="quote-picked">
              <Avatar className="quote-picked-avatar" src={picked.avatar} name={picked.nickname} />
              <span>{picked.nickname}</span>
              <button
                type="button"
                className="quote-picked-x"
                onClick={() => {
                  setPicked(null);
                  setQ('');
                  setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
                }}
              >
                换一个
              </button>
            </div>
          ) : (
            <>
              <input
                id="quote-who"
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜昵称，比如「無相」"
                autoComplete="off"
              />
              {searching && <span className="field-note">翻名单…</span>}
              {!searching && q.trim() && results.length === 0 && (
                <span className="field-note">
                  没找到这个人。也可能是刚进群还没录档案 —— 切到「自己写」填个泛称也行。
                </span>
              )}
              {results.length > 0 && (
                <ul className="quote-results">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setPicked({ playerId: p.id, nickname: p.nickname, avatar: p.avatar })
                        }
                      >
                        <Avatar className="quote-result-avatar" src={p.avatar} name={p.nickname} />
                        <span className="quote-result-name">{p.nickname}</span>
                        {p.game_id && <span className="quote-result-id">{p.game_id}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="form-field">
          <label htmlFor="quote-text-who">
            谁说的 <span className="field-note">（写「游戏内路人」「群里某人」这种，别写群友名字）</span>
          </label>
          <input
            id="quote-text-who"
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="游戏内路人"
            maxLength={40}
          />
        </div>
      )}

      <div className="form-row">
        <div className="form-field">
          <label htmlFor="quote-date">什么时候说的</label>
          <input
            id="quote-date"
            type="date"
            value={saidAt}
            max={todayStr()}
            onChange={(e) => setSaidAt(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="quote-content">
            说了什么{' '}
            <span className="field-note">
              {[...content].length}/{QUOTE_LIMIT}
            </span>
          </label>
          <textarea
            id="quote-content"
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="打得菜就多练，别怪阵容"
            maxLength={QUOTE_LIMIT}
          />
        </div>
      </div>

      {error && <p className="quote-form-error">{error}</p>}
      {notice && <p className="quote-form-notice">{notice}</p>}

      <div className="quote-form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '提交中…' : '收录这句'}
        </button>
        <span className="field-note">提交后会过一遍内容审核，正常聊天都能过。</span>
      </div>
    </form>
  );
}
