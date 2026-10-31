import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api-client.mjs';

/**
 * 「谁能改这条」的选人控件：发布框和卡片里的名单面板共用。
 *
 * 为什么要有搜索：权限表里存的是登录账号（qiang1994），
 * 而群友记得住的是昵称（阿强）。让人自己把昵称翻译成账号，
 * 结果一定是「我明明加了他，他却改不了」。
 *
 * 候选列表**内联展开**，不做浮层下拉：这个控件可能出现在页面中部，
 * 浮层一旦被父容器的 overflow 裁掉，键盘能选、眼睛看不见。
 *
 * 列表和异步都在父组件：发布框里是纯本地数组，卡片里要真的增删服务端记录，
 * 两边只在「点了谁」这件事上一致。
 */
export default function AccountPicker({
  value = [],
  onAdd,
  onRemove,
  busy = false,
  placeholder = '搜昵称或登录账号',
  emptyHint = '没找到这个人，换个字试试',
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [searching, setSearching] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState('');
  const seq = useRef(0);

  const list = Array.isArray(value) ? value : [];
  const has = (account) => list.some((v) => String(v.account).toLowerCase() === String(account).toLowerCase());

  /* 打字防抖 220ms：按一次键就发一个请求，在弱网下会互相盖掉，
     最后显示的是第一个字的结果。seq 用来丢掉「回来得晚的旧请求」。 */
  useEffect(() => {
    const raw = q.trim();
    if (!raw) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const my = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const r = await apiFetch('/api/accounts/search?q=' + encodeURIComponent(raw), { timeout: 15000 });
        if (my !== seq.current) return;
        if (r && r.success) {
          setHits((r.accounts || []).filter((a) => !has(a.account)));
          setErr('');
        } else {
          setHits([]);
          setErr((r && r.error) || '没搜出来');
        }
      } catch (e) {
        if (my === seq.current) setErr((e && e.message) || '没搜出来');
      } finally {
        if (my === seq.current) setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
    // has 依赖 list，list 变了要重算候选（已加入的人不该还留在候选里）
  }, [q, list]);

  const add = async (hit) => {
    if (!hit || busy || adding) return;
    setAdding(hit.account);
    setErr('');
    try {
      await onAdd(hit);
      setQ('');
      setHits([]);
    } catch (e) {
      setErr((e && e.message) || '没加上');
    } finally {
      setAdding('');
    }
  };

  const remove = async (account) => {
    if (busy) return;
    setErr('');
    try {
      await onRemove(account);
    } catch (e) {
      setErr((e && e.message) || '没移除');
    }
  };

  return (
    <div className="mem-acc">
      <div className="mem-acc-row">
        {list.map((v) => (
          <span key={v.account} className="mem-grant" title={`登录账号 ${v.account}`}>
            {v.nickname || v.account}
            <button
              type="button"
              className="mem-grant-x"
              onClick={() => remove(v.account)}
              disabled={busy}
              aria-label={`把 ${v.nickname || v.account} 移出这条的名单`}
            >
              ×
            </button>
          </span>
        ))}

        <input
          className="mem-grant-input"
          value={q}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              if (hits.length) add(hits[0]);
            }
            if (e.key === 'Escape') {
              setQ('');
              setHits([]);
            }
          }}
        />
      </div>

      {q.trim() && (
        <div className="mem-acc-hits">
          {hits.map((h) => (
            <button
              key={h.account}
              type="button"
              className="mem-acc-hit"
              onClick={() => add(h)}
              disabled={!!adding}
            >
              <span className="mem-acc-nick">{h.nickname || h.account}</span>
              <span className="mem-acc-id">{h.account}</span>
            </button>
          ))}
          {searching && !hits.length && <span className="mem-grants-wait">找…</span>}
          {!searching && !hits.length && !err && <span className="mem-grants-wait">{emptyHint}</span>}
        </div>
      )}

      {err && <span className="mem-tag-err">{err}</span>}
    </div>
  );
}
