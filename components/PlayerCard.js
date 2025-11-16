import { useState } from 'react';

export default function PlayerCard({ player, onRemove, onDragStart, onEdit, onCopy, onDelete }) {
  // 计算分数颜色类
  const getScoreClass = (score) => {
    if (score >= 20000) return 'score-master';
    if (score >= 15000) return 'score-diamond';
    if (score >= 10000) return 'score-platinum';
    if (score >= 5000) return 'score-gold';
    return 'score-silver';
  };

  const handleCopyGameID = () => {
    navigator.clipboard.writeText(player.game_id);
    // 可以添加一些用户反馈，比如显示"已复制"提示
  };

  return (
    <div 
      className="player-card" 
      draggable
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
        <div className={`player-score ${getScoreClass(player.score)}`}>
          {player.score}
        </div>
        <div className="player-nickname">{player.nickname}</div>
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
      
      {/* 操作按钮区域 - 始终显示 */}
      <div className="player-actions">
        <button className="player-action-btn edit-btn" onClick={() => onEdit && onEdit(player)} title="编辑选手">
          ✏️ 编辑
        </button>
        <button className="player-action-btn copy-btn" onClick={handleCopyGameID} title="复制游戏ID">
          📋 复制
        </button>
        <button className="player-action-btn delete-btn" onClick={() => onDelete && onDelete(player.id)} title="删除选手">
          🗑️ 删除
        </button>
      </div>
    </div>
  );
}