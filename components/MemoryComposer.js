import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api-client.mjs';
import { compressImage } from '../lib/image-compress.mjs';
import { normalizeTags } from '../lib/memories-tags.mjs';
import { PLACE_LIMIT } from '../lib/memories-fields.mjs';
import TagPicker from './TagPicker';
import AccountPicker from './AccountPicker';
import ConsentDialog from './ConsentDialog';

/**
 * 发一条回忆：一段文字 + 最多 9 张照片 + 最多 5 个标签
 * + 拍摄的时间和地点 + 指定谁能改这条。
 *
 * 上传时机是「选完图立刻传」，不是「点发布才传」：
 *   - 弱网下 9 张图串行传要十几秒，卡在发布按钮上会让人以为卡死了；
 *   - 单张失败可以只重传那张，不影响已经传好的。
 * 代价是「选了图又不发」会在服务器留孤儿文件，小站可以忽略（也便于人工找回）。
 *
 * 「谁能改」在发布时就指定：照片是几个人一起拍的，谁能补一句、谁能加个标签，
 * 发的人当场就知道。发完再回头点「谁能改」加人也可以，但那时候往往已经忘了。
 *
 * 出镜同意坚持两步：照片旁边一句提示，点发布时再弹一个必须勾的确认框 ——
 * 提示会被跳过，勾选框不会。服务端还要求照片非空时必须带 consent，
 * 所以直接调接口也绕不过去。
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
  const [shotOn, setShotOn] = useState('');
  const [place, setPlace] = useState('');
  // 发布时指定的人：先存本地，发出去的时候一起交给接口（那时才有 memory_id）
  const [editors, setEditors] = useState([]);
  const [today, setToday] = useState('');
  const [busy, setBusy] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  /* 日期选择器的上限用挂载后算的今天：直接渲染时算会和 SSR 的日期打架
     （跨零点那一刻两边不一样，React 会报 hydration 不匹配）。 */
  useEffect(() => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    setToday(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  }, []);

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

  const reset = () => {
    setText('');
    setItems([]);
    setTags([]);
    setTagDraft('');
    setShotOn('');
    setPlace('');
    setEditors([]);
  };

  const doPost = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    setMsg('');
    // 打完标签没回车就点发布也要算数：这里再合一次，不依赖 blur 事件
    const finalTags = tagDraft.trim() ? normalizeTags([...tags, tagDraft]) : tags;
    const hasPhotos = uploaded.length > 0;
    try {
      const r = await apiFetch('/api/memories', {
        method: 'POST',
        body: {
          content: text.trim(),
          photos: uploaded.map((it) => ({ p: it.p, w: it.w, h: it.h })),
          tags: finalTags,
          shotOn,
          place,
          // 走到这里说明确认框已经勾过了（没照片时不弹框，也就不需要这一项）
          consent: hasPhotos ? true : undefined,
          editors: editors.map((e) => e.account),
        },
        timeout: 30000,
      });
      if (!r || !r.success || !r.memory) throw new Error((r && r.error) || '没发出去');
      setConsentOpen(false);
      reset();
      setMsg('发出去了');
      // 填错的账号不该无声消失：整条已经发出去，但这几个人没进名单，得说清楚
      const missed = (r.rejected || []).filter(Boolean);
      if (missed.length) setErr('发出去了，但这几位没加上：' + missed.join('、'));
      if (onCreated) onCreated(r.memory);
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setErr((e && e.message) || '没发出去，稍后再试');
    } finally {
      setBusy(false);
    }
  };

  /** 点发布：有照片先过确认框，纯文字的回忆没有出镜问题，直接发。 */
  const submit = () => {
    if (!canPost) return;
    if (uploaded.length > 0) {
      setConsentOpen(true);
      return;
    }
    doPost();
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

      {/* 时间与地点：给照片做注解，不是发布时刻。都可以不填。 */}
      <div className="mem-whenrow">
        <label className="mem-whenfield">
          <span className="mem-whenlabel">拍的哪天</span>
          <input
            type="date"
            className="mem-wheninput"
            value={shotOn}
            max={today || undefined}
            onChange={(e) => setShotOn(e.target.value)}
          />
        </label>
        <label className="mem-whenfield is-wide">
          <span className="mem-whenlabel">哪儿</span>
          <input
            type="text"
            className="mem-wheninput"
            value={place}
            maxLength={PLACE_LIMIT}
            placeholder="深圳南山 / 老王家 / 网吧二楼"
            onChange={(e) => setPlace(e.target.value)}
          />
        </label>
      </div>

      <TagPicker
        value={tags}
        onChange={setTags}
        draft={tagDraft}
        onDraftChange={setTagDraft}
      />

      <div className="mem-tagrow">
        <span className="mem-taglabel">谁能改</span>
        <AccountPicker
          value={editors}
          onAdd={(hit) => setEditors((prev) => [...prev, hit])}
          onRemove={(account) => setEditors((prev) => prev.filter((e) => e.account !== account))}
          placeholder="搜昵称，能补文案和标签"
          emptyHint="没这个人，换个字试试"
        />
      </div>

      <p className="mem-consent">
        <strong>发之前先问一声。</strong>
        照片里出现的每个人都要先同意被发到这里；谁不愿意，就把那张删掉，或者等问过了再发。
      </p>

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

      <ConsentDialog
        open={consentOpen}
        busy={busy}
        photoCount={uploaded.length}
        onCancel={() => setConsentOpen(false)}
        onConfirm={doPost}
      />
    </section>
  );
}
