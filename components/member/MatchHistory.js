import { useState, useEffect, useMemo, useCallback } from 'react';
import HeroAvatar from '../HeroAvatar';
import {
  modeTabsFor,
  summarize,
  bestOf,
  fmtDuration,
  fmtAgo,
} from '../../lib/match-format.mjs';

const PAGE_STEP = 20;

/**
 * 最近比赛：模式 tab + 版本筛选 + 近 20 场英雄格 + 对局列表。
 *
 * 数据一次性从 /api/player-matches 拿全（默认 200 场），
 * 切 tab / 版本都在本地过滤，不重新请求。
 *
 * 一个人可能有多个 Steam 号（主号 + 小号），对局是**按账号分开**的，
 * 所以多号时给一个账号切换器；默认看主号。
 */
export default function MatchHistory({ accountId, accounts }) {
  // 统一成 [{ accountId, isPrimary }]，兼容老调用方只传 accountId 的情况
  const accountList = useMemo(() => {
    const list = (accounts || [])
      .map((a) => (a && typeof a === 'object' ? a : { accountId: a }))
      .map((a) => ({ accountId: String(a.accountId || '').trim(), isPrimary: !!a.isPrimary }))
      .filter((a) => a.accountId);
    if (list.length === 0 && accountId) return [{ accountId: String(accountId), isPrimary: true }];
    return list;
  }, [accounts, accountId]);

  const primaryAccount = useMemo(() => {
    const hit = accountList.find((a) => a.isPrimary);
    return (hit || accountList[0] || {}).accountId || '';
  }, [accountList]);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 折叠状态记在 localStorage（与 AI 分析面板同款体验），默认展开
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem('match_history_open') !== '0';
    } catch {
      return true;
    }
  });
  const [acc, setAcc] = useState(primaryAccount);
  const [mode, setMode] = useState('all');
  const [patch, setPatch] = useState('all');
  const [shown, setShown] = useState(PAGE_STEP);

  const load = useCallback(
    (silent) => {
      if (!acc) {
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      setError('');
      fetch('/api/player-matches?accountId=' + encodeURIComponent(acc))
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok || !d || d.success === false) {
            setError((d && d.error) || '没能拿到对局数据');
            setData(null);
          } else {
            setData(d);
          }
        })
        .catch(() => setError('网络错误，稍后重试'))
        .finally(() => setLoading(false));
    },
    [acc]
  );

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem('match_history_open', next ? '1' : '0');
      } catch {
        /* 隐私模式下写不了，忽略 */
      }
      return next;
    });
  };

  useEffect(() => {
    load(false);
  }, [load]);

  // 换账号后筛选口径完全不同（版本集合都不一样），回到默认
  useEffect(() => {
    setMode('all');
    setPatch('all');
  }, [acc]);

  // 换筛选条件后从第一屏重新看起
  useEffect(() => {
    setShown(PAGE_STEP);
  }, [mode, patch]);

  const matches = useMemo(() => (data && data.matches) || [], [data]);

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      if (mode !== 'all' && m.modeKey !== mode) return false;
      if (patch !== 'all' && m.patch !== patch) return false;
      return true;
    });
  }, [matches, mode, patch]);

  const summary = useMemo(() => summarize(filtered), [filtered]);
  const best = useMemo(() => bestOf(filtered), [filtered]);
  const recent20 = useMemo(() => filtered.slice(0, 20), [filtered]);

  if (!primaryAccount) {
    return (
      <div className="side-card mh">
        <h4>最近比赛</h4>
        <div className="empty" style={{ padding: '24px 0' }}>
          这位群友还没绑定 SteamID，拿不到比赛数据。
        </div>
      </div>
    );
  }

  return (
    <div className="side-card mh">
      {/* 头部即折叠开关：收起状态存 localStorage，展开后内容与原来一致 */}
      <button
        type="button"
        className={'mh-head' + (open ? ' open' : '')}
        onClick={toggleOpen}
        aria-expanded={open}
      >
        <h4>最近比赛</h4>
        <span className="mh-src">来自 OpenDota</span>
        <span className="ai-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
      <>

      {/* 多个 Steam 号时给切换器：对局按账号分开，主号没数据也能看小号 */}
      {accountList.length > 1 && (
        <div className="mh-accounts">
          <span className="mh-accounts-label">Steam 账号</span>
          {accountList.map((a) => (
            <button
              type="button"
              key={a.accountId}
              className={'mh-acc' + (a.accountId === acc ? ' on' : '')}
              onClick={() => setAcc(a.accountId)}
              title={a.isPrimary ? '主号' : '备用号'}
            >
              {a.isPrimary && <i className="mh-acc-tag">主</i>}
              {a.accountId}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="empty" style={{ padding: '36px 0' }}>正在拉取对局…</div>}

      {!loading && error && (
        <div className="empty" style={{ padding: '28px 0', lineHeight: 1.8 }}>
          {error}
          <br />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => load(false)}>
            重试
          </button>
        </div>
      )}

      {!loading && !error && matches.length === 0 && (
        <div className="empty" style={{ padding: '28px 0', lineHeight: 1.9 }}>
          OpenDota 里没有这个账号的对局记录。
          <br />
          <span style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>
            常见原因：游戏内未开启「公开比赛数据」，或 OpenDota 还没抓取过这个账号。
          </span>
        </div>
      )}

      {!loading && !error && matches.length > 0 && (
        <>
          {/* 模式 tab：计数用全量，切换不抖动 */}
          <div className="mh-tabs">
            {modeTabsFor(data.modeCounts).map((t) => {
              const n = t.key === 'all' ? matches.length : data.modeCounts[t.key] || 0;
              return (
                <button
                  type="button"
                  key={t.key}
                  className={'mh-tab' + (mode === t.key ? ' on' : '')}
                  onClick={() => setMode(t.key)}
                  disabled={n === 0}
                >
                  {t.label}
                  <i>{n}</i>
                </button>
              );
            })}
          </div>

          <div className="mh-toolbar">
            <select
              className="mh-select"
              value={patch}
              onChange={(e) => setPatch(e.target.value)}
              aria-label="按版本筛选"
            >
              <option value="all">全部版本（{matches.length}）</option>
              {(data.patchOptions || []).map((p) => (
                <option value={p.name} key={p.name}>
                  {p.name}（{p.count}）
                </option>
              ))}
            </select>
            <button type="button" className="mh-refresh" onClick={() => load(true)} title="重新拉取">
              刷新
            </button>
            {data.lifetime && (
              <span className="mh-lifetime">
                生涯 {data.lifetime.win} 胜 / {data.lifetime.lose} 负 · {data.lifetime.winRate}%
              </span>
            )}
          </div>

          <div className="mh-summary">
            <div className="mh-sum-main">
              <div className="n">
                {summary.total}
                <i>场</i>
              </div>
              <div className="l">
                胜率 {summary.winRate}% · 平均 {fmtDuration(summary.avgDuration)}
              </div>
            </div>
            <div className="mh-sum-cells">
              <div>
                <b className="win">{summary.wins}</b>
                <span>胜场</span>
              </div>
              <div>
                <b className="lose">{summary.losses}</b>
                <span>负场</span>
              </div>
              <div>
                <b>{summary.kda}</b>
                <span>KDA</span>
              </div>
            </div>
          </div>

          <div className="mh-best">
            <span className="mh-best-t">近 20 场最高</span>
            <span className="mh-best-i">
              击杀 <b>{best.kills}</b>
            </span>
            <span className="mh-best-i">
              KDA <b>{best.kda}</b>
            </span>
            <span className="mh-best-i">
              助攻 <b>{best.assists}</b>
            </span>
          </div>

          <div className="mh-grid">
            {recent20.map((m) => (
              <a
                className={'mh-tile ' + (m.isWin ? 'win' : 'lose')}
                key={m.matchId}
                href={'https://www.opendota.com/matches/' + m.matchId}
                target="_blank"
                rel="noreferrer"
                title={`${m.hero} · ${m.kills}/${m.deaths}/${m.assists} · ${m.isWin ? '胜' : '负'} · ${m.patch}`}
              >
                <HeroAvatar name={m.hero} className="mh-hero" eager />
                <i>{m.isWin ? '胜' : '负'}</i>
              </a>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="empty" style={{ padding: '26px 0' }}>
              当前筛选下没有对局。
              <br />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setMode('all');
                  setPatch('all');
                }}
              >
                重置筛选
              </button>
            </div>
          )}

          {filtered.length > 0 && (
          <div className="mh-list">
            <div className="mh-row mh-row-head">
              <div>结果</div>
              <div>英雄</div>
              <div>KDA</div>
              <div>模式 · 时长</div>
              <div>版本</div>
              <div>段位</div>
            </div>
            {filtered.slice(0, shown).map((m) => (
              <a
                className="mh-row"
                key={m.matchId}
                href={'https://www.opendota.com/matches/' + m.matchId}
                target="_blank"
                rel="noreferrer"
              >
                <div className={'mh-res ' + (m.isWin ? 'win' : 'lose')}>
                  <b>{m.isWin ? '胜利' : '失败'}</b>
                  <span>{fmtAgo(m.startTime)}</span>
                </div>
                <div className="mh-hero-cell">
                  <HeroAvatar name={m.hero} className="mh-hero" />
                  <span>{m.hero}</span>
                </div>
                <div className="mh-kda">
                  {m.kills}/{m.deaths}/{m.assists}
                  <i>{m.kda}</i>
                </div>
                <div className="mh-mode">
                  {m.modeLabel}
                  <span>{fmtDuration(m.duration)}</span>
                </div>
                <div className="mh-patch">{m.patch || '—'}</div>
                <div className="mh-rank">{m.rankLabel || '—'}</div>
              </a>
            ))}
          </div>
          )}

          {shown < filtered.length && (
            <button type="button" className="mh-more" onClick={() => setShown((s) => s + PAGE_STEP)}>
              显示更多（还有 {filtered.length - shown} 场）
            </button>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
