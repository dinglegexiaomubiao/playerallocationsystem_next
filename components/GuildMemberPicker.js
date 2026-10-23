import { useEffect, useMemo, useState } from 'react';
import Avatar from './Avatar';
import MemberFilterPanel from './member/MemberFilterPanel';
import { LIMITS, checkText } from '../lib/moderation.mjs';
import { regionShort } from '../lib/regions';
import {
  emptyMemberFilters,
  buildRegionHeroFacets,
  buildTierFacets,
  buildScoreFacets,
  buildSearchIndex,
  filterMembers,
  countActiveFilters,
} from '../lib/member-filter.mjs';

/**
 * 邀请成员的全屏选择器。
 *
 * 复用 `/members` 那套筛选（lib/member-filter.mjs + MemberFilterPanel）——
 * 这就是 P1 把筛选逻辑抽出来的目的：帮派邀请要问的问题和群友列表完全一样
 * （「谁会打 1 号位」「南山那边有谁」），复制一份必然漂移。
 *
 * 每一行的三种状态要提前算清，别等人点了才报错：
 *   已在帮派   邀请没有意义（一人一帮）
 *   已邀请     同一帮派不能重复邀请（数据库有唯一索引兜底）
 *   可邀请     点开填一句邀请语，那句话会过审核
 */
export default function GuildMemberPicker({ open, onClose, sentInvites = [], onChanged }) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(emptyMemberFilters);
  // 正在填邀请语的那一位
  const [draftFor, setDraftFor] = useState(null);
  const [draftMsg, setDraftMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState('');
  const [notice, setNotice] = useState('');

  // 已发出的邀请：playerId -> inviteId（撤回要用 id）
  const sentMap = useMemo(() => {
    const m = new Map();
    for (const it of sentInvites) m.set(String(it.playerId), it);
    return m;
  }, [sentInvites]);

  useEffect(() => {
    if (!open) return;
    setDraftFor(null);
    setDraftMsg('');
    setRowError('');
    setNotice('');
    let alive = true;
    setLoading(true);
    fetch('/api/players', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setPlayers(Array.isArray(d && d.players) ? d.players : []);
        setError('');
      })
      .catch((e) => alive && setError((e && e.message) || '加载群友失败'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const facets = useMemo(() => buildRegionHeroFacets(players), [players]);
  const tierFacets = useMemo(() => buildTierFacets(players), [players]);
  const scoreFacets = useMemo(() => buildScoreFacets(players), [players]);
  const searchIndex = useMemo(() => buildSearchIndex(players), [players]);
  const filtered = useMemo(
    () => filterMembers(players, filters, searchIndex),
    [players, filters, searchIndex]
  );
  const activeCount = countActiveFilters(filters);

  if (!open) return null;

  const send = async (p) => {
    if (busy) return;
    setRowError('');
    const msg = draftMsg.trim();
    if (msg) {
      const hit = checkText(msg);
      if (hit && hit.ok === false) {
        setRowError(`邀请语里有「${hit.category}」类内容，改一下再发`);
        return;
      }
    }
    setBusy(true);
    try {
      const r = await fetch('/api/guild/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: p.id, message: msg }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setRowError(d.error || `邀请失败（HTTP ${r.status}）`);
        return;
      }
      setDraftFor(null);
      setDraftMsg('');
      setNotice(`已邀请 ${p.nickname}，等对方回应`);
      if (onChanged) await onChanged();
    } catch (e) {
      setRowError((e && e.message) || '网络异常');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (p) => {
    const inv = sentMap.get(String(p.id));
    if (!inv || busy) return;
    setBusy(true);
    setRowError('');
    try {
      const r = await fetch('/api/guild/invites/' + inv.id, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.success) {
        setRowError(d.error || '撤回失败');
        return;
      }
      setNotice(`已撤回对 ${p.nickname} 的邀请`);
      if (onChanged) await onChanged();
    } catch (e) {
      setRowError((e && e.message) || '网络异常');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-mask"
      onClick={() => !busy && onClose && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="邀请成员"
    >
      <div className="modal-card guild-picker" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            邀请成员
            <span className="guild-modal-count">共 {players.length} 位群友</span>
          </h3>
          <button type="button" className="modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="guild-picker-body">
          <MemberFilterPanel
            filters={filters}
            onChange={setFilters}
            players={players}
            facets={facets}
            tierFacets={tierFacets}
            scoreFacets={scoreFacets}
            resultCount={filtered.length}
            activeCount={activeCount}
            onReset={() => setFilters(emptyMemberFilters())}
            compact
          />

          {notice && <div className="guild-msg is-ok">{notice}</div>}
          {rowError && <div className="guild-msg is-error">{rowError}</div>}
          {loading && <div className="empty">加载群友…</div>}
          {!loading && error && <div className="empty">{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className="empty">
              没有符合条件的群友
              {activeCount > 0 && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 10 }}
                  onClick={() => setFilters(emptyMemberFilters())}
                >
                  清除筛选
                </button>
              )}
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <ul className="guild-picker-list">
              {filtered.map((p) => {
                const sent = sentMap.get(String(p.id));
                const inGuild = !!p.guild;
                const drafting = String(draftFor) === String(p.id);
                return (
                  <li className="guild-picker-row" key={p.id}>
                    <Avatar className="guild-picker-avatar" src={p.avatar} name={p.nickname} />
                    <div className="guild-picker-main">
                      <div className="guild-picker-name">{p.nickname || '未命名'}</div>
                      <div className="guild-picker-meta">
                        {regionShort(p.region) || '未填写地区'} · {p.score || 0} 分
                        {(p.positions || []).length > 0 && ` · ${(p.positions || []).join('/')}`}
                      </div>
                    </div>

                    <div className="guild-picker-actions">
                      {inGuild ? (
                        <span className="guild-picker-state">已在「{p.guild.name}」</span>
                      ) : sent ? (
                        <>
                          <span className="guild-picker-state is-sent">已邀请</span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => cancel(p)}
                          >
                            撤回
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => {
                            setDraftFor(p.id);
                            setDraftMsg('');
                            setRowError('');
                          }}
                        >
                          邀请
                        </button>
                      )}
                      {/* 看资料带 from，详情页的返回键就会变「返回上一级」回到个人信息 */}
                      <a className="btn btn-ghost btn-sm" href={'/members/' + p.id + '?from=/profile'}>
                        资料
                      </a>
                    </div>

                    {drafting && (
                      <div className="guild-picker-draft">
                        <input
                          value={draftMsg}
                          maxLength={LIMITS.guildInvite}
                          onChange={(e) => setDraftMsg(e.target.value)}
                          placeholder="说一句，比如「一起打天梯啊，缺个四号位」"
                          aria-label="邀请信息"
                          autoFocus
                        />
                        <span className="guild-len">
                          {[...draftMsg].length}/{LIMITS.guildInvite}
                        </span>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy}
                          onClick={() => send(p)}
                        >
                          {busy ? '发送中…' : '发送邀请'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => setDraftFor(null)}
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
