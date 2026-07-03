import { useState, memo } from 'react';
import useAIAnalysis from '../hooks/useAIAnalysis';

const getScoreClass = (score) => {
  if (score >= 20000) return 'score-master';
  if (score >= 15000) return 'score-diamond';
  if (score >= 10000) return 'score-platinum';
  if (score >= 5000) return 'score-gold';
  return 'score-silver';
};

const getScoreAccentColor = (score) => {
  if (score >= 20000) return '#e11d48';
  if (score >= 15000) return '#7c3aed';
  if (score >= 10000) return '#3b8fd4';
  if (score >= 5000) return '#16a34a';
  return '#94a3b8';
};

const PlayerCard = memo(function PlayerCard({ player, onRemove, onJoinTeam, onEdit, onCopy, onDelete, isSimplified = false, isModalView = false, className = '', playerNameMap }) {
  const [playerStats, setPlayerStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [errorStats, setErrorStats] = useState(null);
  const { analyzing, analysis, error: aiError, runAnalysis, clearAnalysis } = useAIAnalysis();
  const [fetchingForAI, setFetchingForAI] = useState(false);

  const fetchPlayerStats = async () => {
    if (playerStats || loadingStats) return;

    setLoadingStats(true);
    setErrorStats(null);
    try {
      const response = await fetch(`/api/player-stats?playerId=${player.game_id}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.stats) {
        setPlayerStats(data.stats);
        return data.stats;
      } else {
        throw new Error('响应数据格式不正确');
      }
    } catch (error) {
      console.error('获取玩家统计数据失败:', error);
      setErrorStats(error.message);
      return null;
    } finally {
      setLoadingStats(false);
    }
  };

  const handleAIAnalysis = async (options = {}) => {
    setFetchingForAI(true);
    let stats = playerStats;
    if (!stats) {
      stats = await fetchPlayerStats();
    }
    setFetchingForAI(false);

    const synergyNames = (player.synergy_players || []).map(id => playerNameMap?.get(id) || id);
    runAnalysis('player', {
      player: { ...player, synergy_names: synergyNames },
      stats,
    }, player.id, options);
  };

  const handleCopyGameID = () => {
    navigator.clipboard.writeText(player.game_id);
    alert('steamID已复制到剪贴板');
  };

  const handleDelete = () => {
    if (window.confirm(`确定要删除选手 "${player.nickname}" 吗？此操作不可撤销。`)) {
      if (onDelete) {
        onDelete(player.id);
      } else if (onRemove) {
        onRemove(player.id);
      }
    }
  };

  // Modal view: ultra-compact for selector lists
  if (isModalView) {
    return (
      <div className="player-card modal-view">
        <div className="player-header">
          <div className="player-info">
            <div className="player-basic-info">
              <div className="player-nickname">{player.nickname}</div>
              <div className="player-game-id">{player.game_id}</div>
              {player.group_nickname && (
                <div className="player-group-nickname">{player.group_nickname}</div>
              )}
            </div>
            <div className={`player-score ${getScoreClass(player.score)}`}>
              {player.score}
            </div>
          </div>

          <div className="player-positions">
            {player.positions && player.positions.map((position, index) => (
              <span key={index} className="position-tag">{position}</span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Simplified view: inside team cards
  if (isSimplified) {
    return (
      <div className="player-card simplified">
        <div className="player-header">
          <div className="player-info">
            <div className="player-basic-info">
              <div className="player-nickname">{player.nickname}</div>
              <div className="player-group-nickname">天梯分:{player.score}</div>
            </div>
          </div>

          <div className="player-positions">
            {player.positions && player.positions.map((position, index) => (
              <span key={index} className="position-tag">{position}</span>
            ))}
          </div>

          <div className="player-stats">
            {player.championships > 0 && (
              <div className="stat-item">
                <span className="stat-label">冠军:</span>
                <span className="stat-value">{player.championships}个</span>
              </div>
            )}
          </div>
        </div>

        <div className="simplified-player-actions">
          <button
            className="player-action-btn copy-btn small"
            onClick={handleCopyGameID}
            title="复制steamID"
          >
            📋
          </button>
          {onRemove && (
            <button
              className="player-action-btn delete-btn small"
              onClick={handleDelete}
              title="从队伍中移除"
            >
              ×
            </button>
          )}
        </div>
      </div>
    );
  }

  // Full card view
  return (
    <div
      className={`player-card ${className}`}
      style={{ borderLeft: `3px solid ${getScoreAccentColor(player.score)}` }}
    >
      {onRemove && (
        <button className="remove-player" onClick={() => onRemove(player.id)}>×</button>
      )}
      <div className="player-header">
        <div className="player-name">{player.nickname}</div>
        <div className={`player-score ${getScoreClass(player.score)}`}>
          {player.score}
        </div>
      </div>

      <div className="player-info">
        <div className="player-info-item">
          <span className="player-info-label">steamID</span>
          <span className="player-info-value">{player.game_id}</span>
        </div>
        {player.group_nickname && (
          <div className="player-info-item">
            <span className="player-info-label">群昵称</span>
            <span className="player-info-value">{player.group_nickname}</span>
          </div>
        )}
      </div>

      <div className="position-tags">
        {player.positions?.map((position, index) => (
          <span key={index} className="position-tag">{position}</span>
        ))}
      </div>

      {player.heroes && player.heroes.length > 0 && (
        <div className="player-heroes-preview">
          <div className="info-label">擅长英雄</div>
          <div className="info-content">
            {player.heroes.slice(0, 3).map((hero, index) => (
              <span key={index} className="hero-tag small">{hero}</span>
            ))}
            {player.heroes.length > 3 && (
              <span className="hero-tag small more">+{player.heroes.length - 3}</span>
            )}
          </div>
        </div>
      )}

      {player.synergy_players && player.synergy_players.length > 0 && (
        <div className="player-synergy-preview">
          <div className="info-label">默契选手</div>
          <div className="info-content">
            {player.synergy_players.slice(0, 3).map((partnerId, index) => (
              <span key={index} className="hero-tag small">
                {playerNameMap?.get(partnerId) || partnerId}
              </span>
            ))}
            {player.synergy_players.length > 3 && (
              <span className="hero-tag small more">+{player.synergy_players.length - 3}</span>
            )}
          </div>
        </div>
      )}

      <div className="player-stats">
        {player.win_rate > 0 && (
          <div className="stat-item">
            <span className="stat-label">胜率</span>
            <span className="stat-value">{player.win_rate}%</span>
          </div>
        )}
        {player.championships > 0 && (
          <div className="stat-item">
            <span className="stat-label">冠军</span>
            <span className="stat-value">{player.championships}个</span>
          </div>
        )}
      </div>

      <div className="player-detailed-stats">
        {!playerStats && (
          <button className="stats-toggle-btn" onClick={fetchPlayerStats} disabled={loadingStats}>
            {loadingStats ? '加载中...' : '查看详细数据'}
          </button>
        )}

        {loadingStats && (
          <div className="detailed-stats-content">
            <div className="skeleton skeleton-line wide" style={{ height: 16, marginBottom: 12 }} />
            <div className="skeleton skeleton-line medium" style={{ height: 14, marginBottom: 8 }} />
            <div className="skeleton skeleton-line narrow" style={{ height: 14 }} />
          </div>
        )}

        {errorStats && (
          <div className="error-message">数据加载失败</div>
        )}

        {playerStats && (
          <div className="detailed-stats-content">
            <div className="stat-section">
              <h4>近期数据 (近{playerStats.recentTotal}场)</h4>
              <div className="stats-summary-grid">
                <div className="stats-summary-item">
                  <span className="stats-summary-value">{playerStats.recentWinRate}%</span>
                  <span className="stats-summary-label">胜率 ({playerStats.recentWins}胜)</span>
                </div>
                <div className="stats-summary-item">
                  <span className="stats-summary-value">{playerStats.avgGpm || 'N/A'}</span>
                  <span className="stats-summary-label">平均GPM</span>
                </div>
                <div className="stats-summary-item">
                  <span className="stats-summary-value">{playerStats.avgKda || 'N/A'}</span>
                  <span className="stats-summary-label">KDA</span>
                </div>
                <div className="stats-summary-item">
                  <span className="stats-summary-value">{playerStats.avgHeroDamage || 'N/A'}</span>
                  <span className="stats-summary-label">均英雄伤害</span>
                </div>
              </div>
            </div>

            {playerStats.recentMatches && playerStats.recentMatches.length > 0 && (
              <div className="stat-section">
                <h4>近期比赛记录</h4>
                <div className="recent-matches-list">
                  {playerStats.recentMatches.slice(0, 10).map((m, i) => (
                    <div key={i} className={`recent-match-item ${m.isWin ? 'match-win' : 'match-lose'}`}>
                      <span className="match-hero">{m.hero}</span>
                      <span className="match-type">{m.lobbyType}</span>
                      <span className="match-kda">KDA {m.kda}</span>
                      <span className="match-gpm">GPM {m.gpm}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="stat-section">
              <h4>场次最多英雄 (近100场)</h4>
              <div className="heroes-list">
                {playerStats.mostPlayedHeroes.map((hero, index) => (
                  <div key={index} className="hero-stat-item">
                    <span className="hero-name">{hero.name}</span>
                    <span className="hero-stats">{hero.matches}场 / {hero.winRate}%胜率</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="stat-section">
              <h4>胜率最高英雄 (近100场)</h4>
              <div className="heroes-list">
                {playerStats.highestWinRateHeroes.map((hero, index) => (
                  <div key={index} className="hero-stat-item">
                    <span className="hero-name">{hero.name}</span>
                    <span className="hero-stats">{hero.matches}场 / {hero.winRate}%胜率</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI Analysis section */}
      <div className="ai-analysis-section">
        {!analysis && !analyzing && !fetchingForAI && (
          <button
            className="ai-analysis-btn"
            onClick={handleAIAnalysis}
            disabled={fetchingForAI}
          >
            🤖 AI 分析
          </button>
        )}

        {(analyzing || fetchingForAI) && (
          <div className="ai-analysis-loading">
            <div className="ai-spinner"></div>
            <span>{fetchingForAI ? '获取比赛数据中...' : 'AI 分析中...'}</span>
          </div>
        )}

        {aiError && (
          <div className="error-message">
            {aiError}
            <button className="retry-btn" onClick={clearAnalysis}>重试</button>
          </div>
        )}

        {analysis && (
          <div className="ai-analysis-result">
            <div className="ai-analysis-header">
              <span className="ai-badge">🤖 AI 分析</span>
              <button className="ai-refresh-btn" onClick={() => {
                clearAnalysis();
                handleAIAnalysis({ skipCache: true });
              }}>🔄 重新分析</button>
            </div>
            <div className="ai-analysis-text">{analysis || '（AI 返回了空内容，请重试）'}</div>
          </div>
        )}
      </div>

      <div className="player-actions">
        {onJoinTeam && (
          <button className="player-action-btn join-btn" onClick={() => onJoinTeam(player.id)} title="加入队伍">
            ➕ 入队
          </button>
        )}
        <button className="player-action-btn edit-btn" onClick={() => onEdit && onEdit(player)} title="编辑选手">
          ✏️ 编辑
        </button>
        <button className="player-action-btn copy-btn" onClick={handleCopyGameID} title="复制steamID">
          📋 复制
        </button>
        <button className="player-action-btn delete-btn" onClick={handleDelete} title="删除选手">
          🗑️ 删除
        </button>
      </div>
    </div>
  );
});

export default PlayerCard;
