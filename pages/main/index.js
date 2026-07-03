import Head from 'next/head';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import PlayerCard from '../../components/PlayerCard';
import TeamCard from '../../components/TeamCard';
import { useRouter } from 'next/router';
import TournamentSelector from '../../components/TournamentSelector';
import EditTournamentResults from '../../components/EditTournamentResults';
import { useMessages } from '../../hooks/useMessages';
import { useTournaments } from '../../hooks/useTournaments';
import { usePlayerManagement } from '../../hooks/usePlayerManagement';
import { useTeamManagement } from '../../hooks/useTeamManagement';
import heroesList from '../../lib/heroesData';

export default function Home() {
  const router = useRouter();
  const importFileRef = useRef(null);
  const [user, setUser] = useState(null);
  const [loadingState, setLoadingState] = useState({ teams: 'loading', players: 'loading', error: null });

  // UI states
  const [showNewPlayerModal, setShowNewPlayerModal] = useState(false);
  const [showAddPlayerModal, setShowAddPlayerModal] = useState(false);
  const [showHeroesModal, setShowHeroesModal] = useState(false);
  const [showSynergyModal, setShowSynergyModal] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [showSelectTeamModal, setShowSelectTeamModal] = useState(false);
  const [selectedPlayerForJoin, setSelectedPlayerForJoin] = useState(null);
  const [modalSearchTerm, setModalSearchTerm] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [positionFilters, setPositionFilters] = useState([]);
  const [synergySearchTerm, setSynergySearchTerm] = useState('');

  // Data states
  const [teams, setTeams] = useState([]);
  const [unassignedPlayers, setUnassignedPlayers] = useState([]);

  // Debounce search
  const searchTimerRef = useRef(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 200);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchTerm]);

  // Hooks
  const tournamentMgmt = useTournaments(setTeams, setUnassignedPlayers);
  const playerMgmt = usePlayerManagement(tournamentMgmt.currentTournament, unassignedPlayers, setUnassignedPlayers);
  const teamMgmt = useTeamManagement(tournamentMgmt.currentTournament, teams, setTeams, unassignedPlayers, setUnassignedPlayers);
  const messageMgmt = useMessages();

  const {
    currentTournament,
    showTournamentSelector, setShowTournamentSelector,
    showEditTournamentResults, setShowEditTournamentResults,
    isSwitchingTournament,
    tournaments,
    handleTournamentSelect,
    handleSaveTournamentResults,
  } = tournamentMgmt;

  const {
    isCreatingPlayer,
    editingPlayer, setEditingPlayer,
    selectedHeroes, setSelectedHeroes,
    selectedSynergyPlayers, setSelectedSynergyPlayers,
    playerFormData, setPlayerFormData,
    resetPlayerForm, editPlayer, createNewPlayer, deletePlayer: deletePlayerBase, copyPlayerGameId,
    updatePlayer,
  } = playerMgmt;

  const {
    isAddingTeam,
    addTeam, deleteTeam: deleteTeamBase,
    addPlayerToTeam, removePlayerFromTeam,
    resetAssignments, saveConfig, importConfig,
  } = teamMgmt;

  // Loading state management
  useEffect(() => {
    if (unassignedPlayers.length >= 0) {
      setLoadingState(prev => ({ ...prev, players: 'loaded' }));
    }
  }, [unassignedPlayers]);

  useEffect(() => {
    if (teams.length >= 0) {
      setLoadingState(prev => ({ ...prev, teams: 'loaded' }));
    }
  }, [teams]);

  // User auth check
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    } else {
      router.push('/login');
    }
  }, [router]);

  // Pre-compute assigned players (stable reference)
  const assignedPlayers = useMemo(
    () => teams.flatMap(team => team.players),
    [teams]
  );

  // Memoized assigned player ID set
  const assignedPlayerIds = useMemo(
    () => new Set(assignedPlayers.map(p => p.id)),
    [assignedPlayers]
  );

  // Wrapper functions
  const deletePlayer = useCallback((playerId) => deletePlayerBase(playerId, teams, setTeams), [deletePlayerBase, teams]);
  const createNewPlayerWrapped = useCallback(async (playerData) => {
    await createNewPlayer(playerData, teams, setTeams);
    setShowNewPlayerModal(false);
  }, [createNewPlayer, teams]);

  const deleteTeam = useCallback((teamId) => deleteTeamBase(teamId), [deleteTeamBase]);

  // Join team modal handlers
  const openJoinTeamModal = useCallback((playerId) => {
    setSelectedPlayerForJoin(playerId);
    setShowSelectTeamModal(true);
  }, []);

  const joinPlayerToTeam = useCallback((teamId) => {
    if (selectedPlayerForJoin) {
      addPlayerToTeam(selectedPlayerForJoin, teamId);
      setShowSelectTeamModal(false);
      setSelectedPlayerForJoin(null);
    }
  }, [selectedPlayerForJoin, addPlayerToTeam]);

  // Modal handlers
  const handleEditPlayer = useCallback((player) => {
    editPlayer(player);
    setShowNewPlayerModal(true);
  }, [editPlayer]);

  const openAddPlayerModal = useCallback((teamId) => {
    setSelectedTeamId(teamId);
    setShowAddPlayerModal(true);
    setModalSearchTerm('');
  }, []);

  const addPlayerFromModal = useCallback((playerId) => {
    if (selectedTeamId) {
      addPlayerToTeam(playerId, selectedTeamId);
      setShowAddPlayerModal(false);
      setSelectedTeamId(null);
    }
  }, [selectedTeamId, addPlayerToTeam]);

  const openHeroesModal = useCallback((e) => {
    e.preventDefault();
    setShowHeroesModal(true);
  }, []);

  const openSynergyModal = useCallback(() => {
    setShowSynergyModal(true);
    setSynergySearchTerm('');
  }, []);

  const confirmHeroesSelection = useCallback(() => setShowHeroesModal(false), []);
  const confirmSynergySelection = useCallback(() => setShowSynergyModal(false), []);

  const toggleHeroSelection = useCallback((heroName) => {
    setSelectedHeroes(prev =>
      prev.includes(heroName) ? prev.filter(name => name !== heroName) : [...prev, heroName]
    );
  }, [setSelectedHeroes]);

  const toggleSynergyPlayerSelection = useCallback((playerId) => {
    setSelectedSynergyPlayers(prev =>
      prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]
    );
  }, [setSelectedSynergyPlayers]);

  const closeNewPlayerModal = useCallback(() => {
    setShowNewPlayerModal(false);
    resetPlayerForm();
  }, [resetPlayerForm]);

  // Player ID to nickname map for resolving synergy player names
  const playerNameMap = useMemo(() => {
    const map = new Map();
    [...unassignedPlayers, ...assignedPlayers].forEach(p => {
      map.set(p.id, p.nickname);
    });
    return map;
  }, [unassignedPlayers, assignedPlayers]);

  // Memoized filter function
  const filterPlayer = useCallback((player, term) => {
    if (!term) return true;
    const t = term.toLowerCase();
    if (
      (player.nickname && player.nickname.toLowerCase().includes(t)) ||
      (player.game_id && player.game_id.toLowerCase().includes(t)) ||
      (player.group_nickname && player.group_nickname.toLowerCase().includes(t)) ||
      (player.positions && player.positions.some(pos => pos.toLowerCase().includes(t))) ||
      (player.heroes && player.heroes.some(hero => hero.toLowerCase().includes(t)))
    ) return true;
    // search synergy players by resolved nickname
    if (player.synergy_players && player.synergy_players.some(partnerId => {
      const name = playerNameMap.get(partnerId);
      return name ? name.toLowerCase().includes(t) : String(partnerId).toLowerCase().includes(t);
    })) return true;
    return false;
  }, [playerNameMap]);

  // Memoized filtered player list
  const allPlayers = useMemo(() => {
    return [...assignedPlayers, ...unassignedPlayers].filter(player => {
      if (debouncedSearchTerm && !filterPlayer(player, debouncedSearchTerm)) return false;
      if (positionFilters.length > 0) {
        if (!player.positions || !player.positions.some(pos => positionFilters.includes(pos))) return false;
      }
      return true;
    });
  }, [assignedPlayers, unassignedPlayers, debouncedSearchTerm, positionFilters, filterPlayer]);

  // Memoized modal filtered players
  const modalFilteredPlayers = useMemo(() => {
    return unassignedPlayers.filter(player => filterPlayer(player, modalSearchTerm));
  }, [unassignedPlayers, modalSearchTerm, filterPlayer]);

  // All players for synergy search
  const allPlayersForSynergy = useMemo(
    () => [...unassignedPlayers, ...assignedPlayers],
    [unassignedPlayers, assignedPlayers]
  );

  const synergyFilteredPlayers = useMemo(() => {
    return allPlayersForSynergy.filter(player => filterPlayer(player, synergySearchTerm));
  }, [allPlayersForSynergy, synergySearchTerm, filterPlayer]);

  // Memoized stat values
  const totalPlayerCount = useMemo(
    () => unassignedPlayers.length + assignedPlayers.length,
    [unassignedPlayers.length, assignedPlayers.length]
  );

  // Score class for stat card
  const getTournamentScoreClass = useCallback((score) => {
    if (score >= 20000) return 'score-master';
    if (score >= 15000) return 'score-diamond';
    if (score >= 10000) return 'score-platinum';
    if (score >= 5000) return 'score-gold';
    return 'score-silver';
  }, []);

  const isLoading = loadingState.teams === 'loading' || loadingState.players === 'loading';

  return (
    <div className="container">
      <Head>
        <title>Dom的活动记录</title>
        <meta name="description" content="比赛选手人员分配系统" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {isSwitchingTournament && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-spinner"></div>
            <div className="loading-text">切换赛季中...</div>
          </div>
        </div>
      )}

      {(isAddingTeam || isCreatingPlayer) && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-spinner"></div>
            <div className="loading-text">
              {isAddingTeam ? '正在添加队伍...' : '正在添加选手...'}
            </div>
          </div>
        </div>
      )}

      <header className="header">
        <h1>Dom的比赛纪录</h1>
        <div className="instructions">
          <p>点击选手卡片上的「➕ 入队」按钮进行分配 | 点击队伍中的「+ 添加选手」选择选手 | 支持搜索和筛选功能</p>
        </div>

        <div className="stats-cards">
          <div className="stat-card total-players">
            <div className="stat-icon">🎮</div>
            <div className="stat-info">
              <div className="stat-title">本次参加人数</div>
              <div className="stat-value">
                {isLoading ? '...' : totalPlayerCount}
              </div>
            </div>
          </div>

          <div className="stat-card unassigned-players">
            <div className="stat-icon">⏳</div>
            <div className="stat-info">
              <div className="stat-title">未进队人数</div>
              <div className="stat-value">
                {isLoading ? '...' : unassignedPlayers.length}
              </div>
            </div>
          </div>

          <div className="stat-card teams">
            <div className="stat-icon">👥</div>
            <div className="stat-info">
              <div className="stat-title">参与队伍数</div>
              <div className="stat-value">
                {isLoading ? '...' : teams.length}
              </div>
            </div>
          </div>

          <div className="stat-card user-info">
            <div className="stat-icon">🏆</div>
            <div className="stat-info">
              <div className="stat-title">
                {currentTournament ? `第${currentTournament.id}届:${currentTournament.name}` : '赛季信息'}
              </div>
              <div className="stat-value">
                {currentTournament?.champion_team_id
                  ? `冠军队伍:${currentTournament.champion_team_id}`
                  : '暂无冠军信息'}
              </div>
            </div>
          </div>
        </div>

        <div className="tournament-controls">
          <button
            className="tournament-button"
            onClick={() => setShowTournamentSelector(true)}
          >
            {currentTournament ? currentTournament.name : '选择赛季'} ▼
          </button>
          {currentTournament && (
            <button
              className="edit-results-button"
              onClick={() => setShowEditTournamentResults(true)}
            >
              编辑结果
            </button>
          )}
        </div>
      </header>

      <main className="main-content">
        <section className="teams-section">
          <div className="section-header">
            <h2>参赛队伍及人员</h2>
            <div className="section-actions">
              <button className="btn btn-primary" onClick={resetAssignments}>重置分配</button>
              <button className="btn btn-primary" onClick={() => setShowNewPlayerModal(true)} disabled={isCreatingPlayer}>
                {isCreatingPlayer ? '添加中...' : '+ 新增选手'}
              </button>
              <button className="btn btn-primary" onClick={addTeam} disabled={isAddingTeam}>
                {isAddingTeam ? '添加中...' : '+ 添加队伍'}
              </button>
            </div>
          </div>
          <div className="teams-container">
            {loadingState.teams === 'loading' ? (
              <>
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="skeleton-card">
                    <div className="skeleton skeleton-line wide" style={{ height: 18, marginBottom: 14 }} />
                    <div className="skeleton skeleton-line medium" style={{ height: 14, marginBottom: 10 }} />
                    <div className="skeleton skeleton-line narrow" style={{ height: 14, marginBottom: 20 }} />
                    <div className="skeleton skeleton-line" style={{ height: 32, width: '100%' }} />
                  </div>
                ))}
              </>
            ) : loadingState.teams === 'error' ? (
              <div className="error-message">{loadingState.error || '加载队伍信息失败，请刷新页面重试'}</div>
            ) : (
              teams.map(team => (
                <TeamCard
                  key={team.id}
                  team={team}
                  onAddPlayer={() => openAddPlayerModal(team.id)}
                  onRemovePlayer={(playerId) => removePlayerFromTeam(playerId, team.id)}
                  onDeleteTeam={() => deleteTeam(team.id)}
                  playerNameMap={playerNameMap}
                />
              ))
            )}
          </div>
        </section>

        <section className="players-section">
          <div className="section-header">
            <h2>参赛选手</h2>
            <div className="search-container">
              <input
                type="text"
                placeholder="搜索选手昵称、steamID、群昵称、擅长位置或英雄..."
                className="search-input"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                disabled={isLoading}
              />
              <div className="position-filters">
                {['优势路', '中单', '劣势路', '半辅助', '纯辅助', '全才'].map(pos => (
                  <label key={pos}>
                    <input
                      type="checkbox"
                      value={pos}
                      checked={positionFilters.includes(pos)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setPositionFilters([...positionFilters, pos]);
                        } else {
                          setPositionFilters(positionFilters.filter(p => p !== pos));
                        }
                      }}
                      disabled={isLoading}
                    /> {pos}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="players-container">
            {loadingState.players === 'loading' ? (
              <>
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="skeleton-card">
                    <div className="skeleton skeleton-line wide" style={{ height: 18, marginBottom: 10 }} />
                    <div className="skeleton skeleton-line medium" style={{ height: 14, marginBottom: 8 }} />
                    <div className="skeleton skeleton-line narrow" style={{ height: 14, marginBottom: 14 }} />
                    <div className="skeleton-stat">
                      <div className="skeleton skeleton-stat-item" />
                      <div className="skeleton skeleton-stat-item" />
                    </div>
                  </div>
                ))}
              </>
            ) : loadingState.players === 'error' ? (
              <div className="error-message">{loadingState.error || '加载选手信息失败，请刷新页面重试'}</div>
            ) : (
              allPlayers.map((player, index) => {
                const isAssignedPlayer = assignedPlayerIds.has(player.id);
                const prevPlayer = index > 0 ? allPlayers[index - 1] : null;
                const showDivider = !isAssignedPlayer && prevPlayer && assignedPlayerIds.has(prevPlayer.id);

                return (
                  <div key={player.id}>
                    {showDivider && (
                      <div className="player-section-divider">
                        <span className="divider-text">未分配选手</span>
                      </div>
                    )}
                    <PlayerCard
                      player={player}
                      onJoinTeam={!isAssignedPlayer ? openJoinTeamModal : null}
                      onEdit={handleEditPlayer}
                      onDelete={deletePlayer}
                      onCopy={copyPlayerGameId}
                      className={isAssignedPlayer ? 'assigned-player' : ''}
                      playerNameMap={playerNameMap}
                    />
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>

      <button
        className="message-board-toggle"
        onClick={() => messageMgmt.setShowMessageBoard(!messageMgmt.showMessageBoard)}
      >
        <span className="message-board-icon">💬</span>
        留言板
      </button>

      {messageMgmt.showRandomMessage && messageMgmt.randomMessage && (
        <div className="random-message-container">
          <div className="random-message">
            <div className="random-message-content">
              <div className="random-message-header">
                <span className="random-message-username">{messageMgmt.randomMessage.username}</span>
                <span className="random-message-time">
                  {new Date(messageMgmt.randomMessage.created_at).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                  })}
                </span>
              </div>
              <div className="random-message-text">{messageMgmt.randomMessage.content}</div>
            </div>
            <button
              className="close-random-message"
              onClick={() => messageMgmt.setShowRandomMessage(false)}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {messageMgmt.showMessageBoard && (
        <div className="message-board-overlay">
          <div className="message-board">
            <div className="message-board-header">
              <h3>留言板</h3>
              <button
                className="close-message-board"
                onClick={() => messageMgmt.setShowMessageBoard(false)}
              >
                ×
              </button>
            </div>

            <div className="message-board-content">
              <div className="messages-list">
                {messageMgmt.messages.length === 0 ? (
                  <div className="no-messages">暂无留言</div>
                ) : (
                  messageMgmt.messages.map(message => (
                    <div key={message.id} className="message-item">
                      <div className="message-header">
                        <span className="message-username">{message.username}</span>
                        <span className="message-time">
                          {new Date(message.created_at).toLocaleString('zh-CN', {
                            timeZone: 'Asia/Shanghai',
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: false
                          })}
                        </span>
                      </div>
                      <div className="message-content">{message.content}</div>
                      <div className="message-actions">
                        <button
                          className="like-button"
                          onClick={() => messageMgmt.likeMessage(message.id)}
                        >
                          {messageMgmt.likedMessages.has(message.id) ? '👍 取消点赞 ' : '👍 点赞 '}
                          {message.likes || 0}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="message-form">
                <h4>发表留言</h4>
                <form onSubmit={messageMgmt.handleSubmitMessage}>
                  <div className="form-group">
                    <input
                      type="text"
                      placeholder="用户名"
                      value={messageMgmt.newMessage.username}
                      onChange={(e) => messageMgmt.setNewMessage({ ...messageMgmt.newMessage, username: e.target.value })}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <textarea
                      placeholder="留言内容"
                      value={messageMgmt.newMessage.content}
                      onChange={(e) => messageMgmt.setNewMessage({ ...messageMgmt.newMessage, content: e.target.value })}
                      className="form-textarea"
                      rows="3"
                    />
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary">发表留言</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add player to team modal */}
      {showAddPlayerModal && (
        <div className="modal active show" style={{ display: 'flex' }}>
          <div className="modal-backdrop" onClick={() => setShowAddPlayerModal(false)}></div>
          <div className="modal-content">
            <div className="modal-header">
              <h3>添加选手到队伍</h3>
              <button className="modal-close" onClick={() => setShowAddPlayerModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                placeholder="搜索选手昵称、steamID、群昵称、擅长位置、擅长英雄或默契选手..."
                className="modal-search-input"
                value={modalSearchTerm}
                onChange={(e) => setModalSearchTerm(e.target.value)}
              />
              <div className="modal-players-list">
                {modalFilteredPlayers.map(player => (
                  <div
                    key={player.id}
                    className="modal-player-item"
                    onClick={() => addPlayerFromModal(player.id)}
                  >
                    <PlayerCard player={player} isModalView={true} />
                  </div>
                ))}
                {modalFilteredPlayers.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px', color: '#94a3b8' }}>
                    {modalSearchTerm ? '没有匹配的选手' : '没有可用选手'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New/Edit player modal */}
      {showNewPlayerModal && (
        <div className="modal active show" style={{ display: 'flex' }}>
          <div className="modal-backdrop" onClick={closeNewPlayerModal}></div>
          <div className="modal-content large-modal">
            <div className="modal-header">
              <h3>{editingPlayer ? '编辑选手' : '新增选手'}</h3>
              <button className="modal-close" onClick={closeNewPlayerModal}>&times;</button>
            </div>
            <div className="modal-body">
              <form className="new-player-form" onSubmit={(e) => {
                e.preventDefault();
                const playerData = {
                  nickname: playerFormData.nickname,
                  game_id: playerFormData.game_id,
                  group_nickname: playerFormData.group_nickname,
                  score: parseInt(playerFormData.score) || 0,
                  positions: playerFormData.positions,
                  heroes: selectedHeroes,
                  synergy_players: selectedSynergyPlayers,
                  win_rate: parseInt(playerFormData.win_rate) || 0,
                  championships: parseInt(playerFormData.championships) || 0
                };
                createNewPlayerWrapped(playerData);
              }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>选手昵称 *</label>
                    <input type="text" required value={playerFormData.nickname} onChange={(e) => setPlayerFormData({ ...playerFormData, nickname: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>steamID *</label>
                    <input type="text" required value={playerFormData.game_id} onChange={(e) => setPlayerFormData({ ...playerFormData, game_id: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>群昵称</label>
                    <input type="text" value={playerFormData.group_nickname} onChange={(e) => setPlayerFormData({ ...playerFormData, group_nickname: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>天梯分数 *</label>
                    <input type="number" min="0" max="30000" required value={playerFormData.score} onChange={(e) => setPlayerFormData({ ...playerFormData, score: e.target.value })} />
                    <div className="score-preview">
                      {(() => {
                        const s = parseInt(playerFormData.score) || 0;
                        if (s >= 5420) return <span className="score-master">冠绝一世 ({s})</span>;
                        if (s >= 4620) return <span className="score-diamond">超凡入圣 ({s})</span>;
                        if (s >= 3850) return <span className="score-platinum">万古流芳 ({s})</span>;
                        if (s >= 2310) return <span className="score-gold">传奇 ({s})</span>;
                        if (s >= 2310) return <span className="score-gold">统帅 ({s})</span>;
                        if (s > 1540) return <span className="score-silver">中军 ({s})</span>;
                        if (s > 770) return <span className="score-silver">卫士 ({s})</span>;
                        if (s > 0) return <span className="score-silver">先锋 ({s})</span>;
                        return <span style={{color: '#94a3b8'}}>输入天梯分数后实时显示等级</span>;
                      })()}
                    </div>
                  </div>
                </div>
                <div className="form-group">
                  <label>擅长位置</label>
                  <div className="position-checkboxes">
                    {['优势路', '中单', '劣势路', '半辅助', '纯辅助', '全才'].map(pos => (
                      <label key={pos}>
                        <input
                          type="checkbox"
                          value={pos}
                          checked={playerFormData.positions.includes(pos)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPlayerFormData({ ...playerFormData, positions: [...playerFormData.positions, pos] });
                            } else {
                              setPlayerFormData({ ...playerFormData, positions: playerFormData.positions.filter(p => p !== pos) });
                            }
                          }}
                        /> {pos}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label>擅长英雄</label>
                  <div className="heroes-selector">
                    <div className="selected-heroes">
                      {selectedHeroes.map((hero, index) => (
                        <span key={index} className="hero-tag">
                          {hero}
                          <span
                            className="remove-tag"
                            onClick={(e) => {
                              e.preventDefault();
                              setSelectedHeroes(selectedHeroes.filter(h => h !== hero));
                            }}
                          >
                            ×
                          </span>
                        </span>
                      ))}
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={openHeroesModal}>
                      选择英雄
                    </button>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>最近胜率 (%)</label>
                    <input type="number" min="0" max="100" value={playerFormData.win_rate} onChange={(e) => setPlayerFormData({ ...playerFormData, win_rate: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>冠军数量</label>
                    <input type="number" min="0" value={playerFormData.championships} onChange={(e) => setPlayerFormData({ ...playerFormData, championships: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label>默契选手</label>
                  <div className="synergy-selector">
                    <div className="selected-synergy">
                      {selectedSynergyPlayers.map((playerId, index) => {
                        const player = [...unassignedPlayers, ...teams.flatMap(t => t.players)].find(p => p.id === playerId);
                        return player ? (
                          <span key={index} className="hero-tag">
                            {player.nickname}
                            <span
                              className="remove-tag"
                              onClick={(e) => {
                                e.preventDefault();
                                setSelectedSynergyPlayers(selectedSynergyPlayers.filter(id => id !== playerId));
                              }}
                            >
                              ×
                            </span>
                          </span>
                        ) : null;
                      })}
                    </div>
                    <button type="button" className="btn btn-secondary" onClick={openSynergyModal}>
                      添加默契选手
                    </button>
                  </div>
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-secondary" onClick={closeNewPlayerModal}>取消</button>
                  <button type="submit" className="btn btn-primary">{editingPlayer ? '保存修改' : '创建选手'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Heroes select modal */}
      {showHeroesModal && (
        <div className="modal active show" style={{ display: 'flex' }}>
          <div className="modal-backdrop" onClick={() => setShowHeroesModal(false)}></div>
          <div className="modal-content">
            <div className="modal-header">
              <h3>选择擅长英雄</h3>
              <button className="modal-close" onClick={() => setShowHeroesModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <input type="text" placeholder="搜索英雄名称或别称..." className="modal-search-input" />
              <div className="heroes-list-container">
                <div className="heroes-grid">
                  {heroesList.map((hero, index) => (
                    <div
                      key={index}
                      className={`hero-item ${selectedHeroes.includes(hero.name) ? 'selected' : ''}`}
                      onClick={() => toggleHeroSelection(hero.name)}
                    >
                      <div className="hero-name">{hero.name}</div>
                      <div className="hero-nickname">{hero.nickname}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowHeroesModal(false)}>取消</button>
                <button className="btn btn-primary" onClick={confirmHeroesSelection}>确定选择</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Synergy select modal */}
      {showSynergyModal && (
        <div className="modal active show" style={{ display: 'flex' }}>
          <div className="modal-backdrop" onClick={() => setShowSynergyModal(false)}></div>
          <div className="modal-content">
            <div className="modal-header">
              <h3>选择默契选手</h3>
              <button className="modal-close" onClick={() => setShowSynergyModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                placeholder="搜索选手昵称、steamID、群昵称、擅长位置、擅长英雄或默契选手..."
                className="modal-search-input"
                value={synergySearchTerm}
                onChange={(e) => setSynergySearchTerm(e.target.value)}
              />
              <div className="modal-players-list">
                {synergyFilteredPlayers.map((player, index) => (
                  <div
                    key={index}
                    className={`modal-player-item ${selectedSynergyPlayers.includes(player.id) ? 'selected' : ''}`}
                    onClick={() => toggleSynergyPlayerSelection(player.id)}
                  >
                    <PlayerCard player={player} isModalView={true} />
                  </div>
                ))}
                {synergyFilteredPlayers.length === 0 && (
                  <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '20px', color: '#94a3b8' }}>
                    {synergySearchTerm ? '没有匹配的选手' : '没有可选选手'}
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowSynergyModal(false)}>取消</button>
                <button className="btn btn-primary" onClick={confirmSynergySelection}>确定选择</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tournament selector modal */}
      {showTournamentSelector && (
        <TournamentSelector
          currentTournament={currentTournament}
          onTournamentSelect={handleTournamentSelect}
          onClose={() => setShowTournamentSelector(false)}
        />
      )}

      {/* Edit tournament results modal */}
      {showEditTournamentResults && (
        <EditTournamentResults
          tournament={currentTournament}
          teams={teams}
          onSave={handleSaveTournamentResults}
          onClose={() => setShowEditTournamentResults(false)}
        />
      )}

      {/* Select team modal */}
      {showSelectTeamModal && (
        <div className="modal active show" style={{ display: 'flex' }}>
          <div className="modal-backdrop" onClick={() => setShowSelectTeamModal(false)}></div>
          <div className="modal-content">
            <div className="modal-header">
              <h3>选择要加入的队伍</h3>
              <button className="modal-close" onClick={() => setShowSelectTeamModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '60vh', overflowY: 'auto' }}>
                {teams.map(team => {
                  const teamScore = team.players.reduce((total, p) => total + (p.score || 0), 0);
                  const isFull = team.players.length >= 5;
                  return (
                    <div
                      key={team.id}
                      onClick={() => !isFull && joinPlayerToTeam(team.id)}
                      className={`team-select-item ${isFull ? 'team-select-full' : ''}`}
                    >
                      <div className="team-select-header">
                        <div className="team-select-name">{team.name}</div>
                        <div className="team-select-score">天梯总分: {teamScore}</div>
                      </div>
                      <div className="team-select-footer">
                        <div className="team-select-count">人数: {team.players.length}/5</div>
                        {isFull && (
                          <div className="team-select-full-tag">已满员</div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {teams.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8' }}>
                    暂无可加入的队伍，请先添加队伍
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
