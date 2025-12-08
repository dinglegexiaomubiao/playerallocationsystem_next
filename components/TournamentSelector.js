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
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }
        
        .tournament-selector-modal {
          background: #ffffff;
          border-radius: 8px;
          width: 90%;
          max-width: 600px;
          max-height: 80vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        .modal-header {
          padding: 16px;
          border-bottom: 1px solid #eaeaea;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background-color: #f8f9fa;
        }
        
        .modal-header h3 {
          margin: 0;
          color: #333;
          font-size: 18px;
        }
        
        .close-button {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: #666;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: background-color 0.2s;
        }
        
        .close-button:hover {
          background-color: #eaeaea;
        }
        
        .modal-body {
          padding: 16px;
          overflow-y: auto;
          flex: 1;
        }
        
        .loading-indicator {
          text-align: center;
          padding: 20px;
          color: #666;
        }
        
        .tournaments-list {
          margin-bottom: 20px;
        }
        
        .tournament-item {
          padding: 16px;
          border: 1px solid #e1e1e1;
          border-radius: 6px;
          margin-bottom: 12px;
          cursor: pointer;
          transition: all 0.2s;
          background-color: #fafafa;
        }
        
        .tournament-item:hover {
          background-color: #f0f0f0;
          border-color: #0070f3;
        }
        
        .tournament-item.active {
          border-color: #0070f3;
          background-color: #e6f0ff;
          box-shadow: 0 2px 4px rgba(0, 112, 243, 0.1);
        }
        
        .tournament-info h4 {
          margin: 0 0 8px 0;
          color: #333;
          font-size: 16px;
        }
        
        .tournament-dates {
          color: #666;
          font-size: 14px;
          margin-bottom: 10px;
        }
        
        .tournament-results {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        
        .champion, .runner-up {
          background-color: #e6f0ff;
          color: #0070f3;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        }
        
        .runner-up {
          background-color: #fff0e6;
          color: #f37000;
        }
        
        .add-result-button {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background-color: #0070f3;
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
          background-color: #0070f3;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 500;
          transition: background-color 0.2s;
        }
        
        .add-tournament-button:hover {
          background-color: #0051cc;
        }
        
        .add-tournament-form {
          padding: 16px;
          border: 1px solid #e1e1e1;
          border-radius: 6px;
          background-color: #f8f9fa;
        }
        
        .add-tournament-form h4 {
          margin: 0 0 16px 0;
          color: #333;
        }
        
        .add-tournament-form input {
          width: 100%;
          padding: 10px;
          margin-bottom: 12px;
          border: 1px solid #e1e1e1;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
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
          color: #666;
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
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: background-color 0.2s;
        }
        
        .btn-primary {
          background-color: #0070f3;
          color: white;
        }
        
        .btn-primary:hover {
          background-color: #0051cc;
        }
        
        .btn-secondary {
          background-color: #f0f0f0;
          color: #333;
        }
        
        .btn-secondary:hover {
          background-color: #e1e1e1;
        }
      `}</style>
    </div>
  );
};

export default TournamentSelector;