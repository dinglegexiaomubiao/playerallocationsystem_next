import PlayerCard from './PlayerCard';

export default function TeamCard({ team, onAddPlayer, onRemovePlayer, onDeleteTeam }) {
  const calculateTeamScore = () => {
    return team.players.reduce((total, player) => total + (player.score || 0), 0);
  };

  const playerCount = team.players.length;
  const isFull = playerCount >= 5;

  return (
    <div className={`team-card${isFull ? ' is-full' : ''}`}>
      <div className="team-header">
        <div className="team-info">
          <h3 className="team-name">{team.name}</h3>
          <span className="team-player-count">
            {playerCount}/5 人
          </span>
        </div>
        <div className="team-score">
          总分 {calculateTeamScore()}
        </div>
      </div>

      <div className="team-players">
        {team.players.map((player) => (
          <PlayerCard
            key={player.id}
            player={player}
            onRemove={onRemovePlayer ? () => onRemovePlayer(player.id) : null}
            isSimplified={true}
          />
        ))}
        {playerCount === 0 && (
          <div className="team-empty-hint">暂无选手，点击下方按钮添加</div>
        )}
      </div>

      <div className="team-footer">
        <button
          className="btn btn-primary btn-sm"
          onClick={onAddPlayer}
          disabled={isFull}
        >
          + 添加选手{isFull ? ' (已满)' : ''}
        </button>
        <button
          onClick={onDeleteTeam}
          className="btn btn-danger btn-sm"
        >
          删除队伍
        </button>
      </div>
    </div>
  );
}