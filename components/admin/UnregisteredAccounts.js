import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost } from '../../lib/api-client.mjs';

/**
 * 未登记的参赛账号。
 *
 * 补录比赛时会出现「打了比赛但没绑定群友」的账号（替补 / 小号 / 没登记过），
 * 赛程里显示成裸账号 + "?" 头像。这里把它们列出来，标清楚缺什么，
 * 让管理员手动补：要么绑到已有群友，要么直接新建一个。
 *
 * 数据来自 /api/admin/unregistered-accounts（会顺带拉 Steam 昵称）。
 */
export default function UnregisteredAccounts({ onChanged }) {
  const [data, setData] = useState({ accounts: [], players: [] });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  /* accountId → { pick: playerId, nick: 新建昵称 } */
  const [draft, setDraft] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/admin/unregistered-accounts');
      setData({ accounts: d.accounts || [], players: d.players || [] });
    } catch (e) {
      setMsg({ type: 'err', text: '读取失败：' + e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (acc, mode) => {
    const d = draft[acc.account_id] || {};
    const body =
      mode === 'bind'
        ? { accountId: acc.account_id, playerId: d.pick }
        : mode === 'repair'
          ? { accountId: acc.account_id, playerId: acc.owner.id }
          : { accountId: acc.account_id, nickname: d.nick };
    if (mode === 'bind' && !body.playerId) {
      setMsg({ type: 'err', text: '先选一个群友' });
      return;
    }
    if (mode === 'new' && !String(body.nickname || '').trim()) {
      setMsg({ type: 'err', text: '先填昵称' });
      return;
    }

    setBusy(acc.account_id);
    setMsg(null);
    try {
      const r = await apiPost('/api/admin/unregistered-accounts', body);
      setMsg({
        type: 'ok',
        text: `已补录 ${acc.account_id}：回填 ${r.backfilled} 条比赛明细`,
      });
      setDraft((prev) => ({ ...prev, [acc.account_id]: {} }));
      await load();
      if (onChanged) onChanged();
    } catch (e) {
      setMsg({ type: 'err', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const accounts = data.accounts || [];
  if (!loading && accounts.length === 0) return null;

  return (
    <section className="unreg">
      <div className="unreg-head">
        <button
          type="button"
          className="unreg-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="unreg-caret">{open ? '▾' : '▸'}</span>
          未登记的参赛账号
          <span className="unreg-count">{accounts.length}</span>
        </button>
        <span className="unreg-hint">
          这些账号打过比赛但没绑定群友，赛程里显示为裸账号 + 「?」头像。补录后比赛明细会自动回填。
        </span>
        <button type="button" className="unreg-refresh" onClick={load} disabled={loading}>
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>

      {msg && (
        <div className={msg.type === 'err' ? 'unreg-msg err' : 'unreg-msg ok'}>{msg.text}</div>
      )}

      {open && (
        <div className="unreg-table">
          <div className="unreg-row unreg-row-head">
            <span>账号</span>
            <span>Steam 昵称</span>
            <span>场次</span>
            <span>出现赛事</span>
            <span>补录</span>
          </div>

          {accounts.map((acc) => {
            const d = draft[acc.account_id] || {};
            const free = (data.players || []).filter((p) => !p.game_id);
            return (
              <div className="unreg-row" key={acc.account_id}>
                <span className="unreg-acc">{acc.account_id}</span>
                <span className={acc.persona_name ? '' : 'unreg-muted'}>
                  {acc.persona_name || '（未取到）'}
                </span>
                <span className="unreg-num">
                  {acc.games}
                  {acc.standin_games > 0 && (
                    <i title="其中替补上场">{` / 替补 ${acc.standin_games}`}</i>
                  )}
                </span>
                <span className="unreg-muted">{(acc.tournaments || []).join('、') || '—'}</span>

                <span className="unreg-actions">
                  {acc.owner ? (
                    /* 早就绑了 SteamID，只是历史明细没关联 —— 只需回填，不涉及绑定 */
                    <>
                      <span className="unreg-owner">已绑定：{acc.owner.nickname}</span>
                      <button
                        type="button"
                        className="unreg-btn"
                        disabled={busy === acc.account_id}
                        onClick={() => submit(acc, 'repair')}
                      >
                        回填明细
                      </button>
                    </>
                  ) : (
                    <>
                      <select
                        className="unreg-select"
                        value={d.pick || ''}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [acc.account_id]: { ...prev[acc.account_id], pick: e.target.value },
                          }))
                        }
                      >
                        <option value="">绑定到群友…</option>
                        {free.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nickname}
                            {p.group_nickname && p.group_nickname !== p.nickname
                              ? `（${p.group_nickname}）`
                              : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="unreg-btn"
                        disabled={busy === acc.account_id}
                        onClick={() => submit(acc, 'bind')}
                      >
                        绑定
                      </button>

                      <span className="unreg-or">或</span>

                      <input
                        className="unreg-input"
                        placeholder="新群友昵称"
                        value={d.nick || ''}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [acc.account_id]: { ...prev[acc.account_id], nick: e.target.value },
                          }))
                        }
                      />
                      <button
                        type="button"
                        className="unreg-btn"
                        disabled={busy === acc.account_id}
                        onClick={() => submit(acc, 'new')}
                      >
                        新建
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
