import PlayerCard from './PlayerCard';

export default function TeamCard({ team, onAddPlayer, onRemoveTeam, onRemovePlayer }) {
  const isFull = team.players.length >= 5;
  
  return (
    <div className="team-card" data-team-id={team.id}>
      <div className="team-header">
        <div className="team-info">
          <h3>{team.name} (ID: {team.id})</h3>
          <div className="team-stats">
            总天梯分数: <span className="team-score">0</span>
            <span className="team-player-count">{team.players.length}/5人</span>
          </div>
        </div>
        <div className="team-actions">
          <button className="remove-team-btn" onClick={() => onRemoveTeam(team.id)}>删除队伍</button>
        </div>
      </div>
      <div className="team-players">
        {team.players.length === 0 ? (
          <div className="empty-state">暂无选手</div>
        ) : (
          team.players.map(player => (
            <PlayerCard 
              key={player.id} 
              player={{...player, teamId: team.id}} 
              isSimplified={true}
              onRemovePlayer={onRemovePlayer}
            />
          ))
        )}
      </div>
      {!isFull ? (
        <button className="add-player-btn" onClick={() => onAddPlayer(team.id)}>
          + 添加选手
        </button>
      ) : (
        <div className="team-full-indicator">队伍已满</div>
      )}
    </div>
  );
}