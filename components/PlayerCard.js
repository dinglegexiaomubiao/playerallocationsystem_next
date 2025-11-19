import { useState, useEffect } from 'react';

export default function PlayerCard({ player, onRemove, onDragStart, onEdit, onCopy, onDelete, isSimplified = false, isModalView = false, className = '' }) {
  // 计算分数颜色类
  const getScoreClass = (score) => {
    if (score >= 20000) return 'score-master';
    if (score >= 15000) return 'score-diamond';
    if (score >= 10000) return 'score-platinum';
    if (score >= 5000) return 'score-gold';
    return 'score-silver';
  };

  // 生成随机冷色调背景色
  const getRandomCoolColor = () => {
    // 定义一些低调的冷色调
    const coolColors = [
      '#1e293b', // 默认深蓝灰色
      '#1e3a5f', // 深蓝色
      '#2c3e50', // 深青色
      '#2b3e50', // 深青蓝色
      '#253a4b', // 深蓝绿色
      '#2a3b4c', // 深蓝青色
      '#2d3a4d', // 深紫蓝色
      '#263238', // 深蓝灰色
      '#37474f', // 蓝灰色
      '#2c384a'  // 深蓝紫色
    ];
    
    // 如果是未分配区域的卡片（非简化版且非模态框视图），随机选择一个颜色
    if (!isSimplified && !isModalView) {
      const randomIndex = Math.floor(Math.random() * (coolColors.length - 1)) + 1; // 避免选择第一个默认颜色
      return coolColors[randomIndex];
    }
    
    // 简化版或模态框视图使用默认颜色
    return coolColors[0];
  };

  const [cardBackgroundColor, setCardBackgroundColor] = useState(getRandomCoolColor());
  const [playerStats, setPlayerStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [errorStats, setErrorStats] = useState(null);
  const [showDebugInfo, setShowDebugInfo] = useState(false); // 控制调试信息显示

  // 组件挂载时设置背景色
  useEffect(() => {
    setCardBackgroundColor(getRandomCoolColor());
  }, []);

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
    alert('游戏ID已复制到剪贴板');
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
            title="复制游戏ID"
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
      draggable
      style={{ background: cardBackgroundColor }}
      onDragStart={(e) => {
        if (onDragStart) {
          onDragStart(e, player.id);
        }
      }}
    >
      {onRemove && (
        <button className="remove-player" onClick={() => onRemove(player.id)}>×</button>
      )}
      <div className="player-header">
        <div className="player-nickname">{player.nickname}</div>
        <div className={`player-score ${getScoreClass(player.score)}`}>
          天梯分数:{player.score}
        </div>
      </div>
      
      <div className="player-details">
        <div className="detail-item">
          <span className="detail-label">游戏ID:</span>
          <span className="detail-value">{player.game_id}</span>
        </div>
        {player.group_nickname && (
          <div className="detail-item">
            <span className="detail-label">群昵称:</span>
            <span className="detail-value">{player.group_nickname}</span>
          </div>
        )}
        
        <div className="player-positions">
          {player.positions.map((position, index) => (
            <span key={index} className="position-tag">{position}</span>
          ))}
        </div>
        
        {player.heroes && player.heroes.length > 0 && (
          <div className="player-heroes">
            {player.heroes.slice(0, 3).map((hero, index) => (
              <span key={index} className="hero-tag">{hero}</span>
            ))}
            {player.heroes.length > 3 && (
              <span className="hero-tag more">+{player.heroes.length - 3}</span>
            )}
          </div>
        )}
        
        <div className="player-stats">
          {player.win_rate > 0 && (
            <div className="stat-item">
              <span className="stat-label">胜率:</span>
              <span className="stat-value">{player.win_rate}%</span>
            </div>
          )}
          {player.championships > 0 && (
            <div className="stat-item">
              <span className="stat-label">冠军:</span>
              <span className="stat-value">{player.championships}个</span>
            </div>
          )}
        </div>
      </div>
      
      {/* 显示擅长英雄 */}
      {player.heroes && player.heroes.length > 0 && (
        <div className="player-heroes-preview">
          <div className="info-label">擅长英雄:</div>
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
      
      {/* 显示默契选手 */}
      {player.synergy_players && player.synergy_players.length > 0 && (
        <div className="player-synergy-preview">
          <div className="info-label">默契选手:</div>
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
      
      {/* 显示详细统计数据 */}
      <div className="player-detailed-stats">
        <button className="stats-toggle-btn" onClick={fetchPlayerStats} disabled={loadingStats}>
          {loadingStats ? '加载中...' : '查看详细数据'}
        </button>
        
        {errorStats && (
          <div className="error-message">
            错误:数据有误 
          </div>
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
            
            {/* 调试信息切换按钮 */}
            {/* <div className="debug-toggle">
              <button 
                className="debug-toggle-btn" 
                onClick={() => setShowDebugInfo(!showDebugInfo)}
              >
                {showDebugInfo ? '隐藏调试信息' : '显示调试信息'}
              </button>
              {showDebugInfo && playerStats.debug && (
                <div className="debug-info">
                  <h4>最近比赛数据:</h4>
                  <pre>{JSON.stringify(playerStats.debug.recentMatches, null, 2)}</pre>
                  
                  <h4>英雄统计数据:</h4>
                  <pre>{JSON.stringify(playerStats.debug.heroesData, null, 2)}</pre>
                </div>
              )}
            </div> */}
          </div>
        )}
      </div>
      
      {/* 操作按钮区域 - 始终显示 */}
      <div className="player-actions">
        <button className="player-action-btn edit-btn" onClick={() => onEdit && onEdit(player)} title="编辑选手">
          ✏️ 编辑
        </button>
        <button className="player-action-btn copy-btn" onClick={handleCopyGameID} title="复制游戏ID">
          📋 复制
        </button>
        <button className="player-action-btn delete-btn" onClick={handleDelete} title="删除选手">
          🗑️ 删除
        </button>
      </div>
    </div>
  );
}