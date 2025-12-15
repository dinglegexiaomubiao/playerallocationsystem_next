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
    third_place_team_id: tournament?.third_place_team_id || '',
    sponsor_info: tournament?.sponsor_info || '',
    start_date: tournament?.start_date || '',
    end_date: tournament?.end_date || ''
  });

  useEffect(() => {
    setFormData({
      name: tournament?.name || '',
      champion_team_id: tournament?.champion_team_id || '',
      runner_up_team_id: tournament?.runner_up_team_id || '',
      third_place_team_id: tournament?.third_place_team_id || '',
      sponsor_info: tournament?.sponsor_info || '',
      start_date: tournament?.start_date || '',
      end_date: tournament?.end_date || ''
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
        onSave(result.tournament); // 传递更新后的tournament对象
        onClose();
      } else {
        alert('保存失败: ' + result.message);
      }
    } catch (error) {
      console.error('保存失败:', error);
      alert('保存失败: ' + error.message);
    }
  };

  const handleDelete = async () => {
    if (window.confirm(`确定要删除赛季 "${tournament.name}" 吗？此操作不可撤销。`)) {
      try {
        const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}`, {
          method: 'DELETE'
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        if (result.success) {
          alert('赛季删除成功');
          onSave(null); // 传递null表示赛季已被删除
          onClose();
        } else {
          alert('删除失败: ' + result.message);
        }
      } catch (error) {
        console.error('删除失败:', error);
        alert('删除失败: ' + error.message);
      }
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
                required
              />
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label>开始日期:</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => handleChange('start_date', e.target.value)}
                  className="form-input"
                />
              </div>
              
              <div className="form-group">
                <label>结束日期:</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => handleChange('end_date', e.target.value)}
                  className="form-input"
                />
              </div>
            </div>
            
            <div className="form-group">
              <label>赞助商信息:</label>
              <input
                type="text"
                value={formData.sponsor_info}
                onChange={(e) => handleChange('sponsor_info', e.target.value)}
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
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                删除赛季
              </button>
              <div className="form-actions-right">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  保存
                </button>
              </div>
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
          background: #1a1a1a;
          border-radius: 8px;
          width: 90%;
          max-width: 500px;
          max-height: 80vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          color: #eaeaea;
        }
        
        .modal-header {
          padding: 16px;
          border-bottom: 1px solid #333;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background-color: #2a2a2a;
        }
        
        .modal-header h3 {
          margin: 0;
          color: #eaeaea;
          font-size: 18px;
        }
        
        .close-button {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: #aaa;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: background-color 0.2s;
        }
        
        .close-button:hover {
          background-color: #333;
          color: #fff;
        }
        
        .modal-body {
          padding: 16px;
          overflow-y: auto;
          flex: 1;
        }
        
        .form-row {
          display: flex;
          gap: 15px;
        }
        
        .form-group {
          margin-bottom: 20px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
          color: #ccc;
        }
        
        .form-group input,
        .form-group select {
          width: 100%;
          padding: 10px;
          border: 1px solid #444;
          border-radius: 4px;
          font-size: 14px;
          box-sizing: border-box;
          background-color: #2a2a2a;
          color: #eaeaea;
        }
        
        .form-group input:focus,
        .form-group select:focus {
          outline: none;
          border-color: #0070f3;
        }
        
        .form-actions {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          margin-top: 20px;
        }
        
        .form-actions-right {
          display: flex;
          gap: 10px;
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
          background-color: #333;
          color: #eaeaea;
        }
        
        .btn-secondary:hover {
          background-color: #444;
        }
        
        .btn-danger {
          background-color: #e00;
          color: white;
        }
        
        .btn-danger:hover {
          background-color: #c00;
        }
        
        @media (max-width: 768px) {
          .form-row {
            flex-direction: column;
            gap: 0;
          }
          
          .form-actions {
            flex-direction: column;
          }
          
          .form-actions-right {
            width: 100%;
            justify-content: space-between;
          }
        }
      `}</style>
    </div>
  );
};

export default EditTournamentResults;