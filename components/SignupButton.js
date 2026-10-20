import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { apiGet, apiPost, apiDelete } from '../lib/api-client.mjs';
import useSession from '../hooks/useSession';

/**
 * 赛事报名 / 取消报名按钮。
 *
 * 规则：只要赛事还没到「已完赛」，就允许报名与退赛。
 * 所有与云端交互的地方都有 loading 与超时提示（apiFetch 统一处理 15s 超时）。
 */
export default function SignupButton({ tournamentId, locked, onChanged }) {
  const router = useRouter();
  const { ready, name } = useSession();
  const [state, setState] = useState({ loading: true, loggedIn: false, bound: true, signedUp: false, isCaptain: false });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    if (!tournamentId) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const j = await apiGet('/api/tournaments/' + tournamentId + '/signup');
      setState({
        loading: false,
        loggedIn: Boolean(j && j.loggedIn),
        bound: j && j.bound !== false,
        signedUp: Boolean(j && j.signedUp),
        isCaptain: Boolean(j && j.isCaptain),
      });
    } catch (error) {
      setState((s) => ({ ...s, loading: false }));
      setNote({ type: 'error', text: error.message });
    }
  }, [tournamentId]);

  useEffect(() => {
    // 等 useSession 就绪再查，避免用匿名身份查一次、登录后又查一次
    if (!ready) return;
    load();
  }, [ready, load]);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    const willSignUp = !state.signedUp;
    try {
      if (willSignUp) await apiPost('/api/tournaments/' + tournamentId + '/signup');
      else await apiDelete('/api/tournaments/' + tournamentId + '/signup');
      setNote({ type: 'ok', text: willSignUp ? '报名成功' : '已取消报名' });
      await load();
      if (onChanged) onChanged();
    } catch (error) {
      setNote({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  };

  // 赛事已完赛：只留一句说明，不给操作入口
  if (locked) {
    return (
      <div className="signup-bar">
        <span className="signup-locked">赛事已结束，报名通道已关闭</span>
      </div>
    );
  }

  // 身份还没查完
  if (!ready || state.loading) {
    return (
      <div className="signup-bar">
        <button type="button" className="btn btn-ghost" disabled>
          <span className="spinner" aria-hidden="true" />
          加载中…
        </button>
      </div>
    );
  }

  if (!state.loggedIn) {
    const from = encodeURIComponent(router.asPath || '/tournaments/' + tournamentId);
    return (
      <div className="signup-bar">
        <Link href={'/login?from=' + from} className="btn btn-primary">
          登录后报名
        </Link>
        <span className="signup-hint">登录并绑定选手资料后即可一键报名</span>
      </div>
    );
  }

  if (!state.bound) {
    return (
      <div className="signup-bar">
        <Link href="/profile" className="btn btn-primary">
          去绑定选手资料
        </Link>
        <span className="signup-hint">报名需要先把账号绑定到你的选手卡片</span>
      </div>
    );
  }

  return (
    <div className="signup-bar">
      {state.signedUp ? (
        <>
          <span className="signup-badge">✓ 已报名</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={toggle}
            disabled={busy || state.isCaptain}
            title={state.isCaptain ? '队长需先在队伍中卸任才能退赛' : ''}
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
        <button type="button" className="btn btn-primary" onClick={toggle} disabled={busy}>
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" />
              报名中…
            </>
          ) : (
            '报名参赛'
          )}
        </button>
      )}
      {note && <span className={'signup-note ' + (note.type === 'error' ? 'is-error' : 'is-ok')}>{note.text}</span>}
    </div>
  );
}
