import Head from 'next/head';
import { useState, useEffect } from 'react';
import PlayerCard from '../components/PlayerCard';
import TeamCard from '../components/TeamCard';

export default function Home() {
  const [teams, setTeams] = useState([]);
  const [unassignedPlayers, setUnassignedPlayers] = useState([]);

  // 初始化数据
  useEffect(() => {
    // 这里可以从API获取数据或使用默认数据
    const defaultTeams = [
      {
        id: 1,
        name: '队伍1',
        players: []
      }
    ];
    
    const defaultPlayers = [
      {
        id: 1,
        nickname: '暗夜猎手',
        game_id: 'NightHunter',
        group_nickname: '猎手',
        score: 15000,
        positions: ['优势路'],
        heroes: [],
        win_rate: 60,
        championships: 2,
        synergy_players: []
      }
    ];

    setTeams(defaultTeams);
    setUnassignedPlayers(defaultPlayers);
  }, []);

  return (
    <div>
      <Head>
        <title>比赛选手人员分配系统</title>
        <meta name="description" content="Team Assignment System for eSports" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container">
        <header className="header">
          <h1>比赛选手人员分配系统</h1>
          <div className="instructions">
            <p>拖拽选手卡片到队伍中进行分配 | 点击添加按钮选择选手 | 支持搜索和筛选功能</p>
          </div>
          
          {/* 统计卡片区域 */}
          <div className="stats-cards">
            <div className="stat-card total-players">
              <div className="stat-icon">👥</div>
              <div className="stat-info">
                <div className="stat-title">总选手数</div>
                <div className="stat-value">{teams.reduce((acc, team) => acc + team.players.length, 0) + unassignedPlayers.length}</div>
              </div>
            </div>
            
            <div className="stat-card unassigned-players">
              <div className="stat-icon">⏳</div>
              <div className="stat-info">
                <div className="stat-title">未分配选手</div>
                <div className="stat-value">{unassignedPlayers.length}</div>
              </div>
            </div>
            
            <div className="stat-card teams">
              <div className="stat-icon">👥</div>
              <div className="stat-info">
                <div className="stat-title">队伍数</div>
                <div className="stat-value">{teams.length}</div>
              </div>
            </div>
          </div>
          
          <div className="header-actions">
            <button className="btn btn-secondary">重置分配</button>
            <button className="btn btn-primary">保存配置</button>
            <button className="btn btn-secondary">导出数据</button>
            <button className="btn btn-secondary">导入数据</button>
          </div>
        </header>
        
        <main className="main-content">
          {/* 队伍展示区 */}
          <section className="teams-section">
            <div className="section-header">
              <h2>队伍分配</h2>
              <div className="section-actions">
                <button className="btn btn-primary">+ 添加队伍</button>
              </div>
            </div>
            <div className="teams-container">
              {teams.map(team => (
                <TeamCard 
                  key={team.id} 
                  team={team} 
                  onAddPlayer={(teamId) => console.log('添加选手到队伍:', teamId)}
                  onRemoveTeam={(teamId) => console.log('删除队伍:', teamId)}
                  onRemovePlayer={(teamId, playerId) => console.log('从队伍移除选手:', teamId, playerId)}
                />
              ))}
            </div>
          </section>

          {/* 未分配选手池 */}
          <section className="players-section">
            <div className="section-header">
              <h2>未分配选手池</h2>
              <div className="search-container">
                <input 
                  type="text" 
                  placeholder="搜索选手昵称、游戏ID、群昵称、擅长位置或英雄..." 
                  className="search-input"
                />
                <div className="position-filters">
                  <label><input type="checkbox" className="position-filter" value="优势路" /> 优势路</label>
                  <label><input type="checkbox" className="position-filter" value="中单" /> 中单</label>
                  <label><input type="checkbox" className="position-filter" value="劣势路" /> 劣势路</label>
                  <label><input type="checkbox" className="position-filter" value="半辅助" /> 半辅助</label>
                  <label><input type="checkbox" className="position-filter" value="纯辅助" /> 纯辅助</label>
                  <label><input type="checkbox" className="position-filter" value="全才" /> 全才</label>
                </div>
              </div>
            </div>
            <div className="players-container">
              {unassignedPlayers.map(player => (
                <PlayerCard 
                  key={player.id} 
                  player={player} 
                  isDraggable={true} 
                />
              ))}
            </div>
          </section>
        </main>
      </main>
    </div>
  );
}