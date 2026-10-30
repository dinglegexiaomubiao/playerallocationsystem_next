import { useState } from 'react';
import { apiFetch } from '../lib/api-client.mjs';
import { relTime, gridClass, aspectOf } from '../lib/memories-view.mjs';
import { normalizeTags } from '../lib/memories-tags.mjs';
import TagPicker from './TagPicker';
import MemoryGrants from './MemoryGrants';

/** 和 lib/memories.mjs 的 TEXT_LIMIT 是同一个数，改一边要改另一边。 */
const TEXT_MAX = 800;

/**
 * 一条回忆：作者行 → 正文 → 图片 → 评论。
 *
 * 版式刻意不用卡片：回忆是「一条接一条往下看」的东西，套上边框和背景之后
 * 每条都变成一个盒子，一屏只能看一条；这里只用一条细线分隔（和语录页同一套逻辑）。
 *
 * 评论是按需加载的：列表里只显示条数，点开才请求。二十条回忆如果都带评论，
 * 首屏要多传几十 KB，而多数人其实只看图。
 *
 * 文案编辑是原地展开的：正文位置换成输入框，不弹窗、不跳页面 ——
 * 改的是「这张照片配的几句话」，眼睛应该还盯在照片上。
 */
export default function MemoryItem({
  memory,
  me,
  myPlayerId,
  isAdmin,
  canEditAll,
  onDeleted,
  onTag,
  activeTag,
  onTagsChange,
}) {
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [count, setCount] = useState(memory.commentCount || 0);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [gone, setGone] = useState(false);
  // 正文单独存一份：改完立刻生效，不用等整页重新拉数据
  const [content, setContent] = useState(memory.content || '');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(memory.content || '');
  const [saving, setSaving] = useState(false);
  const [editErr, setEditErr] = useState('');
  // 「这条谁能改」面板：按需展开，不预取名单
  const [grantOpen, setGrantOpen] = useState(false);
  // 标签同样存本地：保存后筛选条上的计数由父页面刷新，这里只负责这一条的显示
  const [tags, setTags] = useState(memory.tags || []);
  const [tagText, setTagText] = useState('');

  const mine = !!myPlayerId && String(memory.author.playerId) === String(myPlayerId);
  const canDelete = !!me && (isAdmin || mine);
  // 改文案三种来源：作者本人 / 全站名单（校对）/ 这一条单独指定的人（memory.granted）。
  // 删回忆始终只有作者和管理员 —— 能改字不等于能删内容。
  const canEdit = canDelete || (!!me && (canEditAll || !!memory.granted));
  // 谁有权指定「这条谁能改」：作者本人和管理员。别人改字是帮忙，派活是作者的事。
  const canGrant = !!me && (isAdmin || mine);
  const cls = gridClass(memory.photos.length);
  const ratio = memory.photos.length === 1 ? aspectOf(memory.photos[0].w, memory.photos[0].h) : null;

  const startEdit = () => {
    setText(content);
    setTags(memory.tags || tags);
    setTagText('');
    setEditErr('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setText(content);
    setTags(memory.tags || []);
    setTagText('');
    setEditErr('');
    setEditing(false);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setEditErr('');
    // 打了标签没回车就点保存，也要算数（和发布框同一套处理）
    const nextTags = tagText.trim() ? normalizeTags([...tags, tagText]) : tags;
    try {
      const r = await apiFetch(`/api/memories/${memory.id}`, {
        method: 'PATCH',
        body: { content: text, tags: nextTags },
        timeout: 20000,
      });
      if (!r || !r.success) throw new Error((r && r.error) || '没改成');
      const next = (r.memory && r.memory.content) || '';
      setContent(next);
      setText(next);
      setTags((r.memory && r.memory.tags) || nextTags);
      setTagText('');
      setEditing(false);
      if (onTagsChange) onTagsChange();
    } catch (e) {
      setEditErr((e && e.message) || '没改成，稍后再试');
    } finally {
      setSaving(false);
    }
  };

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
        {(canEdit || canDelete || canGrant) && (
          <div className="mem-acts">
            {/* 编辑态不重复给「取消」—— 输入框下面已经有一个，两个取消按钮会让人犹豫按哪个 */}
            {canGrant && !editing && (
              <button
                type="button"
                className={'mem-drop' + (grantOpen ? ' is-on' : '')}
                onClick={() => setGrantOpen((v) => !v)}
              >
                {grantOpen ? '收起' : '谁能改'}
              </button>
            )}
            {canEdit && !editing && (
              <button type="button" className="mem-drop" onClick={startEdit}>
                编辑
              </button>
            )}
            {canDelete && (
              <button type="button" className="mem-drop" onClick={drop}>
                删除
              </button>
            )}
          </div>
        )}
      </header>

      {grantOpen && canGrant && <MemoryGrants memoryId={memory.id} />}

      {editing ? (
        <div className="mem-edit">
          <textarea
            className="mem-edit-box"
            value={text}
            maxLength={TEXT_MAX}
            rows={3}
            placeholder="给这条回忆写点什么，留空就只留照片。"
            onChange={(e) => setText(e.target.value)}
          />
          <TagPicker
            value={tags}
            onChange={setTags}
            draft={tagText}
            onDraftChange={setTagText}
          />
          <div className="mem-edit-foot">
            <span className="mem-count">
              {text.length}/{TEXT_MAX}
            </span>
            {editErr && <span className="mem-err">{editErr}</span>}
            <button type="button" className="mem-pick" onClick={cancelEdit} disabled={saving}>
              取消
            </button>
            <button type="button" className="mem-post mem-edit-save" onClick={save} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      ) : (
        content && <p className="mem-text">{content}</p>
      )}

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

      {/* 标签贴在照片下面：它描述的是这几张图，不是上面那段文字 */}
      {!editing && tags.length > 0 && (
        <div className="mem-tags">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              className={'mem-tag-link' + (activeTag === t ? ' is-on' : '')}
              onClick={() => onTag && onTag(t)}
              title={`只看「${t}」`}
            >
              #{t}
            </button>
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
