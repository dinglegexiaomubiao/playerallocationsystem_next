export default function PlayerCard({ player, onRemove, onDragStart }) {
  // 计算分数颜色类
  const getScoreClass = (score) => {
    if (score >= 20000) return 'score-master';
    if (score >= 15000) return 'score-diamond';
    if (score >= 10000) return 'score-platinum';
    if (score >= 5000) return 'score-gold';
    return 'score-silver';
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
            {player.synergy_players.slice(0, 2).map((synergyPlayer, index) => (
              <span key={index} className="synergy-tag small">{synergyPlayer}</span>
            ))}
            {player.synergy_players.length > 2 && (
              <span className="synergy-tag small more">+{player.synergy_players.length - 2}</span>
            )}
          </div>
        </div>
      )}
      
      {player.synergy_players && player.synergy_players.length > 0 && (
        <div className="synergy-indicator">
          <div className="synergy-icon">🔗</div>
          <div className="synergy-names">
            {player.synergy_players.slice(0, 2).join(', ')}
            {player.synergy_players.length > 2 && ` 等${player.synergy_players.length}人`}
          </div>
        </div>
      )}
    </div>
  );
}