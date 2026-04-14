import { useState, useEffect, useCallback } from 'react';

export function useTournaments(setTeams, setUnassignedPlayers) {
  const [currentTournament, setCurrentTournament] = useState(null);
  const [showTournamentSelector, setShowTournamentSelector] = useState(false);
  const [showEditTournamentResults, setShowEditTournamentResults] = useState(false);
  const [isSwitchingTournament, setIsSwitchingTournament] = useState(false);
  const [tournaments, setTournaments] = useState([]);

  const fetchTournamentData = useCallback(async (tournamentId) => {
    try {
      const [teamsRes, playersRes] = await Promise.all([
        fetch(`/api/teams?tournament_id=${tournamentId}`),
        fetch(`/api/players?tournament_id=${tournamentId}`),
      ]);
      const [teamsData, playersData] = await Promise.all([teamsRes.json(), playersRes.json()]);

      if (teamsData.success && playersData.success) {
        setTeams(teamsData.teams);
        const assignedPlayerIds = teamsData.teams.flatMap(team => team.players.map(p => p.id));
        const unassigned = playersData.players.filter(player => !assignedPlayerIds.includes(player.id));
        setUnassignedPlayers(unassigned);
      }
    } catch (error) {
      console.error('获取赛季数据失败:', error);
    }
  }, [setTeams, setUnassignedPlayers]);

  const handleTournamentSelect = useCallback((tournament) => {
    setIsSwitchingTournament(true);
    setCurrentTournament(tournament);
    fetchTournamentData(tournament.id).finally(() => {
      setIsSwitchingTournament(false);
    });
  }, [fetchTournamentData]);

  const handleSaveTournamentResults = useCallback((updatedTournament) => {
    if (updatedTournament) {
      setCurrentTournament(updatedTournament);
      setTournaments(prev => prev.map(t => t.id === updatedTournament.id ? updatedTournament : t));
    } else {
      const deletedId = currentTournament?.id;
      setCurrentTournament(null);
      setTournaments(prev => prev.filter(t => t.id !== deletedId));
      setTeams([]);
      setUnassignedPlayers([]);
    }
  }, [currentTournament, setTeams, setUnassignedPlayers]);

  useEffect(() => {
    const loadInitialTournament = async () => {
      try {
        const response = await fetch('/api/tournaments');
        const data = await response.json();
        if (data.success) {
          setTournaments(data.tournaments);
          if (data.tournaments.length > 0) {
            const first = data.tournaments[0];
            setCurrentTournament(first);
            await fetchTournamentData(first.id);
          }
        }
      } catch (error) {
        console.error('加载赛季数据失败:', error);
      }
    };
    loadInitialTournament();
  }, [fetchTournamentData]);

  return {
    currentTournament,
    showTournamentSelector, setShowTournamentSelector,
    showEditTournamentResults, setShowEditTournamentResults,
    isSwitchingTournament,
    tournaments,
    handleTournamentSelect,
    handleSaveTournamentResults,
  };
}
