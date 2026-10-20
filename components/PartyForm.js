import { useState } from 'react';
import Link from 'next/link';
import { TIERS, tierOf } from '../lib/tier.mjs';
import { POSITIONS, PARTY_MODES, VOICE_APPS, DURATION_OPTIONS, NEED_PLAYER_OPTIONS } from '../lib/options.mjs';
import { apiPost } from '../lib/api-client.mjs';

const toggle = (list, v) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

// datetime-local 需要一个不带时区的本地时间字符串；默认给「下一个整点」
function defaultStartAt() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const rankOf = (score) => {
  if (score === '' || score === null || score === undefined) return '';
  const n = Number(score);
  return Number.isFinite(n) ? tierOf(n).label : '';
};

/**
 * 新建开黑卡片。
 * 所有「我的…」字段默认用选手资料预填，也可点「一键带入」重新覆盖。
 */
export default function PartyForm({ me, onCreated, onClose }) {
  const [mode, setMode] = useState(PARTY_MODES[0].key);
  const [f, setF] = useState(() => ({
    game_id: (me && me.gameId) || '',
    my_score: me && me.score != null ? String(me.score) : '',
    my_rank: me && me.score != null ? rankOf(me.score) : '',
    my_positions: (me && me.positions) || [],
    want_score_min: '',
    want_score_max: '',
    want_rank: '',
    want_positions: [],
    need_players: 5,
    start_at: defaultStartAt(),
    duration_min: 120,
    has_voice: true,
    voice_app: '',
    note: '',
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));

  const fillMe = () => {
    if (!me || !me.bound) return;
    setF((prev) => ({
      ...prev,
      game_id: me.gameId || prev.game_id,
      my_score: me.score != null ? String(me.score) : prev.my_score,
      my_rank: me.score != null ? rankOf(me.score) : prev.my_rank,
      my_positions: me.positions && me.positions.length ? me.positions : prev.my_positions,
      // 队友要求先按自己水平给个默认值，发帖人大多招同段位
      want_rank: prev.want_rank || (me.score != null ? rankOf(me.score) : ''),
    }));
  };

  const submit = async () => {
    setErr('');
    if (!f.start_at) {
      setErr('请选择开黑开始时间');
      return;
    }
    if (!(Number(f.need_players) >= 1 && Number(f.need_players) <= 20)) {
      setErr('请填写需要几个人（1~20）');
      return;
    }
    setBusy(true);
    const body = {
      mode,
      game_id: f.game_id.trim(),
      my_score: f.my_score === '' ? null : Number(f.my_score),
      my_rank: f.my_rank || null,
      my_positions: f.my_positions,
      want_score_min: f.want_score_min === '' ? null : Number(f.want_score_min),
      want_score_max: f.want_score_max === '' ? null : Number(f.want_score_max),
      want_rank: f.want_rank || null,
      want_positions: f.want_positions,
      need_players: Number(f.need_players),
      start_at: f.start_at,
      duration_min: Number(f.duration_min),
      has_voice: f.has_voice,
      voice_app: f.has_voice ? f.voice_app || null : null,
      note: f.note.trim() || null,
    };
    try {
      // apiFetch 统一 15s 超时，超时提示「请求超时，请检查网络后重试」
      const d = await apiPost('/api/party', body);
      if (d && d.success) onCreated && onCreated(d.id);
      else setErr((d && d.error) || '发布失败，请稍后再试');
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (!me) {
    return (
      <div className="party-form">
        <div className="party-form-head">
          <h3>发起开黑</h3>
        </div>
        <div className="party-lock">
          开黑卡片需要登录后才能发起。
          <Link href="/login?from=/party" className="btn btn-sm btn-primary">
            去登录
          </Link>
        </div>
      </div>
    );
  }

  if (!me.bound) {
    return (
      <div className="party-form">
        <div className="party-form-head">
          <h3>发起开黑</h3>
          <button type="button" className="adm-close" aria-label="收起" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="party-lock">
          你的账号还没绑定选手资料，开黑卡片需要用你的段位与位置信息。
          <Link href="/profile" className="btn btn-sm btn-primary">
            补填选手资料
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="party-form">
      <div className="party-form-head">
        <h3>发起开黑</h3>
        <div className="party-form-head-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={fillMe}>
            一键带入我的资料
          </button>
          <button type="button" className="adm-close" aria-label="收起" onClick={onClose}>
            ×
          </button>
        </div>
      </div>

      {err && <div className="adm-error">{err}</div>}

      <div className="party-section-label">① 开黑模式</div>
      <div className="party-modes">
        {PARTY_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={'party-mode-opt' + (mode === m.key ? ' active' : '')}
            onClick={() => setMode(m.key)}
          >
            <b>{m.label}</b>
            <span>{m.hint}</span>
          </button>
        ))}
      </div>

      <div className="party-section-label">② 我的资料</div>
      <div className="form-row" style={{ marginBottom: 14 }}>
        <div className="form-field">
          <label>我的 SteamID</label>
          <input
            value={f.game_id}
            onChange={(e) => set('game_id', e.target.value.replace(/[^\d]/g, ''))}
            placeholder="仅数字，方便队友加好友"
            inputMode="numeric"
          />
        </div>
        <div className="form-field">
          <label>我的天梯分</label>
          <input
            type="number"
            value={f.my_score}
            onChange={(e) => {
              const v = e.target.value;
              setF((prev) => ({ ...prev, my_score: v, my_rank: rankOf(v) || prev.my_rank }));
            }}
            placeholder="如 4520"
          />
        </div>
      </div>
      <div className="form-field" style={{ marginBottom: 14 }}>
        <label>
          我的段位 <span className="field-note">（按分数自动换算，也可手动选）</span>
        </label>
        <select value={f.my_rank} onChange={(e) => set('my_rank', e.target.value)}>
          <option value="">未填写</option>
          {TIERS.map((t) => (
            <option key={t.key} value={t.label}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field" style={{ marginBottom: 14 }}>
        <label>我擅长的位置（可多选）</label>
        <div className="chips">
          {POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              className={'chip' + (f.my_positions.includes(p) ? ' active' : '')}
              onClick={() => set('my_positions', toggle(f.my_positions, p))}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="party-section-label">③ 希望队友的水平</div>
      <div className="form-row" style={{ marginBottom: 14 }}>
        <div className="form-field">
          <label>队友段位</label>
          <select value={f.want_rank} onChange={(e) => set('want_rank', e.target.value)}>
            <option value="">不限</option>
            {TIERS.map((t) => (
              <option key={t.key} value={t.label}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>队友分数区间（留空为不限）</label>
          <div className="party-range">
            <input
              type="number"
              value={f.want_score_min}
              onChange={(e) => set('want_score_min', e.target.value)}
              placeholder="最低"
            />
            <span>~</span>
            <input
              type="number"
              value={f.want_score_max}
              onChange={(e) => set('want_score_max', e.target.value)}
              placeholder="最高"
            />
          </div>
        </div>
      </div>
      <div className="form-field" style={{ marginBottom: 14 }}>
        <label>队友位置（可多选，留空为不限）</label>
        <div className="chips">
          {POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              className={'chip' + (f.want_positions.includes(p) ? ' active' : '')}
              onClick={() => set('want_positions', toggle(f.want_positions, p))}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="party-section-label">④ 人数、时间与语音</div>
      <div className="form-field" style={{ marginBottom: 14 }}>
        <label>需要几个人（含你自己）</label>
        <div className="chips">
          {NEED_PLAYER_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              className={'chip' + (Number(f.need_players) === n ? ' active' : '')}
              onClick={() => set('need_players', n)}
            >
              {n} 人
            </button>
          ))}
        </div>
        <div className="party-need-row">
          <input
            type="number"
            min="1"
            max="20"
            value={f.need_players}
            onChange={(e) => set('need_players', e.target.value)}
            aria-label="需要几个人"
          />
          <span>人 · 可直接输入 1~20（对黑一般填 10）</span>
        </div>
      </div>
      <div className="form-row" style={{ marginBottom: 8 }}>
        <div className="form-field">
          <label>开始时间</label>
          <input
            type="datetime-local"
            value={f.start_at}
            onChange={(e) => set('start_at', e.target.value)}
          />
        </div>
        <div className="form-field">
          <label>持续多久</label>
          <select value={f.duration_min} onChange={(e) => set('duration_min', e.target.value)}>
            {DURATION_OPTIONS.map((o) => (
              <option key={o.min} value={o.min}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="party-hint">超过「开始时间 + 持续时间」后，卡片会自动标记为已过期。</div>
      <div className="form-row" style={{ marginBottom: 14 }}>
        <div className="form-field">
          <label>是否有语音</label>
          <select
            value={f.has_voice ? 'yes' : 'no'}
            onChange={(e) => set('has_voice', e.target.value === 'yes')}
          >
            <option value="yes">有语音</option>
            <option value="no">不开语音</option>
          </select>
        </div>
        <div className="form-field">
          <label>语音软件</label>
          <select
            value={f.voice_app}
            onChange={(e) => set('voice_app', e.target.value)}
            disabled={!f.has_voice}
          >
            <option value="">未指定</option>
            {VOICE_APPS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-field" style={{ marginBottom: 16 }}>
        <label>备注</label>
        <textarea
          rows={3}
          value={f.note}
          onChange={(e) => set('note', e.target.value)}
          placeholder="想玩的英雄、能不能开麦、能不能补位……"
        />
      </div>

      <div className="party-form-foot">
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              发布中…
            </>
          ) : (
            '发布开黑卡片'
          )}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          取消
        </button>
        <span className="party-form-hint">
          发布后会显示你的选手昵称，其他人可点进你的资料页
        </span>
      </div>
    </div>
  );
}
