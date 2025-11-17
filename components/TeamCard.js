import { useState, useEffect } from 'react';
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

  // 生成随机冷色调背景色
  const getRandomCoolColor = () => {
    // 定义更多低调的冷色调
    const coolColors = [
      '#1a2530', // 默认深蓝灰色
      '#1a2a3a', // 深蓝色
      '#253545', // 深青色
      '#1f2a35', // 深青蓝色
      '#223240', // 深蓝绿色
      '#202d38', // 深蓝青色
      '#24303c', // 深紫蓝色
      '#1e2832', // 深蓝灰色
      '#2a3642', // 蓝灰色
      '#26333e', // 深蓝紫色
      '#1d3e4f', // 深海绿色
      '#283f52', // 深青绿色
      '#384d69', // 中蓝灰色
      '#293e4f', // 深蓝青色
      '#1b3356', // 皇家蓝
      '#213b4b', // 深海蓝
      '#1c435a', // 深天蓝色
      '#2a4f62', // 深青石色
      '#253d44', // 深松石色
      '#223953', // 深靛蓝色
      '#374b69', // 中蓝色
      '#2d4862', // 深蓝石色
      '#1a486c', // 深宝石蓝
      '#2b4d64', // 深灰蓝色
      '#284656', // 深蓝绿色
      '#334b64', // 深钢蓝色
      '#204a6a', // 深湖蓝色
      '#2b485c', // 深蓝石色
      '#1c3a58', // 深午夜蓝
      '#294b64'  // 深蓝灰色
    ];
    
    const randomIndex = Math.floor(Math.random() * (coolColors.length - 1)) + 1; // 避免选择第一个默认颜色
    return coolColors[randomIndex];
  };

  const [cardBackgroundColor, setCardBackgroundColor] = useState(getRandomCoolColor());

  // 组件挂载时设置背景色
  useEffect(() => {
    setCardBackgroundColor(getRandomCoolColor());
  }, []);

  return (
    <div 
      className="team-card" 
      onDragOver={(e) => e.preventDefault()}
      style={{ background: cardBackgroundColor }}
    >
      <div className="team-header">
        <h3 className="team-name">{team.name}</h3>
        <div className={`team-score ${getTeamScoreClass(calculateTeamScore())}`}>
          天梯总分:
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
          onClick={onDeleteTeam}
          className="btn btn-danger btn-spaced"
        >
          删除队伍
        </button>
      </div>
    </div>
  );
}