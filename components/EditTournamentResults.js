import React, { useState, useEffect } from 'react';

// 将数据库中的日期值转为 datetime-local input 所需的 YYYY-MM-DDTHH:mm 格式
const toDatetimeLocal = (value) => {
  if (!value) return '';
  if (value.includes('T')) {
    return value.substring(0, 16);
  }
  return `${value}T00:00`;
};

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
    start_date: toDatetimeLocal(tournament?.start_date),
    end_date: toDatetimeLocal(tournament?.end_date)
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFormData({
      name: tournament?.name || '',
      champion_team_id: tournament?.champion_team_id || '',
      runner_up_team_id: tournament?.runner_up_team_id || '',
      third_place_team_id: tournament?.third_place_team_id || '',
      sponsor_info: tournament?.sponsor_info || '',
      start_date: toDatetimeLocal(tournament?.start_date),
      end_date: toDatetimeLocal(tournament?.end_date)
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
    setSaving(true);

    try {
      // 补全 datetime-local 格式为完整 ISO 时间戳（追加秒数），并将空字符串的整数字段转为 null
      const dataToSend = {
        ...formData,
        start_date: formData.start_date ? formData.start_date + ':00' : null,
        end_date: formData.end_date ? formData.end_date + ':00' : null,
        champion_team_id: formData.champion_team_id || null,
        runner_up_team_id: formData.runner_up_team_id || null,
        third_place_team_id: formData.third_place_team_id || null,
      };

      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dataToSend)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
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
    } finally {
      setSaving(false);
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
          onSave(null);
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
          <button className="close-button" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>赛季名称:</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                required
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>开始时间（国区 GMT+8）:</label>
                <input
                  type="datetime-local"
                  value={formData.start_date}
                  onChange={(e) => handleChange('start_date', e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>结束时间（国区 GMT+8）:</label>
                <input
                  type="datetime-local"
                  value={formData.end_date}
                  onChange={(e) => handleChange('end_date', e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label>赞助商信息:</label>
              <input
                type="text"
                value={formData.sponsor_info}
                onChange={(e) => handleChange('sponsor_info', e.target.value)}
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
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditTournamentResults;
