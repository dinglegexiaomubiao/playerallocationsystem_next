import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ACTIVITY_STATUS } from '../lib/options.mjs';
import { apiPost, apiDelete, apiFetch } from '../lib/api-client.mjs';

// 集合时间段：开始 ~ 结束（跨天会带上日期）
function fmtRange(startAt, durationMin) {
  if (!startAt) return '';
  const d = new Date(startAt);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  const head = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  if (!durationMin) return head;
  const e = new Date(d.getTime() + Number(durationMin) * 60 * 1000);
  const sameDay = e.getDate() === d.getDate() && e.getMonth() === d.getMonth();
  const tail = sameDay
    ? `${p(e.getHours())}:${p(e.getMinutes())}`
    : `${p(e.getMonth() + 1)}-${p(e.getDate())} ${p(e.getHours())}:${p(e.getMinutes())}`;
  return `${head} ~ ${tail}`;
}

const fmtDay = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function ActivityCard({ post, me, onChanged }) {
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ guests: 0, note: '' });

  // 记录当前正在进行的操作，好在对应按钮上显示 loading 文案
  const [busyAction, setBusyAction] = useState('');

  const st = ACTIVITY_STATUS[post.status] || ACTIVITY_STATUS.open;
  const isMine = post.isMine;
  const stopped = post.status !== 'open';

  const doJoin = async () => {
    setErr('');
    setBusy(true);
    try {
      await apiPost('/api/activities/' + post.id + '/join', {
        guests: Number(form.guests) || 0,
        note: form.note.trim() || null,
      });
      setSigning(false);
      setForm({ guests: 0, note: '' });
      onChanged && onChanged();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const doCancelJoin = async () => {
    setBusy(true);
    setErr('');
    try {
      await apiDelete('/api/activities/' + post.id + '/join');
      onChanged && onChanged();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const patchStatus = async (status) => {
    setBusy(true);
    setBusyAction(status === 'open' ? 'reopen' : 'close');
    setErr('');
    try {
      await apiFetch('/api/activities/' + post.id, { method: 'PATCH', body: { status } });
      onChanged && onChanged();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  };

  const removePost = async () => {
    setBusy(true);
    setBusyAction('delete');
    setErr('');
    try {
      await apiDelete('/api/activities/' + post.id);
      onChanged && onChanged();
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  };

  return (
    <div className={'party-card act-card' + (stopped ? ' is-closed' : '')}>
      <div className="pg-top">
        <span className={'act-type act-type-' + post.type}>{post.typeLabel}</span>
        <span className={'t-badge ' + st.cls}>{st.label}</span>
        <span className="pg-time" title={post.meet_at ? '集合时间（开始 ~ 结束）' : '集合时间'}>
          {post.meet_at ? fmtRange(post.meet_at, post.duration_min) : ''}
        </span>
        {post.expired && <span className="t-badge b-done pg-expired">已过期</span>}
      </div>

      {post.title ? (
        <h3 className="pg-title" title={post.title}>
          {post.title}
        </h3>
      ) : null}

      <div className="pg-owner">
        <span className="pg-av" aria-hidden="true">
          {(post.creator.nickname || '?').slice(0, 1)}
        </span>
        <div className="pg-owner-id">
          {post.creator.player_id ? (
            <Link className="pg-owner-name" href={'/members/' + post.creator.player_id}>
              {post.creator.nickname}
            </Link>
          ) : (
            <span className="pg-owner-name">{post.creator.nickname}</span>
          )}
          <div className="pg-owner-sub">
            <span className="pg-sid-none">活动发起人</span>
          </div>
        </div>
      </div>

      <div className="pg-rows">
        <div className="pg-row">
          <span className="pg-k">集合地点</span>
          <span className="pg-v">
            {post.region ? <span className="p-tag">{post.region}</span> : null}
            <span className="act-loc">{post.location || '—'}</span>
          </span>
        </div>
        <div className="pg-row">
          <span className="pg-k">人数</span>
          <span className="pg-v">
            <span className="party-range-text">
              已约 {post.joinedPeople} 人
              {post.need_people ? ' / 需要 ' + post.need_people + ' 人' : ''}
            </span>
          </span>
        </div>
        {post.cost ? (
          <div className="pg-row">
            <span className="pg-k">费用</span>
            <span className="pg-v">
              <span className="p-tag">{post.cost}</span>
            </span>
          </div>
        ) : null}
        {post.note ? (
          <div className="pg-row">
            <span className="pg-k">备注</span>
            <span className="pg-v pg-note">{post.note}</span>
          </div>
        ) : null}
      </div>

      {post.signups.length > 0 && (
        <div className="pg-signups">
          <div className="pg-signups-head">
            已报名 <b>{post.signupCount}</b> 人
            {post.need_people ? (
              <span className="pg-need">{' '}/ 约满 {post.need_people} 人</span>
            ) : null}
          </div>
          {post.signups.map((s) => (
            <div className="pg-signup" key={s.id}>
              <span className="pg-signup-av" aria-hidden="true">
                {(s.nickname || '?').slice(0, 1)}
              </span>
              <div className="pg-signup-main">
                {s.player_id ? (
                  <Link className="pg-signup-name" href={'/members/' + s.player_id}>
                    {s.nickname}
                  </Link>
                ) : (
                  <span className="pg-signup-name">{s.nickname}</span>
                )}
                <div className="pg-signup-meta">
                  {s.guests > 0 ? `携 ${s.guests} 人同行 · ` : '本人参加 · '}
                  {s.note ? s.note : '暂无留言'}
                </div>
              </div>
              <div className="pg-signup-side">
                <span className="pg-signup-time">{fmtDay(s.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {err && <div className="adm-error">{err}</div>}

      <div className="pg-foot">
        {isMine ? (
          <>
            <span className="pg-foot-note">这是你发起的活动</span>
            <div className="pg-actions">
              {post.status === 'open' ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => patchStatus('closed')}
                  disabled={busy}
                >
                  {busyAction === 'close' ? (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      关闭中…
                    </>
                  ) : (
                    '关闭招募'
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => patchStatus('open')}
                  disabled={busy}
                >
                  {busyAction === 'reopen' ? (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      开启中…
                    </>
                  ) : (
                    '重新招募'
                  )}
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={removePost}
                disabled={busy}
              >
                {busyAction === 'delete' ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    删除中…
                  </>
                ) : (
                  '删除活动'
                )}
              </button>
            </div>
          </>
        ) : post.iJoined ? (
          <>
            <span className="pg-foot-note">你已报名，等待发起人联系</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={doCancelJoin}
              disabled={busy}
            >
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  取消中…
                </>
              ) : (
                '取消报名'
              )}
            </button>
          </>
        ) : (
          <>
            <span className="pg-foot-note">
              {stopped ? '这个活动已停止招募' : '报名后可填写携伴人数和留言'}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setSigning(true)}
              disabled={busy || stopped}
            >
              {stopped ? '已停止招募' : '我要报名'}
            </button>
          </>
        )}
      </div>

      {signing && (
        <div className="modal-mask" onClick={() => setSigning(false)}>
          <div className="modal-card modal-card-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>报名 · {post.typeLabel}</h3>
              <button
                type="button"
                className="modal-close"
                aria-label="关闭"
                onClick={() => setSigning(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-hint">
              发起人 {post.creator.nickname} ·{' '}
              {post.meet_at ? fmtRange(post.meet_at, post.duration_min) : ''} · {post.location}
            </div>
            <div className="party-signup-body">
              {err && <div className="adm-error">{err}</div>}

              <div className="form-field">
                <label>携伴人数（除你自己之外还能带几个人）</label>
                <div className="chips">
                  {[0, 1, 2, 3, 5, 10].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={'chip' + (Number(form.guests) === n ? ' active' : '')}
                      onClick={() => setForm((prev) => ({ ...prev, guests: n }))}
                    >
                      {n === 0 ? '仅本人' : '+' + n + ' 人'}
                    </button>
                  ))}
                </div>
                <div className="party-need-row">
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={form.guests}
                    onChange={(e) => setForm((prev) => ({ ...prev, guests: e.target.value }))}
                    aria-label="携伴人数"
                  />
                  <span>人 · 最多带 20 人</span>
                </div>
              </div>

              <div className="form-field">
                <label>
                  留言 <span className="field-note">（可选）</span>
                </label>
                <textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                  placeholder="怎么联系你、几点到、要不要拼车……"
                />
              </div>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSigning(false)}
                disabled={busy}
              >
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={doJoin} disabled={busy}>
                {busy ? (
                  <>
                    <span className="spinner" aria-hidden="true" />
                    提交中…
                  </>
                ) : (
                  '确认报名'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
