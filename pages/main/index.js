import Head from 'next/head';
import { useState, useEffect, useRef } from 'react';
import PlayerCard from '../../components/PlayerCard';
import TeamCard from '../../components/TeamCard';
import { useRouter } from 'next/router';
import TournamentSelector from '../../components/TournamentSelector';
import EditTournamentResults from '../../components/EditTournamentResults';
import { useMessages } from '../../hooks/useMessages';
import { useTournaments } from '../../hooks/useTournaments';
import { usePlayerManagement } from '../../hooks/usePlayerManagement';
import { useTeamManagement } from '../../hooks/useTeamManagement';

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
  const [positionFilters, setPositionFilters] = useState([]);
  const [synergySearchTerm, setSynergySearchTerm] = useState('');

  // Data states (shared between hooks)
  const [teams, setTeams] = useState([]);
  const [unassignedPlayers, setUnassignedPlayers] = useState([]);

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
    teamIdCounter, setTeamIdCounter,
    isAddingTeam,
    addTeam, deleteTeam: deleteTeamBase,
    addPlayerToTeam, removePlayerFromTeam,
    resetAssignments, saveConfig, importConfig,
    getNextTeamId,
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

  // Team ID counter sync
  useEffect(() => {
    if (teams.length > 0) {
      setTeamIdCounter(getNextTeamId(teams));
    } else {
      setTeamIdCounter(1);
    }
  }, [teams, getNextTeamId]);

  // Wrapper functions to pass teams/setTeams where needed
  const deletePlayer = (playerId) => deletePlayerBase(playerId, teams, setTeams);
  const createNewPlayerWrapped = async (playerData) => {
    await createNewPlayer(playerData, teams, setTeams);
    setShowNewPlayerModal(false);
  };

  const deleteTeam = (teamId) => deleteTeamBase(teamId);

  // Join team modal handlers
  const openJoinTeamModal = (playerId) => {
    setSelectedPlayerForJoin(playerId);
    setShowSelectTeamModal(true);
  };

  const joinPlayerToTeam = (teamId) => {
    if (selectedPlayerForJoin) {
      addPlayerToTeam(selectedPlayerForJoin, teamId);
      setShowSelectTeamModal(false);
      setSelectedPlayerForJoin(null);
    }
  };

  // Modal handlers
  const handleEditPlayer = (player) => {
    editPlayer(player);
    setShowNewPlayerModal(true);
  };

  const openAddPlayerModal = (teamId) => {
    setSelectedTeamId(teamId);
    setShowAddPlayerModal(true);
    setModalSearchTerm('');
  };

  const addPlayerFromModal = (playerId) => {
    if (selectedTeamId) {
      addPlayerToTeam(playerId, selectedTeamId);
      setShowAddPlayerModal(false);
      setSelectedTeamId(null);
    }
  };

  const openHeroesModal = (e) => {
    e.preventDefault();
    setShowHeroesModal(true);
  };

  const openSynergyModal = () => {
    setShowSynergyModal(true);
    setSynergySearchTerm('');
  };

  const confirmHeroesSelection = () => setShowHeroesModal(false);

  const toggleHeroSelection = (heroName) => {
    if (selectedHeroes.includes(heroName)) {
      setSelectedHeroes(selectedHeroes.filter(name => name !== heroName));
    } else {
      setSelectedHeroes([...selectedHeroes, heroName]);
    }
  };

  const confirmSynergySelection = () => setShowSynergyModal(false);

  const toggleSynergyPlayerSelection = (playerId) => {
    if (selectedSynergyPlayers.includes(playerId)) {
      setSelectedSynergyPlayers(selectedSynergyPlayers.filter(id => id !== playerId));
    } else {
      setSelectedSynergyPlayers([...selectedSynergyPlayers, playerId]);
    }
  };

  // Heroes list data
  const heroesList = [
    {"id": 209, "name": "上古巨神", "nickname": "大牛,ET,力量"},
    {"id": 210, "name": "不朽尸王", "nickname": "尸王,DIRGE,力量"},
    {"id": 178, "name": "主宰", "nickname": "剑圣,Jugg,敏捷"},
    {"id": 272, "name": "亚巴顿", "nickname": "死骑,哑巴,LOA,全才"},
    {"id": 211, "name": "伐木机", "nickname": "花母鸡,伐木机,Timberraw,力量"},
    {"id": 241, "name": "修补匠", "nickname": "修补,TK,Tinker,智力"},
    {"id": 242, "name": "光之守卫", "nickname": "光法,白马,Koti,智力"},
    {"id": 179, "name": "克林克兹", "nickname": "骨弓,小骷髅,Clinkz,敏捷"},
    {"id": 212, "name": "全能骑士", "nickname": "全能,OK,力量"},
    {"id": 273, "name": "兽王", "nickname": "兽王,bm,全才"},
    {"id": 213, "name": "军团指挥官", "nickname": "军团,LC,力量"},
    {"id": 180, "name": "冥界亚龙", "nickname": "毒龙,Vip,敏捷"},
    {"id": 214, "name": "冥魂大帝", "nickname": "骷髅王,SNK,力量"},
    {"id": 274, "name": "凤凰", "nickname": "凤凰,phoanix,力量"},
    {"id": 303, "name": "凯", "nickname": "鸟人,敏捷"},
    {"id": 275, "name": "剧毒术士", "nickname": "剧毒,veno,全才"},
    {"id": 181, "name": "力丸", "nickname": "隐刺,SA,敏捷"},
    {"id": 215, "name": "半人马战行者", "nickname": "人马,CW,力量"},
    {"id": 182, "name": "卓尔游侠", "nickname": "小黑,黑弓,DROW,敏捷"},
    {"id": 276, "name": "发条技师", "nickname": "发条,clock,力量"},
    {"id": 183, "name": "变体精灵", "nickname": "水人,波高,morph,敏捷"},
    {"id": 277, "name": "司夜刺客", "nickname": "小强,NA,全才"},
    {"id": 216, "name": "哈斯卡", "nickname": "神灵,单车武士,Hus,力量"},
    {"id": 217, "name": "噬魂鬼", "nickname": "小狗,IS,力量"},
    {"id": 184, "name": "圣堂刺客", "nickname": "圣堂,TA,敏捷"},
    {"id": 278, "name": "复仇之魂", "nickname": "VS,敏捷"},
    {"id": 218, "name": "大地之灵", "nickname": "土猫,Earth,力量"},
    {"id": 243, "name": "天怒法师", "nickname": "天怒,龙鹰,SKY,智力"},
    {"id": 244, "name": "天涯墨客", "nickname": "墨客,Grimstroke,智力"},
    {"id": 185, "name": "天穹守望者", "nickname": "电狗,AW,敏捷"},
    {"id": 186, "name": "娜迦海妖", "nickname": "小娜迦,nage,敏捷"},
    {"id": 219, "name": "孽主", "nickname": "大屁股,UL,力量"},
    {"id": 245, "name": "宙斯", "nickname": "宙斯,Zeus,智力"},
    {"id": 279, "name": "寒冬飞龙", "nickname": "冰龙,WW,,智力"},
    {"id": 220, "name": "小小", "nickname": "小小,山岭,Tiny,力量"},
    {"id": 280, "name": "工程师", "nickname": "炸弹人,Techics,全才"},
    {"id": 221, "name": "巨牙海民", "nickname": "海民,Tusk,力量"},
    {"id": 187, "name": "巨魔战将", "nickname": "巨魔,Troll,敏捷"},
    {"id": 246, "name": "巫医", "nickname": "巫医,51,WD,智力"},
    {"id": 247, "name": "巫妖", "nickname": "巫妖,Lich,智力"},
    {"id": 248, "name": "帕克", "nickname": "帕克,大头苍蝇,精灵龙,puck,智力"},
    {"id": 222, "name": "帕吉", "nickname": "屠夫,Pudge,力量"},
    {"id": 249, "name": "帕格纳", "nickname": "骨法,Pugna,智力"},
    {"id": 250, "name": "干扰者", "nickname": "萨尔,Disruptor,智力"},
    {"id": 188, "name": "幻影刺客", "nickname": "幻刺,PA,敏捷"},
    {"id": 189, "name": "幻影长矛手", "nickname": "猴子,分身猴,PL,敏捷"},
    {"id": 190, "name": "幽鬼", "nickname": "幽鬼,UG,Spe,全才"},
    {"id": 191, "name": "影魔", "nickname": "影魔,SF,敏捷"},
    {"id": 192, "name": "恐怖利刃", "nickname": "魂守,TB,敏捷"},
    {"id": 281, "name": "戴泽", "nickname": "暗牧,Dazzle,全才"},
    {"id": 251, "name": "拉席克", "nickname": "老鹿,TS,智力"},
    {"id": 252, "name": "拉比克", "nickname": "大魔导,蜡笔,fy,Rubick,智力"},
    {"id": 223, "name": "撼地者", "nickname": "小牛,ES,力量"},
    {"id": 193, "name": "敌法师", "nickname": "敌法,AM,敏捷"},
    {"id": 224, "name": "斧王", "nickname": "斧王,Axe,力量"},
    {"id": 194, "name": "斯拉克", "nickname": "小鱼人,弟弟鱼,Slark,敏捷"},
    {"id": 225, "name": "斯拉达", "nickname": "大鱼,SL,力量"},
    {"id": 226, "name": "斯温", "nickname": "流浪,斯温,奥特曼,SV,力量"},
    {"id": 227, "name": "昆卡", "nickname": "船长,CoCo,力量"},
    {"id": 228, "name": "暗夜魔王", "nickname": "夜魔,NS,力量"},
    {"id": 253, "name": "暗影恶魔", "nickname": "毒狗,SD,智力"},
    {"id": 254, "name": "暗影萨满", "nickname": "小Y,SS,智力"},
    {"id": 229, "name": "末日使者", "nickname": "末日,Doom,力量"},
    {"id": 255, "name": "术士", "nickname": "术士,Warlock,智力"},
    {"id": 256, "name": "杰奇洛", "nickname": "双头龙,Jakiro,智力"},
    {"id": 230, "name": "树精卫士", "nickname": "大树,TP,力量"},
    {"id": 195, "name": "森海飞霞", "nickname": "小松鼠,Hoodwink,敏捷"},
    {"id": 257, "name": "死亡先知", "nickname": "DP,全才"},
    {"id": 258, "name": "殁境神蚀者", "nickname": "黑鸟,目光呆滞,OD,智力"},
    {"id": 259, "name": "水晶侍女", "nickname": "冰女,CM,智力"},
    {"id": 260, "name": "沉默术士", "nickname": "沉默,SIL,力量智力"},
    {"id": 282, "name": "沙王", "nickname": "沙王,蝎子,SK,全才"},
    {"id": 231, "name": "混沌骑士", "nickname": "混沌,CK,力量"},
    {"id": 232, "name": "潮汐猎人", "nickname": "潮汐,西瓜皮,TH,力量"},
    {"id": 196, "name": "灰烬之灵", "nickname": "火猫,ES,敏捷"},
    {"id": 233, "name": "炼金术士", "nickname": "炼金,GA,力量"},
    {"id": 197, "name": "熊战士", "nickname": "拍拍熊,Ursa,敏捷"},
    {"id": 198, "name": "狙击手", "nickname": "矮子,火枪,Sniper,敏捷"},
    {"id": 284, "name": "独行德鲁伊", "nickname": "德鲁伊,熊德,LD,敏捷"},
    {"id": 283, "name": "狼人", "nickname": "狼人,Lycan,力量"},
    {"id": 234, "name": "獸", "nickname": "畜,Beast,力量"},
    {"id": 235, "name": "玛尔斯", "nickname": "玛尔斯,Mars,力量"},
    {"id": 285, "name": "玛西", "nickname": "玛西,女拳,Marci,全才"},
    {"id": 261, "name": "琼英碧灵", "nickname": "奶绿,琼逼,Muerta,智力"},
    {"id": 286, "name": "电炎绝手", "nickname": "奶奶,老太婆,Snapfire,全才"},
    {"id": 262, "name": "痛苦女王", "nickname": "女王,QOP,智力"},
    {"id": 263, "name": "瘟疫法师", "nickname": "死灵法,Nec,智力"},
    {"id": 264, "name": "百戏大王", "nickname": "百戏,小丑,Ringmaster,智力"},
    {"id": 199, "name": "矮人直升机", "nickname": "飞机,gyr,敏捷"},
    {"id": 287, "name": "石鳞剑士", "nickname": "滚滚,Pangolier,全才"},
    {"id": 236, "name": "破晓辰星", "nickname": "大锤,锤妹,DB,力量"},
    {"id": 288, "name": "祈求者", "nickname": "卡尔,Invoker,智力"},
    {"id": 265, "name": "神谕者", "nickname": "神谕,Oracle,智力"},
    {"id": 289, "name": "祸乱之源", "nickname": "祸乱,水桶腰,Bane,全才"},
    {"id": 290, "name": "米拉娜", "nickname": "白虎,Pom,全才"},
    {"id": 200, "name": "米波", "nickname": "地狗,米波,Meepo,敏捷"},
    {"id": 291, "name": "维萨吉", "nickname": "死灵龙,Vis,全才"},
    {"id": 201, "name": "编织者", "nickname": "蚂蚁,Weaver,敏捷"},
    {"id": 202, "name": "美杜莎", "nickname": "一姐,大娜迦,Med,敏捷"},
    {"id": 292, "name": "育母蜘蛛", "nickname": "蜘蛛,Broodmother,全才"},
    {"id": 266, "name": "自然先知", "nickname": "先知,FUR,全才"},
    {"id": 293, "name": "艾欧", "nickname": "小精灵,IO,全才"},
    {"id": 267, "name": "莉娜", "nickname": "莉娜,火女,lina,智力"},
    {"id": 268, "name": "莱恩", "nickname": "莱恩,若风巫师,Lion,智力"},
    {"id": 294, "name": "虚无之灵", "nickname": "紫猫,Void Spirit,全才"},
    {"id": 203, "name": "虚空假面", "nickname": "虚空,J8脸,FV,敏捷"},
    {"id": 295, "name": "蝙蝠骑士", "nickname": "蝙蝠,Bat,全才"},
    {"id": 204, "name": "血魔", "nickname": "血魔,BS,敏捷"},
    {"id": 237, "name": "裂魂人", "nickname": "白牛,SB,力量"},
    {"id": 296, "name": "谜团", "nickname": "谜团,Enigma,全才"},
    {"id": 205, "name": "赏金猎人", "nickname": "赏金,BH,力量"},
    {"id": 269, "name": "远古冰魄", "nickname": "冰魂,AA,智力"},
    {"id": 297, "name": "邪影芳灵", "nickname": "小仙女,花仙,Dark Willow,智力"},
    {"id": 298, "name": "酒仙", "nickname": "熊猫,PB,全才"},
    {"id": 238, "name": "钢背兽", "nickname": "刚被,BB猪,BB,力量"},
    {"id": 299, "name": "陈", "nickname": "圣骑,CHEN,全才"},
    {"id": 206, "name": "雷泽", "nickname": "电棍,电魂,Razor,敏捷"},
    {"id": 207, "name": "露娜", "nickname": "月骑,露娜,Luna,敏捷"},
    {"id": 270, "name": "风暴之灵", "nickname": "蓝猫,电猫,Storm,智力"},
    {"id": 300, "name": "风行者", "nickname": "风行,WR,全才"},
    {"id": 239, "name": "食人魔魔法师", "nickname": "蓝胖,OM,力量"},
    {"id": 301, "name": "马格纳斯", "nickname": "猛犸,颠勺,Magnus,全才"},
    {"id": 271, "name": "魅惑魔女", "nickname": "小鹿,Enchantress,智力"},
    {"id": 302, "name": "黑暗贤者", "nickname": "黑贤,兔子,DS,全才"},
    {"id": 208, "name": "齐天大圣", "nickname": "大圣,Monkey King,敏捷"},
    {"id": 240, "name": "龙骑士", "nickname": "龙骑,DK,力量"}
  ];

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

      <div className="container">
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
                <div className="stat-value" id="totalPlayersCount">
                  {loadingState.players === 'loading' ? '读取中...' :
                   loadingState.players === 'error' ? '加载失败' :
                   unassignedPlayers.length + teams.reduce((total, team) => total + (team.players?.length || 0), 0)}
                </div>
              </div>
            </div>

            <div className="stat-card unassigned-players">
              <div className="stat-icon">⏳</div>
              <div className="stat-info">
                <div className="stat-title">未进队人数</div>
                <div className="stat-value" id="unassignedPlayersCount">
                  {loadingState.players === 'loading' ? '读取中...' :
                   loadingState.players === 'error' ? '加载失败' :
                   unassignedPlayers.length}
                </div>
              </div>
            </div>

            <div className="stat-card teams">
              <div className="stat-icon">👥</div>
              <div className="stat-info">
                <div className="stat-title">参与队伍数</div>
                <div className="stat-value" id="teamsCount">
                  {loadingState.teams === 'loading' ? '读取中...' :
                   loadingState.teams === 'error' ? '加载失败' :
                   teams.length}
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
                <button id="resetBtn" className="btn btn-primary" onClick={resetAssignments}>重置分配</button>
                <button id="addPlayerBtn" className="btn btn-primary" onClick={() => setShowNewPlayerModal(true)} disabled={isCreatingPlayer}>
                  {isCreatingPlayer ? '添加中...' : '+ 新增选手'}
                </button>
                <button id="addTeamBtn" className="btn btn-primary" onClick={addTeam} disabled={isAddingTeam}>
                  {isAddingTeam ? '添加中...' : '+ 添加队伍'}
                </button>
              </div>
            </div>
            <div
              id="teamsContainer"
              className="teams-container"
            >
              {loadingState.teams === 'loading' ? (
                <div className="loading-message">队伍信息读取中...</div>
              ) : loadingState.teams === 'error' ? (
                <div className="error-message">{loadingState.error || '加载队伍信息失败，请刷新页面重试'}</div>
              ) : (
                teams.map(team => (
                  <div key={team.id}>
                    <TeamCard
                      team={team}
                      onAddPlayer={() => openAddPlayerModal(team.id)}
                      onRemovePlayer={(playerId) => removePlayerFromTeam(playerId, team.id)}
                      onDeleteTeam={() => deleteTeam(team.id)}
                    />
                  </div>
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
                  id="searchInput"
                  placeholder="搜索选手昵称、steamID、群昵称、擅长位置或英雄..."
                  className="search-input"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  disabled={loadingState.players === 'loading'}
                />
                <div className="position-filters">
                  {['优势路', '中单', '劣势路', '半辅助', '纯辅助', '全才'].map(pos => (
                    <label key={pos}>
                      <input
                        type="checkbox"
                        className="position-filter"
                        value={pos}
                        checked={positionFilters.includes(pos)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setPositionFilters([...positionFilters, pos]);
                          } else {
                            setPositionFilters(positionFilters.filter(p => p !== pos));
                          }
                        }}
                        disabled={loadingState.players === 'loading'}
                      /> {pos}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div
              id="unassignedPlayersContainer"
              className="players-container"
            >
              {loadingState.players === 'loading' ? (
                <div className="loading-message">选手信息读取中...</div>
              ) : loadingState.players === 'error' ? (
                <div className="error-message">{loadingState.error || '加载选手信息失败，请刷新页面重试'}</div>
              ) : (
                (() => {
                  const assignedPlayers = teams.flatMap(team => team.players);
                  const allPlayers = [
                    ...assignedPlayers,
                    ...unassignedPlayers
                  ].filter(player => {
                    if (searchTerm) {
                      const term = searchTerm.toLowerCase();
                      const matchesSearch = (
                        (player.nickname && player.nickname.toLowerCase().includes(term)) ||
                        (player.game_id && player.game_id.toLowerCase().includes(term)) ||
                        (player.group_nickname && player.group_nickname.toLowerCase().includes(term)) ||
                        (player.positions && player.positions.some(pos => pos.toLowerCase().includes(term))) ||
                        (player.heroes && player.heroes.some(hero => hero.toLowerCase().includes(term))) ||
                        (player.synergy_players && player.synergy_players.some(partner =>
                          typeof partner === 'string' ? partner.toLowerCase().includes(term) : false
                        ))
                      );
                      if (!matchesSearch) return false;
                    }
                    if (positionFilters.length > 0) {
                      if (!player.positions || !player.positions.some(pos => positionFilters.includes(pos))) return false;
                    }
                    return true;
                  });

                  return (
                    <>
                      {allPlayers.map((player, index) => {
                        const isUnassignedPlayer = unassignedPlayers.some(p => p.id === player.id);
                        const isAssignedPlayer = assignedPlayers.some(p => p.id === player.id);
                        const showDivider = isUnassignedPlayer && index > 0 && assignedPlayers.length > 0 && index === assignedPlayers.length;

                        return [
                          showDivider && (
                            <div key={`divider-${player.id}`} className="player-section-divider">
                              <span className="divider-text">未分配选手</span>
                            </div>
                          ),
                          <PlayerCard
                            key={player.id}
                            player={player}
                            onJoinTeam={!isAssignedPlayer ? openJoinTeamModal : null}
                            onEdit={handleEditPlayer}
                            onDelete={deletePlayer}
                            onCopy={copyPlayerGameId}
                            className={isAssignedPlayer ? 'assigned-player' : ''}
                          />
                        ].filter(Boolean);
                      })}
                    </>
                  );
                })()
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
      </div>

      {/* 添加选手到队伍对话框 */}
      {showAddPlayerModal && (
        <div id="addPlayerModal" className="modal active show" style={{ display: 'flex' }}>
          <div className="modal-backdrop" onClick={() => setShowAddPlayerModal(false)}></div>
          <div className="modal-content">
            <div className="modal-header">
              <h3>添加选手到队伍</h3>
              <button className="modal-close" id="closeModal" onClick={() => setShowAddPlayerModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                id="modalSearchInput"
                placeholder="搜索选手昵称、steamID、群昵称、擅长位置、擅长英雄或默契选手..."
                className="modal-search-input"
                value={modalSearchTerm}
                onChange={(e) => setModalSearchTerm(e.target.value)}
              />
              <div id="modalPlayersList" className="modal-players-list">
                {unassignedPlayers
                  .filter(player => {
                    if (!modalSearchTerm) return true;
                    const term = modalSearchTerm.toLowerCase();
                    return (
                      (player.nickname && player.nickname.toLowerCase().includes(term)) ||
                      (player.game_id && player.game_id.toLowerCase().includes(term)) ||
                      (player.group_nickname && player.group_nickname.toLowerCase().includes(term)) ||
                      (player.positions && player.positions.some(pos => pos.toLowerCase().includes(term))) ||
                      (player.heroes && player.heroes.some(hero => hero.toLowerCase().includes(term))) ||
                      (player.synergy_players && player.synergy_players.some(partner =>
                        typeof partner === 'string' ? partner.toLowerCase().includes(term) : false
                      ))
                    );
                  })
                  .map(player => (
                    <div
                      key={player.id}
                      className="modal-player-item"
                      onClick={() => addPlayerFromModal(player.id)}
                    >
                      <PlayerCard player={player} isModalView={true} />
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 新增/编辑选手对话框 */}
      {showNewPlayerModal && (
        <div id="newPlayerModal" className="modal active show" style={{ display: 'flex' }}>
          <div className="modal-backdrop" onClick={() => { setShowNewPlayerModal(false); resetPlayerForm(); }}></div>
          <div className="modal-content large-modal">
            <div className="modal-header">
              <h3>{editingPlayer ? '编辑选手' : '新增选手'}</h3>
              <button className="modal-close" id="closeNewPlayerModal" onClick={() => { setShowNewPlayerModal(false); resetPlayerForm(); }}>&times;</button>
            </div>
            <div className="modal-body">
              <form id="newPlayerForm" className="new-player-form" onSubmit={(e) => {
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
                    <label htmlFor="newPlayerNickname">选手昵称 *</label>
                    <input type="text" id="newPlayerNickname" required value={playerFormData.nickname} onChange={(e) => setPlayerFormData({ ...playerFormData, nickname: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="newPlayerGameId">steamID *</label>
                    <input type="text" id="newPlayerGameId" required value={playerFormData.game_id} onChange={(e) => setPlayerFormData({ ...playerFormData, game_id: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="newPlayerGroupNickname">群昵称</label>
                    <input type="text" id="newPlayerGroupNickname" value={playerFormData.group_nickname} onChange={(e) => setPlayerFormData({ ...playerFormData, group_nickname: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="newPlayerScore">天梯分数 *</label>
                    <input type="number" id="newPlayerScore" min="0" max="30000" required value={playerFormData.score} onChange={(e) => setPlayerFormData({ ...playerFormData, score: e.target.value })} />
                    <div className="score-preview" id="scorePreview">
                      {(() => {
                        const s = parseInt(playerFormData.score) || 0;
                        if (s >= 20000) return <span className="score-master">冠绝一世 ({s})</span>;
                        if (s >= 15000) return <span className="score-diamond">超凡入圣 ({s})</span>;
                        if (s >= 10000) return <span className="score-platinum">万古流芳 ({s})</span>;
                        if (s >= 5000) return <span className="score-gold">传奇 ({s})</span>;
                        if (s > 0) return <span className="score-silver">卫士 ({s})</span>;
                        return <span style={{color: '#94a3b8'}}>输入天梯分数后实时显示等级</span>;
                      })()}
                    </div>
                  </div>
                </div>
                <div className="form-group">
                  <label>擅长位置</label>
                  <div className="position-checkboxes">
                    {['优势路', '中单', '劣势路', '半辅助', '纯辅助', '全才'].map(pos => (
                      <label key={pos} className="position-tag">
                        <input
                          type="checkbox"
                          name="positions"
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
                  <label htmlFor="newPlayerHeroes">擅长英雄</label>
                  <div className="heroes-selector">
                    <div className="selected-heroes" id="selectedHeroes">
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
                    <button type="button" id="selectHeroesBtn" className="btn btn-secondary" onClick={openHeroesModal}>
                      选择英雄
                    </button>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="newPlayerWinRate">最近胜率 (%)</label>
                    <input type="number" id="newPlayerWinRate" min="0" max="100" value={playerFormData.win_rate} onChange={(e) => setPlayerFormData({ ...playerFormData, win_rate: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="newPlayerChampionships">冠军数量</label>
                    <input type="number" id="newPlayerChampionships" min="0" value={playerFormData.championships} onChange={(e) => setPlayerFormData({ ...playerFormData, championships: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label>默契选手</label>
                  <div className="synergy-selector">
                    <div className="selected-synergy" id="selectedSynergy">
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
                    <button type="button" id="selectSynergyBtn" className="btn btn-secondary" onClick={openSynergyModal}>
                      添加默契选手
                    </button>
                  </div>
                </div>
                <div className="form-actions">
                  <button type="button" id="cancelNewPlayer" className="btn btn-secondary" onClick={() => { setShowNewPlayerModal(false); resetPlayerForm(); }}>取消</button>
                  <button type="submit" className="btn btn-primary">{editingPlayer ? '保存修改' : '创建选手'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 英雄选择对话框 */}
      {showHeroesModal && (
        <div id="heroesSelectModal" className="modal active show" style={{ display: 'flex' }}>
          <div className="modal-backdrop" onClick={() => setShowHeroesModal(false)}></div>
          <div className="modal-content">
            <div className="modal-header">
              <h3>选择擅长英雄</h3>
              <button className="modal-close" id="closeHeroesModal" onClick={() => setShowHeroesModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <input type="text" id="heroesSearchInput" placeholder="搜索英雄名称或别称..." className="modal-search-input" />
              <div className="heroes-list-container">
                <div id="heroesList" className="heroes-grid">
                  {heroesList.map((hero, index) => (
                    <div
                      key={index}
                      className={`hero-item cool-bg-${(index % 10) + 1} ${selectedHeroes.includes(hero.name) ? 'selected' : ''}`}
                      onClick={() => toggleHeroSelection(hero.name)}
                    >
                      <div className="hero-name">{hero.name}</div>
                      <div className="hero-nickname">{hero.nickname}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-actions">
                <button id="cancelHeroesSelect" className="btn btn-secondary" onClick={() => setShowHeroesModal(false)}>取消</button>
                <button id="confirmHeroesSelect" className="btn btn-primary" onClick={confirmHeroesSelection}>确定选择</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 默契选手选择对话框 */}
      {showSynergyModal && (
        <div id="synergySelectModal" className="modal active show" style={{ display: 'flex' }}>
          <div className="modal-backdrop" onClick={() => setShowSynergyModal(false)}></div>
          <div className="modal-content">
            <div className="modal-header">
              <h3>选择默契选手</h3>
              <button className="modal-close" id="closeSynergyModal" onClick={() => setShowSynergyModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                id="synergySearchInput"
                placeholder="搜索选手昵称、steamID、群昵称、擅长位置、擅长英雄或默契选手..."
                className="modal-search-input"
                value={synergySearchTerm}
                onChange={(e) => setSynergySearchTerm(e.target.value)}
              />
              <div id="synergyPlayersList" className="modal-players-list">
                {[...unassignedPlayers, ...teams.flatMap(t => t.players)]
                  .filter(player => {
                    if (!synergySearchTerm) return true;
                    const term = synergySearchTerm.toLowerCase();
                    return (
                      (player.nickname && player.nickname.toLowerCase().includes(term)) ||
                      (player.game_id && player.game_id.toLowerCase().includes(term)) ||
                      (player.group_nickname && player.group_nickname.toLowerCase().includes(term)) ||
                      (player.positions && player.positions.some(pos => pos.toLowerCase().includes(term))) ||
                      (player.heroes && player.heroes.some(hero => hero.toLowerCase().includes(term))) ||
                      (player.synergy_players && player.synergy_players.some(partner =>
                        typeof partner === 'string' ? partner.toLowerCase().includes(term) : false
                      ))
                    );
                  })
                  .map((player, index) => (
                    <div
                      key={index}
                      className={`modal-player-item cool-bg-${(index % 10) + 1} ${selectedSynergyPlayers.includes(player.id) ? 'selected' : ''}`}
                      onClick={() => toggleSynergyPlayerSelection(player.id)}
                    >
                      <PlayerCard player={player} isModalView={true} />
                    </div>
                  ))}
              </div>
              <div className="modal-actions">
                <button id="cancelSynergySelect" className="btn btn-secondary" onClick={() => setShowSynergyModal(false)}>取消</button>
                <button id="confirmSynergySelect" className="btn btn-primary" onClick={confirmSynergySelection}>确定选择</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 赛季选择器模态框 */}
      {showTournamentSelector && (
        <TournamentSelector
          currentTournament={currentTournament}
          onTournamentSelect={handleTournamentSelect}
          onClose={() => setShowTournamentSelector(false)}
        />
      )}

      {/* 编辑赛季结果模态框 */}
      {showEditTournamentResults && (
        <EditTournamentResults
          tournament={currentTournament}
          teams={teams}
          onSave={handleSaveTournamentResults}
          onClose={() => setShowEditTournamentResults(false)}
        />
      )}

      {/* 选择队伍模态框 */}
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
                      style={{
                        padding: '16px',
                        borderRadius: '8px',
                        background: isFull ? '#fef2f2' : '#f8fafc',
                        border: `1px solid ${isFull ? '#f87171' : '#c8ddf0'}`,
                        cursor: isFull ? 'not-allowed' : 'pointer',
                        opacity: isFull ? 0.6 : 1,
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#1a365d' }}>{team.name}</div>
                        <div style={{ fontWeight: 'bold', color: '#3b8fd4' }}>天梯总分: {teamScore}</div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
                          人数: {team.players.length}/5
                        </div>
                        {isFull && (
                          <div style={{ fontSize: '0.85rem', color: '#f87171', fontWeight: 'bold' }}>已满员</div>
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
