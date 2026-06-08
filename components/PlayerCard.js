import { useState } from 'react';

export default function PlayerCard({ player, onRemove, onJoinTeam, onEdit, onCopy, onDelete, isSimplified = false, isModalView = false, className = '' }) {
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

  const [playerStats, setPlayerStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [errorStats, setErrorStats] = useState(null);

  // 获取玩家详细统计数据
  const fetchPlayerStats = async () => {
    if (playerStats || loadingStats) return;
    
    setLoadingStats(true);
    setErrorStats(null);
    try {
      // 使用player.game_id作为Steam ID参数调用API
      const response = await fetch(`/api/player-stats?playerId=${player.game_id}`);
      
      // 检查响应是否成功
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.stats) {
        setPlayerStats(data.stats);
      } else {
        throw new Error('响应数据格式不正确');
      }
    } catch (error) {
      console.error('获取玩家统计数据失败:', error);
      setErrorStats(error.message);
    } finally {
      setLoadingStats(false);
    }
  };

  const handleCopyGameID = () => {
    navigator.clipboard.writeText(player.game_id);
    // 显示复制成功的提示
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

  // 弹窗中的精简版选手卡片
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

  // 精简版选手卡片
  if (isSimplified) {
    return (
      <div className="player-card simplified">
        <div className="player-header">
          <div className="player-info">
            <div className="player-basic-info">
              <div className="player-nickname">{player.nickname}</div>
              <div className="player-group-nickname">天梯分:{player.score}</div>
              {/* {player.group_nickname && (
                <div className="player-group-nickname">{player.group_nickname}</div>
              )} */}
            </div>
            {/* <div className={`player-score ${getScoreClass(player.score)}`}>
              {player.score}
            </div> */}
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
        {player.positions.map((position, index) => (
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
            {player.synergy_players.slice(0, 3).map((partner, index) => (
              <span key={index} className="hero-tag small">{partner}</span>
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
        <button className="stats-toggle-btn" onClick={fetchPlayerStats} disabled={loadingStats}>
          {loadingStats ? '加载中...' : '查看详细数据'}
        </button>

        {errorStats && (
          <div className="error-message">数据加载失败</div>
        )}

        {playerStats && (
          <div className="detailed-stats-content">
            <div className="stat-section">
              <h4>最近胜率</h4>
              <div className="stat-value">{playerStats.recentWinRate}%</div>
            </div>

            <div className="stat-section">
              <h4>常用英雄</h4>
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
              <h4>最高胜率英雄</h4>
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
}