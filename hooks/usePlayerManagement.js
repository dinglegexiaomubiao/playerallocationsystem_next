import { useState, useCallback } from 'react';

export function usePlayerManagement(currentTournament, unassignedPlayers, setUnassignedPlayers) {
  const [isCreatingPlayer, setIsCreatingPlayer] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState(null);
  const [selectedHeroes, setSelectedHeroes] = useState([]);
  const [selectedSynergyPlayers, setSelectedSynergyPlayers] = useState([]);
  const [playerFormData, setPlayerFormData] = useState({
    nickname: '', game_id: '', group_nickname: '', score: '', win_rate: 0, championships: 0, positions: []
  });

  const resetPlayerForm = useCallback(() => {
    setEditingPlayer(null);
    setPlayerFormData({ nickname: '', game_id: '', group_nickname: '', score: '', win_rate: 0, championships: 0, positions: [] });
    setSelectedHeroes([]);
    setSelectedSynergyPlayers([]);
  }, []);

  const editPlayer = useCallback((player) => {
    setEditingPlayer(player);
    setPlayerFormData({
      nickname: player.nickname || '',
      game_id: player.game_id || '',
      group_nickname: player.group_nickname || '',
      score: player.score || '',
      win_rate: player.win_rate || 0,
      championships: player.championships || 0,
      positions: player.positions || []
    });
    setSelectedHeroes(player.heroes || []);
    setSelectedSynergyPlayers(player.synergy_players || []);
  }, []);

  const updatePlayer = useCallback(async (playerId, playerData, teams, setTeams) => {
    const updatedUnassignedPlayers = unassignedPlayers.map(player => {
      if (player.id === playerId) {
        return { ...player, ...playerData, heroes: selectedHeroes, synergy_players: selectedSynergyPlayers, updated_at: new Date().toISOString() };
      }
      return player;
    });

    const updatedTeams = teams.map(team => ({
      ...team,
      players: team.players.map(player => {
        if (player.id === playerId) {
          return { ...player, ...playerData, heroes: selectedHeroes, synergy_players: selectedSynergyPlayers, updated_at: new Date().toISOString() };
        }
        return player;
      }),
      updated_at: new Date().toISOString()
    }));

    setUnassignedPlayers(updatedUnassignedPlayers);
    setTeams(updatedTeams);

    try {
      const response = await fetch('/api/players', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, player: playerData, tournament_id: currentTournament?.id }),
      });
      const responseData = await response.json();
      if (!response.ok) throw new Error(responseData.error || '更新选手失败');

      if (responseData.success && responseData.player) {
        const updatedPlayer = responseData.player;
        const formatPlayer = (p) => ({
          ...updatedPlayer,
          id: updatedPlayer.id?.toString(),
          game_id: updatedPlayer.game_id?.toString(),
          score: updatedPlayer.score ? parseInt(updatedPlayer.score) : 0,
          win_rate: updatedPlayer.win_rate ? parseInt(updatedPlayer.win_rate) : 0,
          championships: updatedPlayer.championships ? parseInt(updatedPlayer.championships) : 0,
          positions: updatedPlayer.positions ? updatedPlayer.positions.split(',').filter(p => p) : [],
          heroes: updatedPlayer.heroes ? updatedPlayer.heroes.split(',').filter(h => h) : [],
          synergy_players: updatedPlayer.synergy_players ? updatedPlayer.synergy_players.split(',').filter(sp => sp) : [],
          created_at: updatedPlayer.created_at || "",
          updated_at: updatedPlayer.updated_at || "",
          position_priority: {},
          synergyPlayers: [],
          team_name: p.team_name
        });

        setUnassignedPlayers(prev => prev.map(p => p.id === playerId ? { ...formatPlayer(p), team_name: 'unassigned' } : p));
        setTeams(prev => prev.map(team => ({
          ...team,
          players: team.players.map(p => p.id === playerId ? formatPlayer(p) : p),
          updated_at: new Date().toISOString()
        })));
      }
    } catch (error) {
      console.error('更新选手API记录失败:', error);
      alert(`更新选手失败: ${error.message}`);
      // 回滚
      setUnassignedPlayers(unassignedPlayers);
      setTeams(teams);
    }
  }, [unassignedPlayers, selectedHeroes, selectedSynergyPlayers, currentTournament]);

  const createNewPlayer = useCallback(async (playerData, teams, setTeams) => {
    setIsCreatingPlayer(true);
    if (editingPlayer) {
      await updatePlayer(editingPlayer.id, playerData, teams, setTeams);
    } else {
      const newPlayer = {
        id: Date.now().toString(),
        ...playerData,
        heroes: selectedHeroes,
        synergy_players: selectedSynergyPlayers,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        team_name: "unassigned"
      };
      setUnassignedPlayers(prev => [...prev, newPlayer]);
      try {
        const response = await fetch('/api/players', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...newPlayer, tournament_id: currentTournament?.id }),
        });
        const responseData = await response.json();
        if (!response.ok) throw new Error(responseData.error || '添加选手失败');
        alert('选手添加成功');
      } catch (error) {
        console.error('添加选手到API失败:', error);
        alert('选手添加失败');
      }
    }
    resetPlayerForm();
    setIsCreatingPlayer(false);
  }, [editingPlayer, selectedHeroes, selectedSynergyPlayers, currentTournament, resetPlayerForm, updatePlayer]);

  const deletePlayer = useCallback(async (playerId, teams, setTeams) => {
    if (window.confirm('确定要删除这个选手吗？')) {
      const prevUnassigned = [...unassignedPlayers];
      const prevTeams = [...teams];
      setUnassignedPlayers(prev => prev.filter(player => player.id !== playerId));
      setTeams(prev => prev.map(team => ({
        ...team,
        players: team.players.filter(player => player.id !== playerId),
        updated_at: new Date().toISOString()
      })));
      try {
        const response = await fetch('/api/players', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: playerId }),
        });
        if (!response.ok) throw new Error('删除选手失败');
      } catch (error) {
        console.error('从API删除选手失败:', error);
        setUnassignedPlayers(prevUnassigned);
        setTeams(prevTeams);
      }
    }
  }, [unassignedPlayers]);

  const copyPlayerGameId = useCallback((gameId) => {
    navigator.clipboard.writeText(gameId);
    alert('steamID已复制到剪贴板');
  }, []);

  return {
    isCreatingPlayer,
    editingPlayer, setEditingPlayer,
    selectedHeroes, setSelectedHeroes,
    selectedSynergyPlayers, setSelectedSynergyPlayers,
    playerFormData, setPlayerFormData,
    resetPlayerForm,
    editPlayer,
    createNewPlayer,
    deletePlayer,
    copyPlayerGameId,
    updatePlayer,
  };
}
