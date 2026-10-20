import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { apiGet, apiPost, apiDelete } from '../lib/api-client.mjs';
import useSession from '../hooks/useSession';
import PositionPicker from './PositionPicker';

/* 后端存的是逗号分隔字符串，前端要数组 */
const toList = (v) =>
  Array.isArray(v) ? v : String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * 赛事报名 / 取消报名按钮。
 *
 * 报名不是一键完成：先让选手确认「本届参赛位置」和「参赛天梯分」。
 * 这两项和档案里的常玩位置/天梯分是两回事 ——
 * 一届比赛可能换位置打，分数也可能报了名才涨，所以报名时单独落一份快照。
 *
 * 规则：只要赛事还没到「已完赛」，就允许报名与退赛。
 */
export default function SignupButton({ tournamentId, locked, onChanged }) {
  const router = useRouter();
  const { ready, name } = useSession();
  const [state, setState] = useState({
    loading: true,
    loggedIn: false,
    bound: true,
    signedUp: false,
    isCaptain: false,
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  /* 确认面板：opening = 正在报名或修改本届信息 */
  const [panel, setPanel] = useState(null); // null | 'signup' | 'edit'
  const [form, setForm] = useState({ score: '', positions: [] });
  const [profile, setProfile] = useState(null);

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
      setProfile((j && j.profile) || null);
      /* 预填规则：快照有值用快照，否则用档案。
         历史批量导入的报名快照 score 是 0、positions 是空，
         那不是「确认过 0 分」，而是「没确认过」，所以按 0/空 回退档案值。 */
      if (j && j.signup) {
        setForm({
          score: Number(j.signup.score) > 0 ? j.signup.score : (j.profile?.score ?? ''),
          positions: toList(j.signup.positions).length
            ? toList(j.signup.positions)
            : toList(j.profile?.positions),
        });
      } else if (j && j.profile) {
        setForm({
          score: j.profile.score ?? '',
          positions: toList(j.profile.positions),
        });
      }
    } catch (error) {
      setState((s) => ({ ...s, loading: false }));
      setNote({ type: 'error', text: error.message });
    }
  }, [tournamentId]);

  useEffect(() => {
    if (!ready) return;
    load();
  }, [ready, load]);

  /* 打开确认面板时，重新按「已报名 → 用快照，否则用档案」填一遍。
     已报名但快照是空的历史数据（批量导入没填位置/分数），回退到档案预填，
     让选手补一次就有值了。 */
  const openPanel = (mode) => {
    setNote(null);
    if (mode === 'edit') {
      const curPos = toList(form.positions);
      const curScore = Number(form.score);
      setForm({
        // 0 视为「没确认过」，回退档案值 —— 见 load() 里的说明
        score: curScore > 0 ? form.score : (profile?.score ?? ''),
        positions: curPos.length > 0 ? curPos : toList(profile?.positions),
      });
    } else if (profile) {
      setForm({
        score: profile.score ?? '',
        positions: toList(profile.positions),
      });
    }
    setPanel(mode);
  };

  const submitSignup = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const payload = {
        score: form.score === '' || form.score === null ? null : Number(form.score),
        positions: form.positions || [],
      };
      const j = await apiPost('/api/tournaments/' + tournamentId + '/signup', payload);
      setNote({
        type: 'ok',
        text: j && j.updated ? '已更新本届参赛信息' : '报名成功',
      });
      setPanel(null);
      await load();
      if (onChanged) onChanged();
    } catch (error) {
      setNote({ type: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  };

  const cancelSignup = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await apiDelete('/api/tournaments/' + tournamentId + '/signup');
      setNote({ type: 'ok', text: '已取消报名' });
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
        <span className="signup-hint">登录并绑定选手资料后即可报名</span>
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

  /* ==================== 确认面板 ==================== */
  if (panel) {
    const isEdit = panel === 'edit';
    return (
      <div className="signup-panel">
        <div className="signup-panel-head">
          <b>{isEdit ? '修改本届参赛信息' : '报名前确认'}</b>
          <span className="signup-panel-sub">
            这两项会作为本届的参赛记录单独保存，和你个人档案里的常玩位置、天梯分互不影响。
            换位置打或分数有变动，就在这里改。
          </span>
        </div>

        <div className="signup-panel-field">
          <label>本届参赛位置</label>
          <PositionPicker
            value={form.positions}
            onChange={(next) => setForm((f) => ({ ...f, positions: next }))}
            hint="按本届实际担任的位置排序，第 1 位为主位置。"
          />
          {profile && toList(profile.positions).length > 0 && (
            <span className="signup-panel-note">
              档案里的常玩位置：{toList(profile.positions).join(' / ')}
            </span>
          )}
        </div>

        <div className="signup-panel-field">
          <label>本届参赛天梯分</label>
          <input
            type="number"
            min="0"
            max="20000"
            value={form.score ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, score: e.target.value }))}
            placeholder="填报名时的分数"
          />
          {profile && profile.score ? (
            <span className="signup-panel-note">档案里的当前分：{profile.score}</span>
          ) : null}
          {Number(form.score) > 0 &&
            Number(profile?.peak_score) > 0 &&
            Number(form.score) > Number(profile.peak_score) && (
              <span className="signup-panel-note warn">
                高于你的历史最高分 {profile.peak_score}，确认一下
              </span>
            )}
        </div>

        <div className="signup-panel-actions">
          <button type="button" className="btn btn-primary" onClick={submitSignup} disabled={busy}>
            {busy ? '提交中…' : isEdit ? '保存修改' : '确认报名'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setPanel(null)} disabled={busy}>
            取消
          </button>
          {note && (
            <span className={'signup-note ' + (note.type === 'error' ? 'is-error' : 'is-ok')}>
              {note.text}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="signup-bar">
      {state.signedUp ? (
        <>
          <span className="signup-badge">✓ 已报名</span>
          <button type="button" className="btn btn-ghost" onClick={() => openPanel('edit')} disabled={busy}>
            修改参赛信息
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={cancelSignup}
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
        <button type="button" className="btn btn-primary" onClick={() => openPanel('signup')} disabled={busy}>
          报名参赛
        </button>
      )}
      {note && <span className={'signup-note ' + (note.type === 'error' ? 'is-error' : 'is-ok')}>{note.text}</span>}
    </div>
  );
}
