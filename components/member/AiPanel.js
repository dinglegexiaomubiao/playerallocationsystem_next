import { useState, useCallback } from 'react';
import Link from 'next/link';
import useAIAnalysis from '../../hooks/useAIAnalysis';

const OPEN_KEY = 'member_ai_open';

/**
 * 侧边栏里的 AI 战力分析，可收起/展开。
 *
 * 收起状态记在 localStorage：谁不想看这块，收起一次就一直收着，不会每次进页面又弹回来。
 * 生成分析时才去拉 /api/player-stats（OpenDota 的近期数据），避免打开页面就白等一个外部请求。
 */
export default function AiPanel({ player, nameMap, me, sessionReady, loginHref }) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const { analyzing, analysis, error, runAnalysis } = useAIAnalysis();

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
      } catch {
        /* 隐私模式下写不了，忽略 */
      }
      return next;
    });
  };

  const handleAI = useCallback(async () => {
    if (!player) return;
    let s = stats;
    if (!s && player.game_id) {
      setLoadingStats(true);
      try {
        const r = await fetch('/api/player-stats?playerId=' + player.game_id);
        const d = await r.json();
        if (d && d.stats) {
          s = d.stats;
          setStats(d.stats);
        }
      } catch {
        /* 拿不到就用选手基本信息，分析仍可进行 */
      } finally {
        setLoadingStats(false);
      }
    }
    const synergyNames = (player.synergy_players || []).map((x) => nameMap.get(String(x)) || x);
    runAnalysis('player', { player: { ...player, synergy_names: synergyNames }, stats: s }, player.id);
  }, [player, stats, nameMap, runAnalysis]);

  return (
    <div className="side-card ai-panel">
      <button
        type="button"
        className={'ai-head' + (open ? ' open' : '')}
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="ai-title">🤖 AI 战力分析</span>
        <span className="ai-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="ai-body">
          {!sessionReady && <div className="empty" style={{ padding: '16px 0' }}>加载中…</div>}

          {sessionReady && !me && (
            <div className="ai-locked">
              <p>AI 分析会消耗接口额度，登录后即可使用。</p>
              <Link href={loginHref} className="btn btn-primary">
                登录后使用
              </Link>
            </div>
          )}

          {sessionReady && me && !analysis && !analyzing && !loadingStats && (
            <>
              <button className="btn btn-primary" onClick={handleAI}>
                生成 AI 分析
              </button>
              <p className="ai-hint">会读取近期对局数据，约 3~10 秒。</p>
            </>
          )}

          {loadingStats && <div className="empty" style={{ padding: '16px 0' }}>正在获取 OpenDota 战绩…</div>}
          {analyzing && <div className="empty" style={{ padding: '16px 0' }}>AI 分析中…</div>}
          {error && <div className="empty" style={{ padding: '16px 0', lineHeight: 1.7 }}>{error}</div>}
          {analysis && <div className="ai-text">{analysis}</div>}
        </div>
      )}
    </div>
  );
}
