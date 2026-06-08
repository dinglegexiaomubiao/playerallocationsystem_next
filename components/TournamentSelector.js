import React, { useState, useEffect } from 'react';

const TournamentSelector = ({ 
  currentTournament, 
  onTournamentSelect, 
  onClose 
}) => {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTournament, setNewTournament] = useState({
    name: '',
    start_date: '',
    end_date: ''
  });

  // 获取所有赛季信息
  useEffect(() => {
    fetchTournaments();
  }, []);

  const fetchTournaments = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/tournaments');
      const data = await response.json();
      if (data.success) {
        setTournaments(data.tournaments);
      }
    } catch (error) {
      console.error('获取赛季信息失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTournamentClick = (tournament) => {
    onTournamentSelect(tournament);
    onClose();
  };

  const handleAddTournament = async () => {
    if (!newTournament.name) return;
    
    try {
      const response = await fetch('/api/tournaments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newTournament)
      });
      
      const result = await response.json();
      if (result.success) {
        fetchTournaments(); // 重新获取列表
        setNewTournament({ name: '', start_date: '', end_date: '' });
        setShowAddForm(false);
      } else {
        alert('添加赛季失败: ' + result.message);
      }
    } catch (error) {
      console.error('添加赛季失败:', error);
      alert('添加赛季失败');
    }
  };

  const handleUpdateTournament = async (tournamentId, field, value) => {
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ [field]: value })
      });
      
      const result = await response.json();
      if (result.success) {
        fetchTournaments(); // 重新获取列表
      } else {
        alert('更新失败: ' + result.message);
      }
    } catch (error) {
      console.error('更新失败:', error);
      alert('更新失败');
    }
  };

  return (
    <div className="tournament-selector-overlay">
      <div className="tournament-selector-modal">
        <div className="modal-header">
          <h3>赛季选择</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          {loading ? (
            <div className="loading-indicator">加载中...</div>
          ) : (
            <>
              <div className="tournaments-list">
                {tournaments.map((tournament) => (
                  <div 
                    key={tournament.id} 
                    className={`tournament-item ${
                      currentTournament && currentTournament.id === tournament.id ? 'active' : ''
                    }`}
                    onClick={() => handleTournamentClick(tournament)}
                  >
                    <div className="tournament-info">
                      <h4>{tournament.name}</h4>
                      <div className="tournament-dates">
                        {tournament.start_date} 至 {tournament.end_date}
                      </div>
                    </div>
                    
                    <div className="tournament-results">
                      {tournament.champion_team_id ? (
                        <span className="champion">冠军: 队伍{tournament.champion_team_id}</span>
                      ) : (
                        <button 
                          className="add-result-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            // 这里可以打开选择冠军队伍的对话框
                            alert('请选择冠军队伍');
                          }}
                        >
                          +
                        </button>
                      )}
                      
                      {tournament.runner_up_team_id && (
                        <span className="runner-up">亚军: 队伍{tournament.runner_up_team_id}</span>
                      )}
                      {tournament.third_place_team_id && (
                        <span className="runner-up">季军: 队伍{tournament.third_place_team_id}</span>
                      )}
                      {tournament.sponsor_info && (
                        <span className="runner-up">赞助商{tournament.sponsor_info}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="add-tournament-section">
                {!showAddForm ? (
                  <button 
                    className="add-tournament-button"
                    onClick={() => setShowAddForm(true)}
                  >
                    + 新增赛季
                  </button>
                ) : (
                  <div className="add-tournament-form">
                    <h4>新增赛季</h4>
                    <input
                      type="text"
                      placeholder="赛季名称"
                      value={newTournament.name}
                      onChange={(e) => setNewTournament({...newTournament, name: e.target.value})}
                    />
                    <div className="date-inputs">
                      <input
                        type="date"
                        placeholder="开始日期"
                        value={newTournament.start_date}
                        onChange={(e) => setNewTournament({...newTournament, start_date: e.target.value})}
                      />
                      <span>至</span>
                      <input
                        type="date"
                        placeholder="结束日期"
                        value={newTournament.end_date}
                        onChange={(e) => setNewTournament({...newTournament, end_date: e.target.value})}
                      />
                    </div>
                    <div className="form-buttons">
                      <button className="btn btn-primary" onClick={handleAddTournament}>确定</button>
                      <button className="btn btn-secondary" onClick={() => setShowAddForm(false)}>取消</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      
      <style jsx>{`
        .tournament-selector-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(15, 23, 42, 0.4);
          backdrop-filter: blur(4px);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }

        .tournament-selector-modal {
          background: #ffffff;
          border-radius: 16px;
          width: 90%;
          max-width: 600px;
          max-height: 80vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 16px 48px rgba(59, 130, 246, 0.12), 0 4px 16px rgba(0, 0, 0, 0.06);
          border: 1px solid #c8ddf0;
        }

        .modal-header {
          padding: 16px;
          border-bottom: 1px solid #e8f0f8;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: linear-gradient(135deg, #f8fafc 0%, #f0f7fd 100%);
        }

        .modal-header h3 {
          margin: 0;
          color: #1a365d;
          font-size: 18px;
          font-weight: 600;
        }

        .close-button {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: #94a3b8;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: all 0.2s ease;
        }

        .close-button:hover {
          background-color: #e2e8f0;
          color: #1a2332;
        }

        .modal-body {
          padding: 16px;
          overflow-y: auto;
          flex: 1;
        }

        .loading-indicator {
          text-align: center;
          padding: 20px;
          color: #5a7a9a;
        }

        .tournaments-list {
          margin-bottom: 20px;
        }

        .tournament-item {
          padding: 16px;
          border: 1px solid #d0e4f5;
          border-radius: 12px;
          margin-bottom: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          background: #f8fafc;
        }

        .tournament-item:hover {
          background: #f0f7fd;
          border-color: #4da3e8;
        }

        .tournament-item.active {
          border-color: #3b8fd4;
          background: #e8f4fd;
          box-shadow: 0 0 0 3px rgba(59, 143, 212, 0.12);
        }

        .tournament-info h4 {
          margin: 0 0 8px 0;
          color: #1a365d;
          font-size: 16px;
        }

        .tournament-dates {
          color: #5a7a9a;
          font-size: 14px;
          margin-bottom: 10px;
        }

        .tournament-results {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .champion, .runner-up {
          background: #e8f4fd;
          color: #3b8fd4;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          border: 1px solid #c8ddf0;
        }

        .runner-up {
          background: #fef3c7;
          color: #d97706;
          border-color: #fde68a;
        }

        .add-result-button {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #4da3e8 0%, #3b8fd4 100%);
          color: white;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          line-height: 1;
        }

        .add-tournament-button {
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #4da3e8 0%, #3b8fd4 100%);
          color: white;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
        }

        .add-tournament-button:hover {
          background: linear-gradient(135deg, #3b8fd4 0%, #2e7cc4 100%);
          box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
        }

        .add-tournament-form {
          padding: 16px;
          border: 1px solid #c8ddf0;
          border-radius: 12px;
          background-color: #f8fafc;
        }

        .add-tournament-form h4 {
          margin: 0 0 16px 0;
          color: #1a365d;
        }

        .add-tournament-form input {
          width: 100%;
          padding: 10px 12px;
          margin-bottom: 12px;
          border: 1px solid #c8ddf0;
          border-radius: 8px;
          font-size: 14px;
          box-sizing: border-box;
          background: #ffffff;
          color: #1a2332;
          transition: border-color 0.2s ease;
        }

        .add-tournament-form input:focus {
          outline: none;
          border-color: #4da3e8;
        }

        .date-inputs {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
        }

        .date-inputs input {
          flex: 1;
          margin-bottom: 0;
        }

        .date-inputs span {
          color: #5a7a9a;
          font-size: 14px;
        }

        .form-buttons {
          display: flex;
          gap: 10px;
        }

        .btn {
          flex: 1;
          padding: 10px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s ease;
        }

        .btn-primary {
          background: linear-gradient(135deg, #4da3e8 0%, #3b8fd4 100%);
          color: white;
          box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
        }

        .btn-primary:hover {
          background: linear-gradient(135deg, #3b8fd4 0%, #2e7cc4 100%);
        }

        .btn-secondary {
          background: #f0f4f8;
          color: #4a5568;
          border: 1px solid #c8ddf0;
        }

        .btn-secondary:hover {
          background: #e2e8f0;
        }
      `}</style>
    </div>
  );
};

export default TournamentSelector;