import Head from 'next/head';
import { useState, useEffect, useRef } from 'react';
import PlayerCard from '../../components/PlayerCard';
import TeamCard from '../../components/TeamCard';
import { useRouter } from 'next/router';

export default function Home() {
  const [teams, setTeams] = useState([]);
  const [unassignedPlayers, setUnassignedPlayers] = useState([]);
  const [teamIdCounter, setTeamIdCounter] = useState(1);
  const [showNewPlayerModal, setShowNewPlayerModal] = useState(false);
  const [showAddTeamModal, setShowAddTeamModal] = useState(false);
  const [showAddPlayerModal, setShowAddPlayerModal] = useState(false);
  const [showHeroesModal, setShowHeroesModal] = useState(false);
  const [showSynergyModal, setShowSynergyModal] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [draggedPlayerId, setDraggedPlayerId] = useState(null);
  const [selectedHeroes, setSelectedHeroes] = useState([]); // 存储选中的英雄
  const [selectedSynergyPlayers, setSelectedSynergyPlayers] = useState([]); // 存储选中的默契选手
  const [editingPlayer, setEditingPlayer] = useState(null); // 存储正在编辑的选手
  const [showEditPlayerModal, setShowEditPlayerModal] = useState(false); // 控制编辑选手模态框显示
  const [modalSearchTerm, setModalSearchTerm] = useState(''); // 添加模态框搜索状态
  const [searchTerm, setSearchTerm] = useState(''); // 添加搜索词状态
  const [synergySearchTerm, setSynergySearchTerm] = useState(''); // 添加默契选手搜索词状态
  const [user, setUser] = useState(null); // 存储用户信息
  const importFileRef = useRef(null);
  const router = useRouter();

  // 英雄列表数据
  const heroesList = [
    {"id": 209, "name": "上古巨神", "nickname": "大牛,ET"},
    {"id": 210, "name": "不朽尸王", "nickname": "尸王,DIRGE"},
    {"id": 178, "name": "主宰", "nickname": "剑圣,Jugg"},
    {"id": 272, "name": "亚巴顿", "nickname": "死骑,哑巴,LOA"},
    {"id": 211, "name": "伐木机", "nickname": "花母鸡,伐木机,Timberraw"},
    {"id": 241, "name": "修补匠", "nickname": "修补,TK,Tinker"},
    {"id": 242, "name": "光之守卫", "nickname": "光法,白马,Koti"},
    {"id": 179, "name": "克林克兹", "nickname": "骨弓,小骷髅,Clinkz"},
    {"id": 212, "name": "全能骑士", "nickname": "全能,OK"},
    {"id": 273, "name": "兽王", "nickname": "兽王,bm"},
    {"id": 213, "name": "军团指挥官", "nickname": "军团,LC"},
    {"id": 180, "name": "冥界亚龙", "nickname": "毒龙,Vip"},
    {"id": 214, "name": "冥魂大帝", "nickname": "骷髅王,SNK"},
    {"id": 274, "name": "凤凰", "nickname": "凤凰,phoanix"},
    {"id": 303, "name": "凯", "nickname": "鸟人,"},
    {"id": 275, "name": "剧毒术士", "nickname": "剧毒,veno"},
    {"id": 181, "name": "力丸", "nickname": "隐刺,SA"},
    {"id": 215, "name": "半人马战行者", "nickname": "人马,CW"},
    {"id": 182, "name": "卓尔游侠", "nickname": "小黑,黑弓,DROW"},
    {"id": 276, "name": "发条技师", "nickname": "发条,clock"},
    {"id": 183, "name": "变体精灵", "nickname": "水人,波高,morph"},
    {"id": 277, "name": "司夜刺客", "nickname": "小强,NA"},
    {"id": 216, "name": "哈斯卡", "nickname": "神灵,单车武士,Hus"},
    {"id": 217, "name": "噬魂鬼", "nickname": "小狗,IS"},
    {"id": 184, "name": "圣堂刺客", "nickname": "圣堂,TA"},
    {"id": 278, "name": "复仇之魂", "nickname": "VS"},
    {"id": 218, "name": "大地之灵", "nickname": "土猫,Earth"},
    {"id": 243, "name": "天怒法师", "nickname": "天怒,龙鹰,SKY"},
    {"id": 244, "name": "天涯墨客", "nickname": "墨客,Grimstroke"},
    {"id": 185, "name": "天穹守望者", "nickname": "电狗,AW"},
    {"id": 186, "name": "娜迦海妖", "nickname": "小娜迦,nage"},
    {"id": 219, "name": "孽主", "nickname": "大屁股,UL"},
    {"id": 245, "name": "宙斯", "nickname": "宙斯,Zeus"},
    {"id": 279, "name": "寒冬飞龙", "nickname": "冰龙,WW"},
    {"id": 220, "name": "小小", "nickname": "小小,山岭,Tiny"},
    {"id": 280, "name": "工程师", "nickname": "炸弹人,Techics"},
    {"id": 221, "name": "巨牙海民", "nickname": "海民,Tusk"},
    {"id": 187, "name": "巨魔战将", "nickname": "巨魔,Troll"},
    {"id": 246, "name": "巫医", "nickname": "巫医,51,WD"},
    {"id": 247, "name": "巫妖", "nickname": "巫妖,Lich"},
    {"id": 248, "name": "帕克", "nickname": "帕克,大头苍蝇,精灵龙,puck"},
    {"id": 222, "name": "帕吉", "nickname": "屠夫,Pudge"},
    {"id": 249, "name": "帕格纳", "nickname": "骨法,Pugna"},
    {"id": 250, "name": "干扰者", "nickname": "萨尔,Disruptor"},
    {"id": 188, "name": "幻影刺客", "nickname": "幻刺,PA"},
    {"id": 189, "name": "幻影长矛手", "nickname": "猴子,分身猴,PL"},
    {"id": 190, "name": "幽鬼", "nickname": "幽鬼,UG,Spe"},
    {"id": 191, "name": "影魔", "nickname": "影魔,SF"},
    {"id": 192, "name": "恐怖利刃", "nickname": "魂守,TB"},
    {"id": 281, "name": "戴泽", "nickname": "暗牧,Dazzle"},
    {"id": 251, "name": "拉席克", "nickname": "老鹿,TS"},
    {"id": 252, "name": "拉比克", "nickname": "大魔导,蜡笔,fy,Rubick"},
    {"id": 223, "name": "撼地者", "nickname": "小牛,ES"},
    {"id": 193, "name": "敌法师", "nickname": "敌法,AM"},
    {"id": 224, "name": "斧王", "nickname": "斧王,Axe"},
    {"id": 194, "name": "斯拉克", "nickname": "小鱼人,弟弟鱼,Slark"},
    {"id": 225, "name": "斯拉达", "nickname": "大鱼,SL"},
    {"id": 226, "name": "斯温", "nickname": "流浪,斯温,奥特曼,SV"},
    {"id": 227, "name": "昆卡", "nickname": "船长,CoCo"},
    {"id": 228, "name": "暗夜魔王", "nickname": "夜魔,NS"},
    {"id": 253, "name": "暗影恶魔", "nickname": "毒狗,SD"},
    {"id": 254, "name": "暗影萨满", "nickname": "小Y,SS"},
    {"id": 229, "name": "末日使者", "nickname": "末日,Doom"},
    {"id": 255, "name": "术士", "nickname": "术士,Warlock"},
    {"id": 256, "name": "杰奇洛", "nickname": "双头龙,Jakiro"},
    {"id": 230, "name": "树精卫士", "nickname": "大树,TP"},
    {"id": 195, "name": "森海飞霞", "nickname": "小松鼠,Hoodwink"},
    {"id": 257, "name": "死亡先知", "nickname": "DP"},
    {"id": 258, "name": "殁境神蚀者", "nickname": "黑鸟,目光呆滞,OD"},
    {"id": 259, "name": "水晶侍女", "nickname": "冰女,CM"},
    {"id": 260, "name": "沉默术士", "nickname": "沉默,SIL"},
    {"id": 282, "name": "沙王", "nickname": "沙王,鞋子,SK"},
    {"id": 231, "name": "混沌骑士", "nickname": "混沌,CK"},
    {"id": 232, "name": "潮汐猎人", "nickname": "潮汐,西瓜皮,TH"},
    {"id": 196, "name": "灰烬之灵", "nickname": "火猫,ES"},
    {"id": 233, "name": "炼金术士", "nickname": "炼金,GA"},
    {"id": 197, "name": "熊战士", "nickname": "拍拍熊,Ursa"},
    {"id": 198, "name": "狙击手", "nickname": "矮子,火枪,Sniper"},
    {"id": 284, "name": "独行德鲁伊", "nickname": "德鲁伊,熊德,LD"},
    {"id": 283, "name": "狼人", "nickname": "狼人,Lycan"},
    {"id": 234, "name": "獣", "nickname": "畜,Beast"},
    {"id": 235, "name": "玛尔斯", "nickname": "玛尔斯,Mars"},
    {"id": 285, "name": "玛西", "nickname": "玛西,女拳,Marci"},
    {"id": 261, "name": "琼英碧灵", "nickname": "奶绿,琼逼,Muerta"},
    {"id": 286, "name": "电炎绝手", "nickname": "奶奶,老太婆,Snapfire"},
    {"id": 262, "name": "痛苦女王", "nickname": "女王,QOP"},
    {"id": 263, "name": "瘟疫法师", "nickname": "死灵法,Nec"},
    {"id": 264, "name": "百戏大王", "nickname": "百戏,小丑,Ringmaster"},
    {"id": 199, "name": "矮人直升机", "nickname": "飞机,gyr"},
    {"id": 287, "name": "石鳞剑士", "nickname": "滚滚,Pangolier"},
    {"id": 236, "name": "破晓辰星", "nickname": "大锤,锤妹,DB"},
    {"id": 288, "name": "祈求者", "nickname": "卡尔,Invoker"},
    {"id": 265, "name": "神谕者", "nickname": "神谕,Oracle"},
    {"id": 289, "name": "祸乱之源", "nickname": "祸乱,水桶腰,Bane"},
    {"id": 290, "name": "米拉娜", "nickname": "白虎,Pom"},
    {"id": 200, "name": "米波", "nickname": "地狗,米波,Meepo"},
    {"id": 291, "name": "维萨吉", "nickname": "死灵龙,Vis"},
    {"id": 201, "name": "编织者", "nickname": "蚂蚁,Weaver"},
    {"id": 202, "name": "美杜莎", "nickname": "一姐,大娜迦,Med"},
    {"id": 292, "name": "育母蜘蛛", "nickname": "蜘蛛,Broodmother"},
    {"id": 266, "name": "自然先知", "nickname": "先知,FUR"},
    {"id": 293, "name": "艾欧", "nickname": "小精灵,IO"},
    {"id": 267, "name": "莉娜", "nickname": "莉娜,火女,lina"},
    {"id": 268, "name": "莱恩", "nickname": "莱恩,若风巫师,Lion"},
    {"id": 294, "name": "虚无之灵", "nickname": "紫猫,Void Spirit"},
    {"id": 203, "name": "虚空假面", "nickname": "虚空,J8脸,FV"},
    {"id": 295, "name": "蝙蝠骑士", "nickname": "蝙蝠,Bat"},
    {"id": 204, "name": "血魔", "nickname": "血魔,BS"},
    {"id": 237, "name": "裂魂人", "nickname": "白牛,SB"},
    {"id": 296, "name": "谜团", "nickname": "谜团,Enigma"},
    {"id": 205, "name": "赏金猎人", "nickname": "赏金,BH"},
    {"id": 269, "name": "远古冰魄", "nickname": "冰魂,AA"},
    {"id": 297, "name": "邪影芳灵", "nickname": "小仙女,花仙,Dark Willow"},
    {"id": 298, "name": "酒仙", "nickname": "熊猫,PB"},
    {"id": 238, "name": "钢背兽", "nickname": "刚被,BB猪,BB"},
    {"id": 299, "name": "陈", "nickname": "圣骑,CHEN"},
    {"id": 206, "name": "雷泽", "nickname": "电棍,电魂,Razor"},
    {"id": 207, "name": "露娜", "nickname": "月骑,露娜,Luna"},
    {"id": 270, "name": "风暴之灵", "nickname": "蓝猫,电猫,Storm"},
    {"id": 300, "name": "风行者", "nickname": "风行,WR"},
    {"id": 239, "name": "食人魔魔法师", "nickname": "蓝胖,OM"},
    {"id": 301, "name": "马格纳斯", "nickname": "猛犸,颠勺,Magnus"},
    {"id": 271, "name": "魅惑魔女", "nickname": "小鹿,Enchantress"},
    {"id": 302, "name": "黑暗贤者", "nickname": "黑贤,兔子,DS"},
    {"id": 208, "name": "齐天大圣", "nickname": "大圣,Monkey King"},
    {"id": 240, "name": "龙骑士", "nickname": "龙骑,DK"}
  ];

  // 页面加载时检查用户登录状态
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    } else {
      // 如果没有用户信息，重定向到登录页面
      router.push('/login');
    }
  }, [router]);

  // 加载数据
  useEffect(() => {
    // 初始化默认数据
    const defaultTeams = [];
    const defaultPlayers = [
      {
        "id": "1",
        "nickname": "Spirit_Moon",
        "group_nickname": "Spirit_Moon",
        "game_id": "294993528",
        "score": 15000,
        "positions": [
          "劣势路",
          "优势路",
          "中单",
          "半辅助"
        ],
        "heroes": [],
        "win_rate": 0,
        "championships": 0,
        "synergy_players": [],
        "created_at": "",
        "updated_at": "",
        "position_priority": {},
        "team_name": "unassigned",
        "synergyPlayers": []
      }
    ];
    
    setTeams(defaultTeams);
    setUnassignedPlayers(defaultPlayers);
    setTeamIdCounter(2); // 从2开始，因为已经有id为1的选手
  }, []);

  // 添加队伍
  const addTeam = () => {
    const newTeam = {
      id: teamIdCounter,
      name: `队伍${teamIdCounter}`,
      players: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    setTeams([...teams, newTeam]);
    setTeamIdCounter(teamIdCounter + 1);
  };

  // 删除队伍
  const deleteTeam = (teamId) => {
    // 找到要删除的队伍
    const teamToDelete = teams.find(team => team.id === teamId);
    if (!teamToDelete) return;
    
    // 将队伍中的选手移回未分配池
    const playersToMove = teamToDelete.players.map(player => ({
      ...player,
      team_name: "unassigned"
    }));
    
    // 更新未分配选手列表
    setUnassignedPlayers([...unassignedPlayers, ...playersToMove]);
    
    // 从队伍列表中移除该队伍
    setTeams(teams.filter(team => team.id !== teamId));
  };

  // 添加选手到队伍
  const addPlayerToTeam = (playerId, teamId) => {
    // 检查队伍是否已满（5人限制）
    const team = teams.find(t => t.id === teamId);
    if (team && team.players.length >= 5) {
      alert('队伍已满，无法添加更多选手！');
      return;
    }

    // 找到选手
    let player = null;
    let updatedUnassignedPlayers = [];
    
    // 先在未分配选手中查找
    const playerIndex = unassignedPlayers.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
      player = {...unassignedPlayers[playerIndex]};
      updatedUnassignedPlayers = unassignedPlayers.filter((_, index) => index !== playerIndex);
    } else {
      // 在队伍中查找
      let found = false;
      const updatedTeams = teams.map(team => {
        if (found) return team;
        
        const pIndex = team.players.findIndex(p => p.id === playerId);
        if (pIndex !== -1) {
          player = {...team.players[pIndex]};
          found = true;
          return {
            ...team,
            players: team.players.filter((_, index) => index !== pIndex),
            updated_at: new Date().toISOString()
          };
        }
        return team;
      });
      
      if (found) {
        setTeams(updatedTeams);
        updatedUnassignedPlayers = unassignedPlayers;
      }
    }
    
    if (!player) return;
    
    // 添加到目标队伍中
    const updatedTeams = teams.map(team => {
      if (team.id === teamId) {
        return {
          ...team,
          players: [...team.players, player],
          updated_at: new Date().toISOString()
        };
      }
      return team;
    });
    
    setUnassignedPlayers(updatedUnassignedPlayers);
    setTeams(updatedTeams);
  };

  // 从队伍中移除选手
  const removePlayerFromTeam = (playerId, teamId) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    
    const player = team.players.find(p => p.id === playerId);
    if (!player) return;
    
    // 从队伍中移除选手
    const updatedTeams = teams.map(t => {
      if (t.id === teamId) {
        return {
          ...t,
          players: t.players.filter(p => p.id !== playerId),
          updated_at: new Date().toISOString()
        };
      }
      return t;
    });
    
    // 添加到未分配选手中
    setUnassignedPlayers([...unassignedPlayers, player]);
    setTeams(updatedTeams);
  };

  // 创建新选手
  const createNewPlayer = (playerData) => {
    if (editingPlayer) {
      // 更新现有选手
      updatePlayer(editingPlayer.id, playerData);
      setEditingPlayer(null);
    } else {
      // 创建新选手
      const newPlayer = {
        id: Date.now().toString(),
        ...playerData,
        heroes: selectedHeroes,
        synergy_players: selectedSynergyPlayers,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        team_name: "unassigned"
      };
      
      setUnassignedPlayers([...unassignedPlayers, newPlayer]);
    }
    
    setShowNewPlayerModal(false);
    setSelectedHeroes([]);
    setSelectedSynergyPlayers([]);
  };

  // 重置分配
  const resetAssignments = () => {
    // 将所有队伍中的选手移回未分配池
    const allPlayers = [...unassignedPlayers];
    teams.forEach(team => {
      allPlayers.push(...team.players);
    });
    
    const updatedTeams = teams.map(team => ({
      ...team,
      players: [],
      updated_at: new Date().toISOString()
    }));
    
    setUnassignedPlayers(allPlayers);
    setTeams(updatedTeams);
  };

  // 保存配置
  const saveConfig = () => {
    const data = {
      teams,
      unassignedPlayers,
      timestamp: new Date().toISOString()
    };
    
    const dataStr = JSON.stringify(data, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `team-config-${new Date().toISOString().slice(0, 10)}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  // 导入配置
  const importConfig = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        setTeams(data.teams || []);
        setUnassignedPlayers(data.unassignedPlayers || []);
      } catch (error) {
        console.error('导入配置失败:', error);
        alert('导入配置失败，请检查文件格式是否正确');
      }
    };
    reader.readAsText(file);
  };

  // 处理拖拽开始
  const handleDragStart = (e, playerId) => {
    setDraggedPlayerId(playerId);
  };

  // 处理拖拽放置
  const handleDrop = (e, teamId) => {
    e.preventDefault();
    if (draggedPlayerId) {
      addPlayerToTeam(draggedPlayerId, teamId);
      setDraggedPlayerId(null);
    }
  };

  // 打开添加选手到队伍的对话框
  const openAddPlayerModal = (teamId) => {
    setSelectedTeamId(teamId);
    setShowAddPlayerModal(true);
    setModalSearchTerm(''); // 打开弹窗时清空搜索词
  };

  // 在对话框中添加选手到队伍
  const addPlayerFromModal = (playerId) => {
    if (selectedTeamId) {
      addPlayerToTeam(playerId, selectedTeamId);
      setShowAddPlayerModal(false);
      setSelectedTeamId(null);
    }
  };

  // 打开英雄选择对话框
  const openHeroesModal = (e) => {
    e.preventDefault();
    setShowHeroesModal(true);
  };

  // 打开默契选手选择对话框
  const openSynergyModal = () => {
    setShowSynergyModal(true);
    setSynergySearchTerm(''); // 打开弹窗时清空搜索词
  };

  // 确认选择英雄
  const confirmHeroesSelection = () => {
    setShowHeroesModal(false);
  };

  // 切换英雄选择
  const toggleHeroSelection = (heroName) => {
    if (selectedHeroes.includes(heroName)) {
      setSelectedHeroes(selectedHeroes.filter(name => name !== heroName));
    } else {
      setSelectedHeroes([...selectedHeroes, heroName]);
    }
  };

  // 确认选择默契选手
  const confirmSynergySelection = () => {
    setShowSynergyModal(false);
  };

  // 切换默契选手选择
  const toggleSynergyPlayerSelection = (playerId) => {
    if (selectedSynergyPlayers.includes(playerId)) {
      setSelectedSynergyPlayers(selectedSynergyPlayers.filter(id => id !== playerId));
    } else {
      setSelectedSynergyPlayers([...selectedSynergyPlayers, playerId]);
    }
  };

  // 编辑选手信息
  const editPlayer = (player) => {
    setEditingPlayer(player);
    // 设置表单字段的值
    setTimeout(() => {
      document.getElementById('newPlayerNickname').value = player.nickname;
      document.getElementById('newPlayerGameId').value = player.game_id;
      document.getElementById('newPlayerGroupNickname').value = player.group_nickname || '';
      document.getElementById('newPlayerScore').value = player.score;
      document.getElementById('newPlayerWinRate').value = player.win_rate || 0;
      document.getElementById('newPlayerChampionships').value = player.championships || 0;
      
      // 设置位置选择
      const positionCheckboxes = document.querySelectorAll('input[name="positions"]');
      positionCheckboxes.forEach(checkbox => {
        checkbox.checked = player.positions.includes(checkbox.value);
      });
      
      // 设置已选择的英雄和默契选手
      setSelectedHeroes(player.heroes || []);
      setSelectedSynergyPlayers(player.synergy_players || []);
    }, 0);
    
    setShowNewPlayerModal(true);
  };

  // 更新选手信息
  const updatePlayer = (playerId, playerData) => {
    const updatedPlayers = unassignedPlayers.map(player => {
      if (player.id === playerId) {
        return {
          ...player,
          ...playerData,
          heroes: selectedHeroes,
          synergy_players: selectedSynergyPlayers,
          updated_at: new Date().toISOString()
        };
      }
      return player;
    });
    
    setUnassignedPlayers(updatedPlayers);
  };

  // 删除选手
  const deletePlayer = (playerId) => {
    const updatedPlayers = unassignedPlayers.filter(player => player.id !== playerId);
    setUnassignedPlayers(updatedPlayers);
  };

  // 复制选手游戏ID
  const copyPlayerGameId = (gameId) => {
    navigator.clipboard.writeText(gameId);
  };

  return (
    <>
      <Head>
        <title>比赛选手人员分配系统</title>
        <meta name="description" content="比赛选手人员分配系统" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="container">
        {/* 头部区域 */}
        <header className="header">
          <h1>比赛选手人员分配系统</h1>
          <div className="instructions">
            <p>拖拽选手卡片到队伍中进行分配 | 点击添加按钮选择选手 | 支持搜索和筛选功能</p>
          </div>
          
          {/* 统计卡片区域 */}
          <div className="stats-cards">
            <div className="stat-card total-players">
              <div className="stat-icon">👥</div>
              <div className="stat-info">
                <div className="stat-title">总选手数</div>
                <div className="stat-value" id="totalPlayersCount">{unassignedPlayers.length + teams.reduce((total, team) => total + team.players.length, 0)}</div>
              </div>
            </div>
            
            <div className="stat-card unassigned-players">
              <div className="stat-icon">⏳</div>
              <div className="stat-info">
                <div className="stat-title">未分配选手</div>
                <div className="stat-value" id="unassignedPlayersCount">{unassignedPlayers.length}</div>
              </div>
            </div>
            
            <div className="stat-card teams">
              <div className="stat-icon">👥</div>
              <div className="stat-info">
                <div className="stat-title">队伍数</div>
                <div className="stat-value" id="teamsCount">{teams.length}</div>
              </div>
            </div>
            
            {/* 用户信息卡片 */}
            {user && (
              <div className="stat-card user-info">
                <div className="stat-icon">👤</div>
                <div className="stat-info">
                  <div className="stat-title">用户: {user.name}</div>
                  <div className="stat-value">登录次数: {user.count}</div>
                </div>
              </div>
            )}
          </div>
          
          <div className="header-actions">
            <button id="resetBtn" className="btn btn-secondary" onClick={resetAssignments}>重置分配</button>
            <button id="saveBtn" className="btn btn-primary" onClick={saveConfig}>保存配置</button>
            <button id="exportBtn" className="btn btn-secondary" onClick={saveConfig}>导出数据</button>
            <button id="importBtn" className="btn btn-secondary" onClick={() => importFileRef.current.click()}>导入数据</button>
            <input 
              type="file" 
              id="importFile" 
              ref={importFileRef}
              style={{display: 'none'}} 
              accept=".json"
              onChange={importConfig}
            />
          </div>
        </header>
        
        {/* 主体内容 */}
        <main className="main-content">
          {/* 队伍展示区 */}
          <section className="teams-section">
            <div className="section-header">
              <h2>队伍分配</h2>
              <div className="section-actions">
                <button id="addPlayerBtn" className="btn btn-primary" onClick={() => setShowNewPlayerModal(true)}>+ 新增选手</button>
                <button id="addTeamBtn" className="btn btn-primary" onClick={addTeam}>+ 添加队伍</button>
              </div>
            </div>
            <div 
              id="teamsContainer" 
              className="teams-container"
              onDragOver={(e) => e.preventDefault()}
            >
              {teams.map(team => (
                <div 
                  key={team.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, team.id)}
                >
                  <TeamCard 
                    team={team} 
                    onAddPlayer={() => openAddPlayerModal(team.id)} 
                    onRemovePlayer={(playerId) => removePlayerFromTeam(playerId, team.id)} 
                    onDeleteTeam={() => deleteTeam(team.id)}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* 未分配选手池 */}
          <section className="players-section">
            <div className="section-header">
              <h2>未分配选手池</h2>
              <div className="search-container">
                <input 
                  type="text" 
                  id="searchInput" 
                  placeholder="搜索选手昵称、游戏ID、群昵称、擅长位置或英雄..." 
                  className="search-input" 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="position-filters">
                  <label><input type="checkbox" className="position-filter" value="优势路" /> 优势路</label>
                  <label><input type="checkbox" className="position-filter" value="中单" /> 中单</label>
                  <label><input type="checkbox" className="position-filter" value="劣势路" /> 劣势路</label>
                  <label><input type="checkbox" className="position-filter" value="半辅助" /> 半辅助</label>
                  <label><input type="checkbox" className="position-filter" value="纯辅助" /> 纯辅助</label>
                  <label><input type="checkbox" className="position-filter" value="全才" /> 全才</label>
                </div>
              </div>
            </div>
            <div 
              id="unassignedPlayersContainer" 
              className="players-container"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedPlayerId) {
                  // 从队伍中移除选手到未分配池
                  const updatedTeams = [...teams];
                  let found = false;
                  
                  for (let i = 0; i < updatedTeams.length; i++) {
                    const team = updatedTeams[i];
                    const playerIndex = team.players.findIndex(p => p.id === draggedPlayerId);
                    
                    if (playerIndex !== -1) {
                      const player = team.players[playerIndex];
                      updatedTeams[i] = {
                        ...team,
                        players: team.players.filter((_, index) => index !== playerIndex),
                        updated_at: new Date().toISOString()
                      };
                      
                      setUnassignedPlayers([...unassignedPlayers, player]);
                      setTeams(updatedTeams);
                      found = true;
                      break;
                    }
                  }
                  
                  setDraggedPlayerId(null);
                }
              }}
            >
              {unassignedPlayers
                .filter(player => {
                  if (!searchTerm) return true;
                  
                  const term = searchTerm.toLowerCase();
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
                  <PlayerCard 
                    key={player.id} 
                    player={player} 
                    onDragStart={handleDragStart}
                    onEdit={editPlayer}
                    onDelete={deletePlayer}
                    onCopy={copyPlayerGameId}
                  />
                ))}
            </div>
          </section>
        </main>
      </div>

      {/* 添加选手到队伍对话框 */}
      {showAddPlayerModal && (
        <div id="addPlayerModal" className="modal active show" style={{display: 'flex'}}>
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
                placeholder="搜索选手昵称、游戏ID、群昵称、擅长位置、擅长英雄或默契选手..." 
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
        <div id="newPlayerModal" className="modal active show" style={{display: 'flex'}}>
          <div className="modal-backdrop" onClick={() => {
            setShowNewPlayerModal(false);
            setEditingPlayer(null);
            setSelectedHeroes([]);
            setSelectedSynergyPlayers([]);
          }}></div>
          <div className="modal-content large-modal">
            <div className="modal-header">
              <h3>{editingPlayer ? '编辑选手' : '新增选手'}</h3>
              <button className="modal-close" id="closeNewPlayerModal" onClick={() => {
                setShowNewPlayerModal(false);
                setEditingPlayer(null);
                setSelectedHeroes([]);
                setSelectedSynergyPlayers([]);
              }}>&times;</button>
            </div>
            <div className="modal-body">
              <form id="newPlayerForm" className="new-player-form" onSubmit={(e) => {
                e.preventDefault();
                const form = e.target;
                const positions = Array.from(form.querySelectorAll('input[name="positions"]:checked'))
                  .map(checkbox => checkbox.value);
                
                const playerData = {
                  nickname: form.newPlayerNickname.value,
                  game_id: form.newPlayerGameId.value,
                  group_nickname: form.newPlayerGroupNickname.value,
                  score: parseInt(form.newPlayerScore.value) || 0,
                  positions,
                  win_rate: parseInt(form.newPlayerWinRate.value) || 0,
                  championships: parseInt(form.newPlayerChampionships.value) || 0
                };
                
                // 在createNewPlayer函数中会检查editingPlayer状态来决定是创建还是更新
                createNewPlayer(playerData);
              }}>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="newPlayerNickname">选手昵称 *</label>
                    <input type="text" id="newPlayerNickname" required />
                  </div>
                  <div className="form-group">
                    <label htmlFor="newPlayerGameId">游戏ID *</label>
                    <input type="text" id="newPlayerGameId" required />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="newPlayerGroupNickname">群昵称</label>
                    <input type="text" id="newPlayerGroupNickname" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="newPlayerScore">天梯分数 *</label>
                    <input type="number" id="newPlayerScore" min="0" max="30000" required />
                    <div className="score-preview" id="scorePreview"></div>
                  </div>
                </div>
                <div className="form-group">
                  <label>擅长位置</label>
                  <div className="position-checkboxes">
                    <label><input type="checkbox" name="positions" value="优势路" /> 优势路</label>
                    <label><input type="checkbox" name="positions" value="中单" /> 中单</label>
                    <label><input type="checkbox" name="positions" value="劣势路" /> 劣势路</label>
                    <label><input type="checkbox" name="positions" value="半辅助" /> 半辅助</label>
                    <label><input type="checkbox" name="positions" value="纯辅助" /> 纯辅助</label>
                    <label><input type="checkbox" name="positions" value="全才" /> 全才</label>
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
                    <input type="number" id="newPlayerWinRate" min="0" max="100" />
                  </div>
                  <div className="form-group">
                    <label htmlFor="newPlayerChampionships">冠军数量</label>
                    <input type="number" id="newPlayerChampionships" min="0" />
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
                  <button type="button" id="cancelNewPlayer" className="btn btn-secondary" onClick={() => setShowNewPlayerModal(false)}>取消</button>
                  <button type="submit" className="btn btn-primary">{editingPlayer ? '保存修改' : '创建选手'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 英雄选择对话框 */}
      {showHeroesModal && (
        <div id="heroesSelectModal" className="modal active show" style={{display: 'flex'}}>
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
                <button id="cancelHeroesSelect" className="btn btn-secondary" onClick={() => setShowHeroesModal(false)}>取消</button>
                <button id="confirmHeroesSelect" className="btn btn-primary" onClick={confirmHeroesSelection}>确定选择</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 默契选手选择对话框 */}
      {showSynergyModal && (
        <div id="synergySelectModal" className="modal active show" style={{display: 'flex'}}>
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
                placeholder="搜索选手昵称、游戏ID、群昵称、擅长位置、擅长英雄或默契选手..." 
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
                      className={`modal-player-item ${selectedSynergyPlayers.includes(player.id) ? 'selected' : ''}`}
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
    </>
  );
}