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
        fetchTournaments();
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

  return (
    <div className="tournament-selector-overlay">
      <div className="tournament-selector-modal">
        <div className="modal-header">
          <h3>赛季选择</h3>
          <button className="close-button" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="loading-message">加载中...</div>
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
    </div>
  );
};

export default TournamentSelector;
