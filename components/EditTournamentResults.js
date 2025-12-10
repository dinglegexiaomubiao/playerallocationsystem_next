import React, { useState, useEffect } from 'react';

const EditTournamentResults = ({ 
  tournament, 
  teams = [], 
  onSave, 
  onClose 
}) => {
  const [formData, setFormData] = useState({
    name: tournament?.name || '',
    champion_team_id: tournament?.champion_team_id || '',
    runner_up_team_id: tournament?.runner_up_team_id || '',
    third_place_team_id: tournament?.third_place_team_id || ''
  });

  useEffect(() => {
    setFormData({
      name: tournament?.name || '',
      champion_team_id: tournament?.champion_team_id || '',
      runner_up_team_id: tournament?.runner_up_team_id || '',
      third_place_team_id: tournament?.third_place_team_id || ''
    });
  }, [tournament]);

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });
      
      // 检查响应状态
      if (!response.ok) {
        const errorMessage = `HTTP error! status: ${response.status}`;
        console.error('API请求失败:', errorMessage);
        console.error('请求URL:', `/api/tournaments/${encodeURIComponent(tournament.id)}`);
        console.error('请求体:', formData);
        throw new Error(errorMessage);
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('非JSON响应:', text);
        throw new Error('服务器返回了非JSON响应');
      }
      
      const result = await response.json();
      if (result.success) {
        onSave(result.tournament);
        onClose();
      } else {
        alert('保存失败: ' + result.message);
      }
    } catch (error) {
      console.error('保存失败:', error);
      alert('保存失败: ' + error.message);
    }
  };

  return (
    <div className="edit-tournament-overlay">
      <div className="edit-tournament-modal">
        <div className="modal-header">
          <h3>编辑赛季信息 - {tournament?.name}</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>赛季名称:</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>冠军队伍:</label>
              <select 
                value={formData.champion_team_id}
                onChange={(e) => handleChange('champion_team_id', e.target.value)}
              >
                <option value="">请选择冠军队伍</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label>亚军队伍:</label>
              <select 
                value={formData.runner_up_team_id}
                onChange={(e) => handleChange('runner_up_team_id', e.target.value)}
              >
                <option value="">请选择亚军队伍</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label>季军队伍:</label>
              <select 
                value={formData.third_place_team_id}
                onChange={(e) => handleChange('third_place_team_id', e.target.value)}
              >
                <option value="">请选择季军队伍</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                取消
              </button>
              <button type="submit" className="btn btn-primary">
                保存
              </button>
            </div>
          </form>
        </div>
      </div>
      
      <style jsx>{`
        .edit-tournament-overlay {
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
        
        .edit-tournament-modal {
          background: #ffffff;
          border-radius: 8px;
          width: 90%;
          max-width: 500px;
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
        
        .form-group {
          margin-bottom: 20px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
          color: #333;
        }
        
        .form-group input,
        .form-group select {
          width: 100%;
          padding: 10px;
          border: 1px solid #e1e1e1;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
        }
        
        .form-actions {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
        
        .btn {
          padding: 10px 20px;
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

export default EditTournamentResults;