import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useAIAnalysis from '../../hooks/useAIAnalysis';

function tier(score) {
  if (score >= 5420) return '冠绝一世';
  if (score >= 4620) return '超凡入圣';
  if (score >= 3850) return '万古流芳';
  if (score >= 3080) return '传奇';
  if (score >= 2310) return '统帅';
  return '中军以下';
}

export default function MemberDetail() {
  const router = useRouter();
  const { id } = router.query;

  const [player, setPlayer] = useState(null);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const { analyzing, analysis, error: aiError, runAnalysis } = useAIAnalysis();

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetch('/api/players')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const list = d.players || [];
        setPlayers(list);
        const p = list.find((x) => String(x.id) === String(id));
        if (p) setPlayer(p);
        else setNotFound(true);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setNotFound(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const nameMap = useMemo(() => {
    const m = new Map();
    players.forEach((p) => m.set(String(p.id), p.nickname));
    return m;
  }, [players]);

  const handleAI = async () => {
    if (!player) return;
    let s = stats;
    if (!s && player.game_id) {
      setLoadingStats(true);
      try {
        const r = await fetch('/api/player-stats?playerId=' + player.game_id);
        const d = await r.json();
        if (d.stats) {
          s = d.stats;
          setStats(d.stats);
        }
      } catch (e) {
        // ignore
      } finally {
        setLoadingStats(false);
      }
    }
    const synergyNames = (player.synergy_players || []).map((x) => nameMap.get(String(x)) || x);
    runAnalysis('player', { player: { ...player, synergy_names: synergyNames }, stats: s }, player.id);
  };

  if (loading) return <div className="empty" style={{ padding: '110px 0' }}>加载中…</div>;
  if (notFound || !player) {
    return (
      <div className="empty" style={{ padding: '110px 0' }}>
        没有找到这位群友。
        <br />
        <Link href="/members" style={{ color: 'var(--brand)', fontWeight: 600 }}>
          返回群友列表
        </Link>
      </div>
    );
  }

  const score = Number(player.score) || 0;
  return (
    <>
      <Head>
        <title>{player.nickname} · 群友详情 · DOTA 群英荟</title>
      </Head>

      <section className="page-hero">
        <div className="wrap">
          <Link href="/members" className="back-link">
            ← 返回群友列表
          </Link>
          <div className="detail-head">
            <div className="detail-avatar">{(player.nickname || '?').slice(0, 1)}</div>
            <div>
              <h1 style={{ fontSize: '1.9rem' }}>{player.nickname || '未命名'}</h1>
              <div className="detail-sub">
                steamID {player.game_id || '—'}
                {player.group_nickname ? ' · 群昵称 ' + player.group_nickname : ''}
              </div>
            </div>
            <div className="detail-score">
              <div className="n">{score}</div>
              <div className="l">{tier(score)}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="detail-grid">
            <div>
              <div className="side-card">
                <h4>基本信息</h4>
                <div className="kv">
                  <span className="k">擅长位置</span>
                  <span className="v">{(player.positions || []).join(' / ') || '未填写'}</span>
                </div>
                <div className="kv">
                  <span className="k">自报胜率</span>
                  <span className="v">{player.win_rate || 0}%</span>
                </div>
                <div className="kv">
                  <span className="k">冠军数</span>
                  <span className="v">{player.championships || 0} 个</span>
                </div>
              </div>

              <div className="side-card" style={{ marginTop: 18 }}>
                <h4>擅长英雄</h4>
                <div className="hero-chips">
                  {(player.heroes || []).length > 0 ? (
                    player.heroes.map((h, i) => (
                      <span className="hero-chip" key={i}>
                        {h}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>未填写</span>
                  )}
                </div>
              </div>

              <div className="side-card" style={{ marginTop: 18 }}>
                <h4>默契队友</h4>
                <div className="hero-chips">
                  {(player.synergy_players || []).length > 0 ? (
                    player.synergy_players.map((sid, i) => (
                      <Link className="hero-chip" href={'/members/' + sid} key={i}>
                        {nameMap.get(String(sid)) || sid}
                      </Link>
                    ))
                  ) : (
                    <span style={{ color: 'var(--text-3)', fontSize: '.85rem' }}>暂无</span>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className="side-card">
                <h4>🤖 AI 战力分析</h4>
                {!analysis && !analyzing && !loadingStats && (
                  <button className="btn btn-primary" onClick={handleAI}>
                    生成 AI 分析
                  </button>
                )}
                {loadingStats && <div className="empty" style={{ padding: '20px 0' }}>正在获取 OpenDota 战绩…</div>}
                {analyzing && <div className="empty" style={{ padding: '20px 0' }}>AI 分析中…</div>}
                {aiError && <div className="empty" style={{ padding: '20px 0' }}>{aiError}</div>}
                {analysis && <div className="ai-text">{analysis}</div>}
              </div>

              {stats && (
                <div className="side-card" style={{ marginTop: 18 }}>
                  <h4>近期数据</h4>
                  <div className="stats-grid">
                    <div className="stats-item">
                      <div className="v">{stats.recentWinRate ?? '-'}%</div>
                      <div className="l">近{stats.recentTotal || 0}场胜率</div>
                    </div>
                    <div className="stats-item">
                      <div className="v">{stats.avgGpm || '-'}</div>
                      <div className="l">平均 GPM</div>
                    </div>
                    <div className="stats-item">
                      <div className="v">{stats.avgKda || '-'}</div>
                      <div className="l">KDA</div>
                    </div>
                    <div className="stats-item">
                      <div className="v">{stats.avgHeroDamage || '-'}</div>
                      <div className="l">均英雄伤害</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
