import { useState, useCallback } from 'react';

export function useTeamManagement(currentTournament, teams, setTeams, unassignedPlayers, setUnassignedPlayers) {
  const [teamIdCounter, setTeamIdCounter] = useState(1);
  const [isAddingTeam, setIsAddingTeam] = useState(false);

  // 计算下一个可用的队伍ID
  const getNextTeamId = useCallback((existingTeams) => {
    const usedIds = existingTeams.map(t => t.id).sort((a, b) => a - b);
    let nextId = 1;
    for (const id of usedIds) {
      if (id === nextId) nextId++;
      else if (id > nextId) break;
    }
    return nextId;
  }, []);

  const addTeam = useCallback(async () => {
    setIsAddingTeam(true);
    if (!currentTournament?.id) {
      alert('请先选择一个赛季，然后才能添加队伍！');
      setIsAddingTeam(false);
      return;
    }

    const newId = getNextTeamId(teams);
    const newTeam = {
      id: newId,
      name: `队伍${newId}`,
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
        setTeamIdCounter(getNextTeamId([...teams, newTeam]));
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
  }, [currentTournament, teams, getNextTeamId]);

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

        for (const team of (data.teams || [])) {
          try {
            await fetch('/api/teams', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(team),
            });
          } catch (error) {
            console.error('导入队伍到数据库失败:', error);
          }
        }

        for (const team of (data.teams || [])) {
          try {
            const playerIds = team.players.map(p => p.id);
            await fetch('/api/team-players', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ teamId: team.id, playerIds }),
            });
          } catch (error) {
            console.error('更新队伍选手关系失败:', error);
          }
        }

        alert('数据导入成功！');
      } catch (error) {
        console.error('导入配置失败:', error);
        alert('导入配置失败，请检查文件格式是否正确');
      }
    };
    reader.readAsText(file);
  }, []);

  return {
    teamIdCounter, setTeamIdCounter,
    isAddingTeam,
    addTeam,
    deleteTeam,
    addPlayerToTeam,
    removePlayerFromTeam,
    resetAssignments,
    saveConfig,
    importConfig,
    getNextTeamId,
  };
}
