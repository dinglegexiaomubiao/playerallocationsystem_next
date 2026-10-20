import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TIERS, tierOf } from '../lib/tier.mjs';
import { POSITIONS, TIME_PRESETS, PARTY_STATUS } from '../lib/options.mjs';

const toggle = (list, v) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

const rankOf = (score) => {
  if (score === '' || score === null || score === undefined) return '';
  const n = Number(score);
  return Number.isFinite(n) ? tierOf(n).label : '';
};

const fmtDay = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function ScoreBadge({ score, rank }) {
  if (score === null || score === undefined || score === '') {
    return rank ? <span className="party-rank-only">{rank}</span> : null;
  }
  const t = tierOf(Number(score));
  return (
    <span className={'party-score ' + t.cls}>
      {score}
      <i>{t.label}</i>
    </span>
  );
}

function PositionTags({ items }) {
  if (!items || !items.length) return <span className="party-none">位置不限</span>;
  return (
    <span className="chips">
      {items.map((p) => (
        <span className="p-tag" key={p}>
          {p}
        </span>
      ))}
    </span>
  );
}

export default function PartyCard({ post, me, onChanged }) {
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({
    score: '',
    rank: '',
    positions: [],
    eta: '',
    note: '',
  });

  const st = PARTY_STATUS[post.status] || PARTY_STATUS.open;
  const isMine = post.isMine;
  const full = post.status !== 'open';

  // 打开报名弹窗时用「我的」资料预填，省得重复输入
  useEffect(() => {
    if (!signing || !me || !me.bound) return;
    setForm((prev) => ({
      ...prev,
      score: prev.score || (me.score != null ? String(me.score) : ''),
      rank: prev.rank || (me.score != null ? rankOf(me.score) : ''),
      positions: prev.positions.length ? prev.positions : me.positions || [],
    }));
  }, [signing, me]);

  const fillFromProfile = () => {
    if (!me || !me.bound) return;
    setForm((prev) => ({
      ...prev,
      score: me.score != null ? String(me.score) : prev.score,
      rank: me.score != null ? rankOf(me.score) : prev.rank,
      positions: me.positions && me.positions.length ? me.positions : prev.positions,
    }));
  };

  const doJoin = async () => {
    setErr('');
    setBusy(true);
    const r = await fetch('/api/party/' + post.id + '/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        score: form.score === '' ? null : Number(form.score),
        rank: form.rank || null,
        positions: form.positions,
        eta: form.eta.trim() || null,
        note: form.note.trim() || null,
      }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok && d.success) {
      setSigning(false);
      setForm({ score: '', rank: '', positions: [], eta: '', note: '' });
      onChanged && onChanged();
    } else {
      setErr(d.error || '报名失败，请稍后再试');
    }
  };

  const doCancelJoin = async () => {
    setBusy(true);
    setErr('');
    const r = await fetch('/api/party/' + post.id + '/join', { method: 'DELETE' });
    setBusy(false);
    if (r.ok) {
      onChanged && onChanged();
    } else {
      const d = await r.json().catch(() => ({}));
      setErr(d.error || '取消失败');
    }
  };

  const patchStatus = async (status) => {
    setBusy(true);
    const r = await fetch('/api/party/' + post.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (r.ok) onChanged && onChanged();
  };

  const removePost = async () => {
    setBusy(true);
    const r = await fetch('/api/party/' + post.id, { method: 'DELETE' });
    setBusy(false);
    if (r.ok) onChanged && onChanged();
  };

  return (
    <div className={'party-card' + (full ? ' is-closed' : '')}>
      <div className="pg-top">
        <span className={'pg-mode pg-mode-' + post.mode}>{post.modeLabel}</span>
        <span className={'t-badge ' + st.cls}>{st.label}</span>
        <span className="pg-time" title="开黑时间">
          {post.play_time}
        </span>
      </div>

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
            {post.game_id ? 'SteamID ' + post.game_id : '未填 SteamID'}
          </div>
        </div>
        <ScoreBadge score={post.creator.score} />
      </div>

      <div className="pg-rows">
        <div className="pg-row">
          <span className="pg-k">我的水平</span>
          <span className="pg-v">
            <ScoreBadge score={post.my_score} rank={post.my_rank} />
            <PositionTags items={post.my_positions} />
          </span>
        </div>
        <div className="pg-row">
          <span className="pg-k">希望队友</span>
          <span className="pg-v">
            {post.want_rank ? <span className="party-rank-only">{post.want_rank}</span> : null}
            {post.want_score_min != null || post.want_score_max != null ? (
              <span className="party-range-text">
                {post.want_score_min != null ? post.want_score_min : '不限'} ~{' '}
                {post.want_score_max != null ? post.want_score_max : '不限'} 分
              </span>
            ) : null}
            <PositionTags items={post.want_positions} />
          </span>
        </div>
        <div className="pg-row">
          <span className="pg-k">语音</span>
          <span className="pg-v">
            {post.has_voice ? (
              <span className="p-tag">有语音{post.voice_app ? ' · ' + post.voice_app : ''}</span>
            ) : (
              <span className="p-tag">不开语音</span>
            )}
          </span>
        </div>
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
            已报名 <b>{post.signups.length}</b> 人
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
                  {s.rank ? s.rank + ' · ' : ''}
                  {s.score != null ? s.score + ' 分 · ' : ''}
                  {s.positions.length ? s.positions.join('/') : '位置未填'}
                </div>
              </div>
              <div className="pg-signup-side">
                {s.eta ? <span className="pg-eta">{s.eta}</span> : null}
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
            <span className="pg-foot-note">这是你发起的开黑</span>
            <div className="pg-actions">
              {post.status === 'open' ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => patchStatus('closed')}
                  disabled={busy}
                >
                  关闭招募
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => patchStatus('open')}
                  disabled={busy}
                >
                  重新招募
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={removePost}
                disabled={busy}
              >
                删除卡片
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
              取消报名
            </button>
          </>
        ) : (
          <>
            <span className="pg-foot-note">
              {full ? '这张卡片已停止招募' : '报名后发起人能看到你的段位与上线时间'}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setSigning(true)}
              disabled={busy || full}
            >
              {full ? '已停止招募' : '我要报名'}
            </button>
          </>
        )}
      </div>

      {signing && (
        <div className="modal-mask" onClick={() => setSigning(false)}>
          <div className="modal-card modal-card-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>报名 · {post.modeLabel}</h3>
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
              发起人 {post.creator.nickname} · {post.play_time}
            </div>
            <div className="party-signup-body">
              {err && <div className="adm-error">{err}</div>}

              <div className="party-signup-fill">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={fillFromProfile}
                  disabled={!me || !me.bound}
                >
                  用群友信息一键填报
                </button>
                <span className="party-signup-fill-hint">
                  {me && me.bound
                    ? '把你的天梯分与擅长位置直接带进来'
                    : '账号还没绑定选手资料，请手动填写'}
                </span>
              </div>

              <div className="form-row">
                <div className="form-field">
                  <label>我的天梯分</label>
                  <input
                    type="number"
                    value={form.score}
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((prev) => ({
                        ...prev,
                        score: v,
                        rank: rankOf(v) || prev.rank,
                      }));
                    }}
                    placeholder="如 3850"
                  />
                </div>
                <div className="form-field">
                  <label>我的段位</label>
                  <select
                    value={form.rank}
                    onChange={(e) => setForm((p) => ({ ...p, rank: e.target.value }))}
                  >
                    <option value="">未填写</option>
                    {TIERS.map((t) => (
                      <option key={t.key} value={t.label}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-field">
                <label>我擅长的位置</label>
                <div className="chips">
                  {POSITIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={'chip' + (form.positions.includes(p) ? ' active' : '')}
                      onClick={() =>
                        setForm((prev) => ({ ...prev, positions: toggle(prev.positions, p) }))
                      }
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-field">
                <label>大概几点能上线</label>
                <input
                  value={form.eta}
                  onChange={(e) => setForm((p) => ({ ...p, eta: e.target.value }))}
                  placeholder="如：20:30 左右"
                />
                <div className="chips" style={{ marginTop: 8 }}>
                  {TIME_PRESETS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={'chip' + (form.eta === t ? ' active' : '')}
                      onClick={() => setForm((p) => ({ ...p, eta: t }))}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-field">
                <label>
                  备注 <span className="field-note">（可选）</span>
                </label>
                <textarea
                  rows={2}
                  value={form.note}
                  onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                  placeholder="能补位、能开麦……"
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
                {busy ? '提交中…' : '确认报名'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
