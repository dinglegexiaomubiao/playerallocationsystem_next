import { useState } from 'react';
import { apiFetch } from '../lib/api-client.mjs';
import { relTime, gridClass, aspectOf } from '../lib/memories-view.mjs';

/**
 * 一条回忆：作者行 → 正文 → 图片 → 评论。
 *
 * 版式刻意不用卡片：回忆是「一条接一条往下看」的东西，套上边框和背景之后
 * 每条都变成一个盒子，一屏只能看一条；这里只用一条细线分隔（和语录页同一套逻辑）。
 *
 * 评论是按需加载的：列表里只显示条数，点开才请求。二十条回忆如果都带评论，
 * 首屏要多传几十 KB，而多数人其实只看图。
 */
export default function MemoryItem({ memory, me, myPlayerId, isAdmin, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [count, setCount] = useState(memory.commentCount || 0);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [gone, setGone] = useState(false);

  const mine = !!myPlayerId && String(memory.author.playerId) === String(myPlayerId);
  const canDelete = !!me && (isAdmin || mine);
  const cls = gridClass(memory.photos.length);
  const ratio = memory.photos.length === 1 ? aspectOf(memory.photos[0].w, memory.photos[0].h) : null;

  const loadComments = async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await apiFetch(`/api/memories/${memory.id}/comments`);
      if (!r || !r.success) throw new Error((r && r.error) || '评论没加载出来');
      setComments(r.comments || []);
      setCount((r.comments || []).length);
    } catch (e) {
      setErr((e && e.message) || '评论没加载出来');
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !comments.length && !loading) loadComments();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await apiFetch(`/api/memories/${memory.id}/comments`, {
        method: 'POST',
        body: { content: text },
        timeout: 20000,
      });
      if (!r || !r.success || !r.comment) throw new Error((r && r.error) || '没发出去');
      setComments((prev) => [...prev, r.comment]);
      setCount((n) => n + 1);
      setDraft('');
    } catch (e) {
      setErr((e && e.message) || '没发出去，稍后再试');
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    if (!window.confirm('删掉这条回忆？照片会一起隐藏，但不会立刻从磁盘删除。')) return;
    try {
      const r = await apiFetch(`/api/memories/${memory.id}`, { method: 'DELETE' });
      if (!r || !r.success) throw new Error((r && r.error) || '没删掉');
      setGone(true);
      if (onDeleted) onDeleted(memory.id);
    } catch (e) {
      setErr((e && e.message) || '没删掉，稍后再试');
    }
  };

  const dropComment = async (cid) => {
    try {
      const r = await apiFetch(`/api/memories/${memory.id}/comments/${cid}`, { method: 'DELETE' });
      if (!r || !r.success) throw new Error((r && r.error) || '没删掉');
      setComments((prev) => prev.filter((c) => c.id !== cid));
      setCount((n) => Math.max(0, n - 1));
    } catch (e) {
      setErr((e && e.message) || '没删掉');
    }
  };

  if (gone) return null;

  return (
    <article className="mem-item">
      <header className="mem-by">
        {memory.author.avatar ? (
          <img className="mem-ava" src={memory.author.avatar} alt="" loading="lazy" />
        ) : (
          <span className="mem-ava mem-ava-ph" aria-hidden="true">
            {(memory.author.name || '群').charAt(0)}
          </span>
        )}
        <span className="mem-name">{memory.author.name}</span>
        <time className="mem-time" dateTime={memory.createdAt}>
          {relTime(memory.createdAt)}
        </time>
        {canDelete && (
          <button type="button" className="mem-drop" onClick={drop}>
            删除
          </button>
        )}
      </header>

      {memory.content && <p className="mem-text">{memory.content}</p>}

      {memory.photos.length > 0 && (
        <div className={cls}>
          {memory.photos.map((p, i) => (
            <a
              key={p.url}
              className="mem-shot"
              href={p.url}
              target="_blank"
              rel="noreferrer noopener"
              style={ratio && i === 0 ? { aspectRatio: ratio } : undefined}
            >
              <img src={p.url} alt={`回忆照片 ${i + 1}`} loading="lazy" />
            </a>
          ))}
        </div>
      )}

      <footer className="mem-foot">
        <button type="button" className={'mem-cbtn' + (open ? ' is-open' : '')} onClick={toggle}>
          {open ? '收起评论' : `评论 ${count}`}
        </button>
        {err && <span className="mem-err">{err}</span>}
      </footer>

      {open && (
        <div className="mem-cmts">
          {loading && <p className="mem-cmt-empty">评论加载中…</p>}
          {!loading && !comments.length && <p className="mem-cmt-empty">还没有人说话，第一句留给你。</p>}
          {comments.map((c) => (
            <div className="mem-cmt" key={c.id}>
              <span className="mem-cmt-name">{c.author.name}</span>
              <span className="mem-cmt-text">{c.content}</span>
              <span className="mem-cmt-time">{relTime(c.createdAt)}</span>
              {!!me && (isAdmin || (!!myPlayerId && String(c.author.playerId) === String(myPlayerId))) && (
                <button type="button" className="mem-cmt-x" onClick={() => dropComment(c.id)}>
                  删
                </button>
              )}
            </div>
          ))}

          {me ? (
            <div className="mem-cmt-form">
              <input
                type="text"
                value={draft}
                maxLength={300}
                placeholder="说点什么…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) send();
                }}
              />
              <button type="button" onClick={send} disabled={busy || !draft.trim()}>
                {busy ? '发送中…' : '发送'}
              </button>
            </div>
          ) : (
            <p className="mem-cmt-empty">登录后才能评论。</p>
          )}
        </div>
      )}
    </article>
  );
}
