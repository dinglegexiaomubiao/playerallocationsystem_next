export default function PlayerCard({ player, isSimplified = false, onRemovePlayer, isDraggable = false }) {
  const getScoreClass = (score) => {
    if (score >= 20000) return 'score-high';
    if (score >= 10000) return 'score-medium';
    return 'score-low';
  };

  if (isSimplified) {
    // 简化模式：只显示昵称、游戏ID、群昵称、天梯分数、冠军数量
    return (
      <div className="player-card simplified" data-player-id={player.id}>
        {player.teamId && (
          <button 
            className="remove-player-btn" 
            onClick={() => onRemovePlayer(player.teamId, player.id)}
          >
            ×
          </button>
        )}
        <div className="player-header">
          <span className="player-name">{player.nickname}</span>
          <span className="player-game-id">{player.game_id}</span>
        </div>
        <div className="player-info simplified-info">
          <div className="player-info-item">
            <span className="player-info-label">群昵称</span>
            <span className="player-info-value">{player.group_nickname}</span>
          </div>
          <div className="player-info-item">
            <span className="player-info-label">天梯分数</span>
            <span className={`player-info-value score-value ${getScoreClass(player.score)}`}>
              {player.score}
            </span>
          </div>
          <div className="player-info-item">
            <span className="player-info-label">冠军</span>
            <span className="player-info-value">{player.championships}</span>
          </div>
        </div>
      </div>
    );
  } else {
    // 完整模式：显示所有信息
    return (
      <div 
        className="player-card" 
        data-player-id={player.id}
        draggable={isDraggable}
      >
        <div className="player-header">
          <span className="player-name">{player.nickname}</span>
          <span className="player-game-id">{player.game_id}</span>
        </div>
        <div className="player-info">
          <div className="player-info-item">
            <span className="player-info-label">群昵称</span>
            <span className="player-info-value">{player.group_nickname}</span>
          </div>
          <div className="player-info-item">
            <span className="player-info-label">天梯分数</span>
            <span className={`player-info-value score-value ${getScoreClass(player.score)}`}>
              {player.score}
            </span>
          </div>
          <div className="player-info-item">
            <span className="player-info-label">胜率</span>
            <span className="player-info-value">{player.win_rate}%</span>
          </div>
          <div className="player-info-item">
            <span className="player-info-label">冠军</span>
            <span className="player-info-value">{player.championships}</span>
          </div>
        </div>
        <div className="position-tags">
          {player.positions.map((pos, index) => (
            <span key={index} className="position-tag">{pos}</span>
          ))}
        </div>
        <div className="heroes-list">
          {player.heroes.map((hero, index) => (
            <span key={index} className="hero-tag">{hero}</span>
          ))}
        </div>
        {player.synergy_players && player.synergy_players.length > 0 && (
          <div className="synergy-players">
            <div className="synergy-players-label">默契选手:</div>
            <div>
              {player.synergy_players.map((sp, index) => (
                <span key={index} className="synergy-player-name">{sp}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }
}