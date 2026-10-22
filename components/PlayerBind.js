import { useState } from 'react';
import { tierOf } from '../lib/tier.mjs';
import { regionShort } from '../lib/regions';

/**
 * 补填选手资料面板
 *
 * 用于「账号已注册但还没绑定选手资料」的老账号：
 * 输入 SteamID → 查出库里已有的历史资料 → 选择继承，或确认没有后新建。
 */
export default function PlayerBind({ onBound }) {
  const [gameId, setGameId] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState(null); // { candidates, suggestions, totalPlayers }
  const [searchedFor, setSearchedFor] = useState('');
  const [error, setError] = useState('');

  const [bindTarget, setBindTarget] = useState(''); // 正在绑定的 player id
  const [newNickname, setNewNickname] = useState('');
  const [creating, setCreating] = useState(false);

  const search = async (e) => {
    if (e) e.preventDefault();
    const kw = gameId.trim();
    setError('');
    if (!kw) return setError('请输入 SteamID');
    setSearching(true);
    setResult(null);
    try {
      const r = await fetch('/api/profile-bind?game_id=' + encodeURIComponent(kw));
      const d = await r.json();
      if (!r.ok || !d.success) {
        setError(d.error || '查询失败');
      } else {
        setSearchedFor(kw);
        setResult(d);
        setNewNickname('');
      }
    } catch (_) {
      setError('网络错误，请稍后重试');
    } finally {
      setSearching(false);
    }
  };

  const bind = async (playerId, steamId) => {
    setError('');
    setBindTarget(playerId);
    try {
      const r = await fetch('/api/profile-bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_id: steamId, player_id: playerId }),
      });
      const d = await r.json();
      if (r.ok && d.success) {
        onBound && onBound(d);
      } else {
        setError(d.error || '绑定失败');
      }
    } catch (_) {
      setError('网络错误，请稍后重试');
    } finally {
      setBindTarget('');
    }
  };

  const create = async (e) => {
    if (e) e.preventDefault();
    setError('');
    const nick = newNickname.trim();
    if (!nick) return setError('请填写群昵称');
    setCreating(true);
    try {
      const r = await fetch('/api/profile-bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_id: searchedFor, group_nickname: nick }),
      });
      const d = await r.json();
      if (r.ok && d.success) {
        onBound && onBound(d);
      } else {
        setError(d.error || '新建失败');
      }
    } catch (_) {
      setError('网络错误，请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="side-card bind-card">
      <h2 className="bind-title">查找历史资料</h2>
      <p className="bind-lead">
        你的账号还没有关联选手资料。填写 SteamID 即可查出库里已有的历史记录——
        {result && result.totalPlayers ? `目前已有 ${result.totalPlayers} 位群友的资料` : '已有历史资料可以继承'}
        ，直接继承就不用重录一遍；如果查不到，再新建。
      </p>

      <form className="bind-search" onSubmit={search}>
        <input
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          placeholder="输入 SteamID，例如 114678450"
          inputMode="numeric"
          aria-label="SteamID"
          disabled={searching}
        />
        <button type="submit" className="btn btn-primary" disabled={searching}>
          {searching ? '查询中…' : '查找历史资料'}
        </button>
      </form>

      {error && <div className="adm-error" style={{ marginTop: 14 }}>{error}</div>}

      {/* ---- 命中：可以选择继承 ---- */}
      {result && result.candidates.length > 0 && (
        <div className="bind-hits">
          <div className="bind-hits-head">
            找到 {result.candidates.length} 条匹配资料，确认是你本人即可继承
          </div>
          {result.candidates.map((c) => {
            const takenByOther = !!c.bound_by;
            return (
              <div className="bind-hit" key={c.id}>
                <div className="bind-hit-top">
                  <div className="p-avatar">{(c.nickname || c.group_nickname || '?').slice(0, 1)}</div>
                  <div className="bind-hit-id">
                    <div className="bind-hit-name">{c.nickname || c.group_nickname || '未命名'}</div>
                    <div className="bind-hit-meta">
                      SteamID {c.game_id}
                      {c.group_nickname && c.group_nickname !== c.nickname ? ` · 群昵称 ${c.group_nickname}` : ''}
                      {c.region ? ` · ${regionShort(c.region)}` : ''}
                    </div>
                  </div>
                  {c.score ? (
                    <span className={'p-score ' + tierOf(c.score).cls}>{c.score}</span>
                  ) : null}
                </div>

                {c.positions.length > 0 && (
                  <div className="bind-hit-chips">
                    {c.positions.map((p, i) => (
                      <span className="p-tag" key={i}>{p}</span>
                    ))}
                  </div>
                )}
                {c.heroes.length > 0 && (
                  <div className="bind-hit-chips">
                    {c.heroes.map((h, i) => (
                      <span className="hero-chip" key={i}>{h}</span>
                    ))}
                  </div>
                )}
                {c.self_intro && <div className="bind-hit-intro">{c.self_intro}</div>}

                <div className="bind-hit-foot">
                  <div className="bind-hit-stats">
                    {c.tournament_count > 0 ? `参加过 ${c.tournament_count} 届比赛` : '暂无参赛记录'}
                    {takenByOther && <span className="bind-taken"> · 已被账号「{c.bound_by}」绑定</span>}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={takenByOther || bindTarget === c.id}
                    onClick={() => bind(c.id, c.game_id)}
                  >
                    {bindTarget === c.id ? '绑定中…' : takenByOther ? '已被占用' : '继承并绑定'}
                  </button>
                </div>
              </div>
            );
          })}
          <div className="bind-foot-note">
            这些都不是你？下滑到下方新建一份资料。
          </div>
        </div>
      )}

      {/* ---- 没命中：给近似建议 + 新建 ---- */}
      {result && result.candidates.length === 0 && (
        <>
          <div className="bind-empty">
            没有找到 SteamID <b>{searchedFor}</b> 的历史资料。
          </div>

          {result.suggestions.length > 0 && (
            <div className="bind-suggest-wrap">
              <div className="bind-suggest-label">相近的资料，是不是其中之一？</div>
              <div className="bind-suggest">
                {result.suggestions.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => {
                      setGameId(s.game_id || '');
                      setResult(null);
                      setSearchedFor('');
                    }}
                  >
                    {s.nickname || s.group_nickname} · {s.game_id}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form className="bind-create" onSubmit={create}>
            <div className="bind-create-head">都不是？新建一份选手资料</div>
            <div className="form-field">
              <label>群昵称（必填，会显示在群友列表里）</label>
              <input
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                placeholder="群里怎么称呼你"
                disabled={creating}
              />
            </div>
            <div className="bind-create-foot">
              <span className="bind-create-hint">
                SteamID 将登记为 <b>{searchedFor}</b>，其余资料（地区、天梯分、英雄等）绑定后可在本页继续完善。
              </span>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? '创建中…' : '新建并绑定'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
