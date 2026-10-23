import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import GuildColorPicker from './GuildColorPicker';
import { LIMITS, checkText } from '../lib/moderation.mjs';
import { guildColor } from '../lib/guild-colors.mjs';

/**
 * 帮派弹窗：创建（mode="create"）与帮派管理（mode="manage"）共用一套。
 *
 * 为什么合成一个组件而不是两个：两种模式的表单字段完全一样（名称/配色/口号），
 * 差别只在「有没有成员区」和「提交走 POST 还是 PATCH」。拆成两个会把这三个字段的
 * 字数、审核、配色占用逻辑各抄一遍。
 *
 * 审核分三层（和活动一致）：
 *   1. 前端字数（实时显示）
 *   2. 前端 checkText 预检 —— 命中违禁词立刻提示，不发请求
 *   3. 服务端 checkInput + aiModerate —— 真正的拦截，前端只是省一次往返
 */
export default function GuildModal({ open, mode = 'create', guild = null, colors = {}, onClose, onSaved }) {
  const isManage = mode === 'manage';
  const [name, setName] = useState('');
  const [slogan, setSlogan] = useState('');
  const [colorKey, setColorKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // 解散的二次确认：必须原样输入帮派名才允许，防手滑
  const [dissolveOpen, setDissolveOpen] = useState(false);
  const [dissolveText, setDissolveText] = useState('');
  const [transferTo, setTransferTo] = useState(null);
  const nameRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setName(guild?.name || '');
    setSlogan(guild?.slogan || '');
    setColorKey(guild?.colorKey || '');
    setError('');
    setNotice('');
    setDissolveOpen(false);
    setDissolveText('');
    setTransferTo(null);
    const t = setTimeout(() => nameRef.current && nameRef.current.focus(), 60);
    return () => clearTimeout(t);
  }, [open, guild]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const nameLen = [...name].length;
  const sloganLen = [...slogan].length;
  const ownName = guild?.name || '';

  const submit = async () => {
    if (busy) return;
    setError('');
    setNotice('');

    const n = name.trim();
    if ([...n].length < 2) return setError('帮派名至少 2 个字');
    if (!colorKey) return setError('请选一支配色');

    // 前端预检：违禁词立刻拦，不用等一次往返。
    // 注意要逐字段检查 —— 写成 `checkText(n) || checkText(slogan)` 会短路，
    // 名称通过时根本不会检查口号。
    for (const [label, text] of [
      ['帮派名称', n],
      ['帮派口号', slogan],
    ]) {
      const hit = checkText(text);
      if (hit && hit.ok === false) {
        return setError(`「${label}」里有「${hit.category}」类内容，请修改后再提交`);
      }
    }

    setBusy(true);
    try {
      const r = await fetch('/api/guild', {
        method: isManage ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, slogan: slogan.trim(), colorKey }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setError(d.error || `保存失败（HTTP ${r.status}）`);
        return;
      }
      if (onSaved) await onSaved();
      onClose && onClose();
    } catch (e) {
      setError((e && e.message) || '网络异常');
    } finally {
      setBusy(false);
    }
  };

  const act = async (url, opts, okText) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetch(url, opts);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setError(d.error || `操作失败（HTTP ${r.status}）`);
        return false;
      }
      if (onSaved) await onSaved();
      if (okText) setNotice(okText);
      return true;
    } catch (e) {
      setError((e && e.message) || '网络异常');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (p) => {
    const done = await act(
      '/api/guild/members/' + p.playerId,
      { method: 'DELETE' },
      `已把 ${p.nickname} 移出帮派`
    );
    if (done && onSaved) await onSaved();
  };

  const doTransfer = async () => {
    if (!transferTo) return;
    const done = await act(
      '/api/guild/transfer',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: transferTo.playerId }),
      },
      `已把帮主转让给 ${transferTo.nickname}`
    );
    if (done) {
      setTransferTo(null);
      // 转让后自己不再是帮主，管理界面已经失去意义，直接关掉
      onClose && onClose();
    }
  };

  const doDissolve = async () => {
    const done = await act('/api/guild', { method: 'DELETE' });
    if (done) onClose && onClose();
  };

  const color = guildColor(colorKey);
  const members = guild?.members || [];
  const memberCount = guild?.memberCount ?? members.length;

  return (
    <div className="modal-mask" onClick={() => !busy && onClose && onClose()} role="dialog" aria-modal="true" aria-label={isManage ? '帮派管理' : '创建帮派'}>
      <div className="modal-card guild-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            {isManage ? '帮派管理' : '创建帮派'}
            {isManage && (
              <span className="guild-modal-count">
                成员 <b>{memberCount}</b> / {guild?.maxMembers || 10}
              </span>
            )}
          </h3>
          <button type="button" className="modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="guild-modal-body">
          {/* ---------- 帮派名 ---------- */}
          <div className="form-field">
            <label htmlFor="guild-name">
              帮派名称
              <span className={'guild-len' + (nameLen > LIMITS.guildName ? ' is-over' : '')}>
                {nameLen}/{LIMITS.guildName}
              </span>
            </label>
            <input
              id="guild-name"
              ref={nameRef}
              value={name}
              maxLength={LIMITS.guildName}
              onChange={(e) => setName(e.target.value)}
              placeholder="2~12 个字，比如「赤红帮」"
            />
            <div className="guild-hint">名称全站唯一，大小写和全角算同一个名字。</div>
          </div>

          {/* ---------- 配色 ---------- */}
          <div className="form-field">
            <label>帮派配色</label>
            <GuildColorPicker
              value={colorKey}
              onChange={setColorKey}
              used={colors.used || {}}
              ownName={ownName}
              disabled={busy}
            />
            <div className="guild-hint">
              {color
                ? `已选「${color.label}」。群友卡片会用这支色做一层很淡的渐变底，不然文字会看不清。`
                : '每支配色只能被一个帮派使用。'}
            </div>
          </div>

          {/* ---------- 口号 ---------- */}
          <div className="form-field">
            <label htmlFor="guild-slogan">
              帮派口号
              <span className={'guild-len' + (sloganLen > LIMITS.guildSlogan ? ' is-over' : '')}>
                {sloganLen}/{LIMITS.guildSlogan}
              </span>
            </label>
            <input
              id="guild-slogan"
              value={slogan}
              maxLength={LIMITS.guildSlogan}
              onChange={(e) => setSlogan(e.target.value)}
              placeholder="选填。一句话说明你们这帮人干什么"
            />
          </div>

          {/* ---------- 成员（仅管理模式） ---------- */}
          {isManage && (
            <div className="guild-members">
              <div className="guild-members-head">
                <h4>成员</h4>
                <span className="guild-members-count">
                  {memberCount} / {guild?.maxMembers || 10}
                </span>
              </div>
              <ul className="guild-member-list">
                {members.map((m) => {
                  return (
                    <li key={m.playerId} className="guild-member-row">
                      <Avatar className="guild-member-avatar" src={m.avatar} name={m.nickname} />
                      <span className="guild-member-name">{m.nickname}</span>
                      {m.role === 'leader' ? (
                        <span className="guild-role">帮主</span>
                      ) : (
                        <span className="guild-role is-member">成员</span>
                      )}
                      <span className="guild-member-grow" />
                      {m.role !== 'leader' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => setTransferTo(m)}
                          >
                            转让帮主
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm guild-danger"
                            disabled={busy}
                            onClick={() => removeMember(m)}
                          >
                            移除
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
                {members.length === 0 && <li className="guild-empty">还没有成员</li>}
              </ul>
              <div className="guild-hint">
                邀请成员在下一步开放。现在先把帮派建起来，群友卡片上就能看到。
              </div>
            </div>
          )}

          {error && <div className="guild-msg is-error">{error}</div>}
          {notice && <div className="guild-msg is-ok">{notice}</div>}
        </div>

        <div className="modal-actions guild-modal-actions">
          {isManage && (
            <button
              type="button"
              className="btn btn-ghost guild-danger guild-dissolve-btn"
              disabled={busy}
              onClick={() => setDissolveOpen((v) => !v)}
            >
              解散帮派
            </button>
          )}
          <span className="guild-actions-grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? '保存中…' : isManage ? '保存修改' : '创建帮派'}
          </button>
        </div>

        {/* 解散二次确认：要原样打出帮派名 */}
        {dissolveOpen && (
          <div className="guild-confirm">
            <div className="guild-confirm-body">
              <p>
                解散后成员会全部离开，配色也会释放给别的帮派。这个操作不能撤销。
                <br />
                确认请输入帮派名 <b>{ownName}</b>
              </p>
              <input
                value={dissolveText}
                onChange={(e) => setDissolveText(e.target.value)}
                placeholder={ownName}
                aria-label="输入帮派名以确认解散"
              />
            </div>
            <div className="guild-confirm-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDissolveOpen(false)} disabled={busy}>
                我再想想
              </button>
              <button
                type="button"
                className="btn btn-primary guild-danger-solid btn-sm"
                disabled={busy || dissolveText.trim() !== ownName}
                onClick={doDissolve}
              >
                确认解散
              </button>
            </div>
          </div>
        )}

        {/* 转让二次确认 */}
        {transferTo && (
          <div className="guild-confirm">
            <div className="guild-confirm-body">
              <p>
                把帮主转让给 <b>{transferTo.nickname}</b> 之后，你将变成普通成员，
                不能再管理这个帮派。
              </p>
            </div>
            <div className="guild-confirm-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTransferTo(null)} disabled={busy}>
                取消
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={doTransfer} disabled={busy}>
                确认转让
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
