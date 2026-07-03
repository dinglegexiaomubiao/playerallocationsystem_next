import { useState, useCallback } from 'react';

export function useTeamManagement(currentTournament, teams, setTeams, unassignedPlayers, setUnassignedPlayers) {
  const [isAddingTeam, setIsAddingTeam] = useState(false);

  const addTeam = useCallback(async () => {
    setIsAddingTeam(true);
    if (!currentTournament?.id) {
      alert('请先选择一个赛季，然后才能添加队伍！');
      setIsAddingTeam(false);
      return;
    }

    const tempId = `temp_${Date.now()}`;
    const newTeam = {
      id: tempId,
      name: `新队伍`,
      players: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const prevTeams = [...teams];
    setTeams([...teams, newTeam]);

    try {
      const response = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newTeam, tournament_id: currentTournament?.id }),
      });
      if (response.ok) {
        const data = await response.json();
        const realTeam = data.team;
        setTeams(prev => prev.map(t => t.id === tempId ? { ...realTeam, players: [] } : t));
        alert('队伍添加成功');
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || '添加队伍失败');
      }
    } catch (error) {
      console.error('添加队伍到API失败:', error);
      alert(`队伍添加失败: ${error.message}`);
      setTeams(prevTeams);
    } finally {
      setIsAddingTeam(false);
    }
  }, [currentTournament, teams]);

  const deleteTeam = useCallback(async (teamId) => {
    const prevTeams = [...teams];
    const updatedTeams = teams.filter(team => team.id !== teamId);
    setTeams(updatedTeams);
    try {
      const response = await fetch('/api/teams', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: teamId }),
      });
      if (!response.ok) throw new Error('删除队伍失败');
    } catch (error) {
      console.error('从API删除队伍失败:', error);
      alert('删除队伍失败，已恢复原始状态');
      setTeams(prevTeams);
    }
  }, [teams]);

  const addPlayerToTeam = useCallback(async (playerId, teamId) => {
    const team = teams.find(t => t.id === teamId);
    if (team && team.players.length >= 5) {
      alert('队伍已满，无法添加更多选手！');
      return;
    }
    const allPlayers = [...unassignedPlayers, ...teams.flatMap(t => t.players)];
    const player = allPlayers.find(p => p.id === playerId);
    if (!player) return;

    const prevTeams = [...teams];
    const updatedTeams = teams.map(t => {
      if (t.id === teamId) {
        if (t.players.some(p => p.id === playerId)) return t;
        return { ...t, players: [...t.players, player], updated_at: new Date().toISOString() };
      }
      return t;
    });
    setTeams(updatedTeams);

    try {
      const response = await fetch('/api/team-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, playerId, tournament_id: currentTournament?.id }),
      });
      if (!response.ok) throw new Error('添加选手到队伍失败');
    } catch (error) {
      console.error('添加选手到队伍API记录失败:', error);
      alert('添加选手到队伍失败，已恢复原始状态');
      setTeams(prevTeams);
    }
  }, [teams, unassignedPlayers, currentTournament]);

  const removePlayerFromTeam = useCallback(async (playerId, teamId) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const prevTeams = [...teams];
    const updatedTeams = teams.map(t => {
      if (t.id === teamId) {
        return { ...t, players: t.players.filter(p => p.id !== playerId), updated_at: new Date().toISOString() };
      }
      return t;
    });
    setTeams(updatedTeams);
    try {
      const response = await fetch('/api/team-players', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, playerId, tournament_id: currentTournament?.id }),
      });
      if (!response.ok) throw new Error('从队伍移除选手失败');
    } catch (error) {
      console.error('从队伍API记录中移除选手失败:', error);
      alert('从队伍移除选手失败，已恢复原始状态');
      setTeams(prevTeams);
    }
  }, [teams, currentTournament]);

  const resetAssignments = useCallback(async () => {
    const prevTeams = [...teams];
    const updatedTeams = teams.map(team => ({ ...team, players: [], updated_at: new Date().toISOString() }));
    setTeams(updatedTeams);
    try {
      for (const team of teams) {
        const response = await fetch('/api/team-players', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId: team.id, playerIds: [] }),
        });
        if (!response.ok) throw new Error(`重置队伍${team.id}失败`);
      }
    } catch (error) {
      console.error('重置队伍选手关系失败:', error);
      setTeams(prevTeams);
    }
  }, [teams]);

  const saveConfig = useCallback(async () => {
    const data = { teams, unassignedPlayers, timestamp: new Date().toISOString() };
    const dataStr = JSON.stringify(data, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = `team-config-${new Date().toISOString().slice(0, 10)}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();

    try {
      for (const team of teams) {
        const playerIds = team.players.map(p => parseInt(p.id));
        const response = await fetch('/api/team-players', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId: team.id, playerIds }),
        });
        if (!response.ok) throw new Error(`保存队伍${team.id}失败`);
      }
    } catch (error) {
      console.error('保存配置到API失败:', error);
    }
  }, [teams, unassignedPlayers]);

  const importConfig = useCallback(async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        setTeams(data.teams || []);
        setUnassignedPlayers(data.unassignedPlayers || []);

        const allPlayers = [
          ...(data.unassignedPlayers || []),
          ...(data.teams || []).flatMap(team => team.players || [])
        ];
        const uniquePlayers = allPlayers.filter((player, index, self) =>
          index === self.findIndex(p => p.id === player.id)
        );

        for (const player of uniquePlayers) {
          try {
            await fetch('/api/players', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(player),
            });
          } catch (error) {
            console.error('导入选手到数据库失败:', error);
          }
        }

        // 导入队伍并记录 old_id → new_id 的映射
        const idMap = {};
        for (const team of (data.teams || [])) {
          try {
            const response = await fetch('/api/teams', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(team),
            });
            if (response.ok) {
              const result = await response.json();
              idMap[team.id] = result.team.id;
            }
          } catch (error) {
            console.error('导入队伍到数据库失败:', error);
          }
        }

        // 使用新的数据库ID来建立队伍-选手关系
        for (const team of (data.teams || [])) {
          try {
            const newTeamId = idMap[team.id];
            if (!newTeamId) continue;
            const playerIds = team.players.map(p => p.id);
            await fetch('/api/team-players', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ teamId: newTeamId, playerIds }),
            });
          } catch (error) {
            console.error('更新队伍选手关系失败:', error);
          }
        }

        // 更新前端状态中的队伍ID为数据库生成的ID
        const updatedTeams = (data.teams || []).map(team => ({
          ...team,
          id: idMap[team.id] || team.id,
        }));
        setTeams(updatedTeams);

        alert('数据导入成功！');
      } catch (error) {
        console.error('导入配置失败:', error);
        alert('导入配置失败，请检查文件格式是否正确');
      }
    };
    reader.readAsText(file);
  }, []);

  return {
    isAddingTeam,
    addTeam,
    deleteTeam,
    addPlayerToTeam,
    removePlayerFromTeam,
    resetAssignments,
    saveConfig,
    importConfig,
  };
}
