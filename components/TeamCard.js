import PlayerCard from './PlayerCard';

export default function TeamCard({ team, onAddPlayer, onRemovePlayer, onDeleteTeam }) {
  // 计算队伍总分
  const calculateTeamScore = () => {
    return team.players.reduce((total, player) => total + (player.score || 0), 0);
  };

  // 获取队伍分数颜色类
  const getTeamScoreClass = (score) => {
    if (score >= 80000) return 'score-master';
    if (score >= 60000) return 'score-diamond';
    if (score >= 40000) return 'score-platinum';
    if (score >= 20000) return 'score-gold';
    return 'score-silver';
  };

  return (
    <div className="team-card" onDragOver={(e) => e.preventDefault()}>
      <div className="team-header">
        <h3 className="team-name">{team.name}</h3>
        <div className={`team-score ${getTeamScoreClass(calculateTeamScore())}`}>
          {calculateTeamScore()}
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
      </div>
      
      <div className="team-footer">
        <button 
          className="btn btn-secondary" 
          onClick={onAddPlayer}
          disabled={team.players.length >= 5}
        >
          + 添加选手 {team.players.length >= 5 ? '(已满)' : `(${team.players.length}/5)`}
        </button>
        <button 
          className="btn btn-danger" 
          onClick={onDeleteTeam}
          style={{marginLeft: '10px'}}
        >
          删除队伍
        </button>
      </div>
    </div>
  );
}