import { useRef, useState } from 'react';
import { apiFetch } from '../lib/api-client.mjs';
import { compressImage } from '../lib/image-compress.mjs';
import { normalizeTags } from '../lib/memories-tags.mjs';
import TagPicker from './TagPicker';

/**
 * 发一条回忆：一段文字 + 最多 9 张照片 + 最多 5 个标签。
 *
 * 上传时机是「选完图立刻传」，不是「点发布才传」：
 *   - 弱网下 9 张图串行传要十几秒，卡在发布按钮上会让人以为卡死了；
 *   - 单张失败可以只重传那张，不影响已经传好的。
 * 代价是「选了图又不发」会在服务器留孤儿文件，小站可以忽略（也便于人工找回）。
 *
 * 正文长度 800，和 lib/memories.mjs 的 TEXT_LIMIT 对齐；提示语不说「审核」，
 * 只说「发不出去」，因为绝大多数情况是词表命中，跟用户解释规则没意义。
 *
 * 标签不强制：绝大多数照片归不进任何类别，逼人选只会让人乱点。
 * 但一旦要选，候选就当开关用 —— 点一下选中、再点取消，不做下拉菜单。
 */

const MAX_PHOTOS = 9;
const TEXT_LIMIT = 800;

let seq = 0;
const nextKey = () => 'p' + ++seq;

export default function MemoryComposer({ onCreated }) {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const patch = (key, next) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...next } : it)));

  const uploading = items.some((it) => it.status === 'compressing' || it.status === 'uploading');
  const uploaded = items.filter((it) => it.status === 'done');
  const canPost = !busy && !uploading && (text.trim().length > 0 || uploaded.length > 0);

  const upload = async (it, file) => {
    try {
      const shot = await compressImage(file);
      patch(it.key, { status: 'uploading', preview: shot.data, w: shot.w, h: shot.h });
      const r = await apiFetch('/api/memories/upload', {
        method: 'POST',
        body: { data: shot.data },
        timeout: 60000,
      });
      if (!r || !r.success || !r.p) throw new Error((r && r.error) || '上传失败');
      patch(it.key, { status: 'done', p: r.p });
    } catch (e) {
      patch(it.key, { status: 'error', error: (e && e.message) || '这张没传上去' });
    }
  };

  const pick = (e) => {
    const files = Array.from((e.target && e.target.files) || []);
    if (e.target) e.target.value = ''; // 允许重复选同一张
    if (!files.length) return;
    setErr('');

    const room = MAX_PHOTOS - items.length;
    if (room <= 0) {
      setErr(`一条回忆最多 ${MAX_PHOTOS} 张照片`);
      return;
    }
    const take = files.slice(0, room);
    if (files.length > room) setErr(`最多 ${MAX_PHOTOS} 张，多出来的先删几张再选`);

    const fresh = take.map((file) => ({ key: nextKey(), file, status: 'compressing', p: '', preview: '' }));
    setItems((prev) => [...prev, ...fresh]);
    fresh.forEach((it) => upload(it, it.file));
  };

  const remove = (key) => setItems((prev) => prev.filter((it) => it.key !== key));

  const submit = async () => {
    if (!canPost) return;
    setBusy(true);
    setErr('');
    setMsg('');
    // 打完标签没回车就点发布也要算数：这里再合一次，不依赖 blur 事件
    const finalTags = tagDraft.trim() ? normalizeTags([...tags, tagDraft]) : tags;
    try {
      const r = await apiFetch('/api/memories', {
        method: 'POST',
        body: {
          content: text.trim(),
          photos: uploaded.map((it) => ({ p: it.p, w: it.w, h: it.h })),
          tags: finalTags,
        },
        timeout: 30000,
      });
      if (!r || !r.success || !r.memory) throw new Error((r && r.error) || '没发出去');
      setText('');
      setItems([]);
      setTags([]);
      setTagDraft('');
      setMsg('发出去了');
      if (onCreated) onCreated(r.memory);
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setErr((e && e.message) || '没发出去，稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mem-write" aria-label="发一条回忆">
      <textarea
        className="mem-write-box"
        value={text}
        maxLength={TEXT_LIMIT}
        placeholder="谁家聚过、哪次翻盘、谁的键盘冒烟了 —— 写一句，配几张图"
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />

      <TagPicker
        value={tags}
        onChange={setTags}
        draft={tagDraft}
        onDraftChange={setTagDraft}
      />

      {items.length > 0 && (
        <div className="mem-thumbs">
          {items.map((it) => (
            <div key={it.key} className={'mem-thumb is-' + it.status}>
              {it.preview ? <img src={it.preview} alt="" /> : <span className="mem-thumb-ph" />}
              {it.status !== 'done' && (
                <span className="mem-thumb-mask">
                  {it.status === 'error' ? '失败' : '传…'}
                </span>
              )}
              <button
                type="button"
                className="mem-thumb-x"
                onClick={() => remove(it.key)}
                aria-label="去掉这张"
              >
                ×
              </button>
            </div>
          ))}
          {items.length < MAX_PHOTOS && (
            <button type="button" className="mem-thumb-add" onClick={() => fileRef.current && fileRef.current.click()}>
              + 照片
              <em>{items.length}/{MAX_PHOTOS}</em>
            </button>
          )}
        </div>
      )}

      <div className="mem-write-foot">
        <div className="mem-write-left">
          {items.length === 0 && (
            <button type="button" className="mem-pick" onClick={() => fileRef.current && fileRef.current.click()}>
              选照片
            </button>
          )}
          <span className="mem-count">{text.length}/{TEXT_LIMIT}</span>
          {err && <span className="mem-err">{err}</span>}
          {!err && msg && <span className="mem-ok">{msg}</span>}
        </div>
        <button type="button" className="mem-post" disabled={!canPost} onClick={submit}>
          {busy ? '发布中…' : uploading ? '照片还在传…' : '发布'}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={pick}
      />
    </section>
  );
}
