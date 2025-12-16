import Head from 'next/head';
import { useState, useEffect, useRef } from 'react';
import PlayerCard from '../../components/PlayerCard';
import TeamCard from '../../components/TeamCard';
import { useRouter } from 'next/router';

// 在文件顶部导入新增的组件
import TournamentSelector from '../../components/TournamentSelector';
import EditTournamentResults from '../../components/EditTournamentResults';

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
  const [loadingState, setLoadingState] = useState({ 
    teams: 'loading', 
    players: 'loading',
    error: null 
  }); // 添加加载状态
  // 添加操作loading状态
  const [isAddingTeam, setIsAddingTeam] = useState(false);
  const [isCreatingPlayer, setIsCreatingPlayer] = useState(false);
  const importFileRef = useRef(null);
  const router = useRouter();
  
  // 留言板相关状态
  const [showMessageBoard, setShowMessageBoard] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState({ username: '', content: '' });
  const [showRandomMessage, setShowRandomMessage] = useState(false);
  const [randomMessage, setRandomMessage] = useState(null);
  const randomMessageInterval = useRef(null);

  // 页面加载时检查用户登录状态
  // 如果没有用户信息，重定向到登录页面
  // useEffect(() => {
  //   const storedUser = localStorage.getItem('user');
  //   if (storedUser) {
  //     setUser(JSON.parse(storedUser));
  //   } else {
      
  //     router.push('/login');
  //   }
  // }, [router]);

  // 页面加载时获取留言
  useEffect(() => {
    const fetchMessages = async () => {
      try {
        const response = await fetch('/api/messages');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const messagesData = await response.json();
        setMessages(messagesData);
        
        // 如果有留言，启动随机显示留言功能
        if (messagesData.length > 0) {
          startRandomMessageDisplay(messagesData);
        }
      } catch (error) {
        console.error('获取留言失败:', error);
      }
    };
    
    fetchMessages();
    
    return () => {
      // 清除定时器
      if (randomMessageInterval.current) {
        clearInterval(randomMessageInterval.current);
      }
    };
  }, []);
  
  // 启动随机显示留言功能
  const startRandomMessageDisplay = (messagesData) => {
    if (messagesData.length > 0) {
      // 立即显示一条随机留言
      showRandomMessageFunc(messagesData);
      
      // 每隔一段时间显示一条随机留言
      randomMessageInterval.current = setInterval(() => {
        showRandomMessageFunc(messagesData);
      }, 10000); // 10秒显示一次
      
      setShowRandomMessage(true);
    }
  };
  
  // 显示随机留言
  const showRandomMessageFunc = (messagesData) => {
    if (messagesData.length > 0) {
      const randomIndex = Math.floor(Math.random() * messagesData.length);
      setRandomMessage(messagesData[randomIndex]);
    }
  };
  
  // 提交新留言
  const handleSubmitMessage = async (e) => {
    e.preventDefault();
    
    if (!newMessage.username.trim() || !newMessage.content.trim()) {
      alert('请填写用户名和留言内容');
      return;
    }
    
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newMessage),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      
      const message = await response.json();
      setMessages([message, ...messages]);
      setNewMessage({ username: '', content: '' });
      
      // 如果这是第一条留言，启动随机显示功能
      if (messages.length === 0) {
        startRandomMessageDisplay([message, ...messages]);
      }
    } catch (error) {
      console.error('提交留言失败:', error);
      alert('提交留言失败，请稍后重试: ' + error.message);
    }
  };
  
  // 为留言点赞/取消点赞
  const [likedMessages, setLikedMessages] = useState(new Set());

  const likeMessage = async (messageId) => {
    try {
      // 判断是点赞还是取消点赞
      const isLiked = likedMessages.has(messageId);
      const action = isLiked ? 'unlike' : 'like'; // 尽管后端暂时只处理like，但我们保留扩展性
      
      // 发送请求到后端，让后端处理点赞数的增减
      const response = await fetch('/api/messages', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          id: messageId,
          action: action
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      
      const updatedMessage = await response.json();
      
      // 更新消息列表
      setMessages(messages.map(msg => 
        msg.id === messageId ? updatedMessage : msg
      ));
      
      // 切换本地点赞状态
      setLikedMessages(prev => {
        const newLiked = new Set(prev);
        if (newLiked.has(messageId)) {
          newLiked.delete(messageId);
        } else {
          newLiked.add(messageId);
        }
        return newLiked;
      });
    } catch (error) {
      console.error('点赞失败:', error);
      alert('点赞失败: ' + error.message);
    }
  };

  // 英雄列表数据
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
    {"id": 234, "name": "獣", "nickname": "畜,Beast,力量"},
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
    const loadData = async () => {
      try {
        // 从API加载选手数据
        const playersResponse = await fetch('/api/players');
        const { players: playersFromAPI } = await playersResponse.json();
        
        // 从API加载队伍数据
        const teamsResponse = await fetch('/api/teams');
        const { teams: teamsFromAPI } = await teamsResponse.json();

        // 确定未分配的选手（不在任何队伍中的选手）
        const assignedPlayerIds = teamsFromAPI.flatMap(team => team.players.map(p => p.id));
        const unassigned = playersFromAPI.filter(player => !assignedPlayerIds.includes(player.id));

        setTeams(teamsFromAPI);
        setUnassignedPlayers(unassigned);
        setLoadingState(prev => ({ ...prev, teams: 'loaded', players: 'loaded' }));
        
        // 设置队伍ID计数器为当前未使用的最小正整数ID
        if (teamsFromAPI.length > 0) {
          const usedIds = teamsFromAPI.map(t => t.id).sort((a, b) => a - b);
          let nextId = 1;
          for (const id of usedIds) {
            if (id === nextId) {
              nextId++;
            } else if (id > nextId) {
              break;
            }
          }
          setTeamIdCounter(nextId);
        } else {
          setTeamIdCounter(1);
        }
      } catch (error) {
        console.error('加载数据失败:', error);
        setLoadingState({
          teams: 'error',
          players: 'error',
          error: '加载数据超时，请刷新页面重试'
        });
        // 如果API加载失败，使用默认数据
        const defaultTeams = [];
        const defaultPlayers = [
          {
            "id": "1",
            "nickname": "111111",
            "group_nickname": "1111111",
            "game_id": "1111111",
            "score": 11111,
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
      }
    };

    loadData();
  }, []);

  // 添加队伍
  const addTeam = async () => {
    setIsAddingTeam(true);
    
    // 查找当前未使用的最小正整数ID
    const usedIds = teams.map(t => t.id).sort((a, b) => a - b);
    let newId = 1;
    for (const id of usedIds) {
      if (id === newId) {
        newId++;
      } else if (id > newId) {
        break;
      }
    }
    
    const newTeam = {
      id: newId,
      name: `队伍${newId}`,
      players: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    // 添加到API
    try {
      const response = await fetch('/api/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newTeam),
      });
      
      if (response.ok) {
        setTeams([...teams, newTeam]);
        // 更新ID计数器为下一个可用ID
        const nextUsedIds = [...usedIds, newId].sort((a, b) => a - b);
        let nextId = 1;
        for (const id of nextUsedIds) {
          if (id === nextId) {
            nextId++;
          } else if (id > nextId) {
            break;
          }
        }
        setTeamIdCounter(nextId);
        alert('队伍添加成功');
      } else {
        throw new Error('添加队伍失败');
      }
    } catch (error) {
      console.error('添加队伍到API失败:', error);
      // 即使API调用失败，仍然更新前端状态
      setTeams([...teams, newTeam]);
      // 更新ID计数器为下一个可用ID
      const nextUsedIds = [...usedIds, newId].sort((a, b) => a - b);
      let nextId = 1;
      for (const id of nextUsedIds) {
        if (id === nextId) {
          nextId++;
        } else if (id > nextId) {
          break;
        }
      }
      setTeamIdCounter(nextId);
      alert('队伍添加失败');
    } finally {
      setIsAddingTeam(false);
    }
  };

  // 删除队伍
  const deleteTeam = async (teamId) => {
    // 从队伍列表中移除该队伍
    const updatedTeams = teams.filter(team => team.id !== teamId);
    setTeams(updatedTeams);
    
    // 从API中删除队伍
    try {
      const response = await fetch('/api/teams', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ teamId }),
      });
      
      if (!response.ok) {
        throw new Error('删除队伍失败');
      }
    } catch (error) {
      console.error('从API删除队伍失败:', error);
    }
  };

  // 添加选手到队伍
  const addPlayerToTeam = async (playerId, teamId) => {
    // 检查队伍是否已满（5人限制）
    const team = teams.find(t => t.id === teamId);
    if (team && team.players.length >= 5) {
      alert('队伍已满，无法添加更多选手！');
      return;
    }

    // 找到选手（只在所有选手中查找，不区分是否已分配）
    const player = [...unassignedPlayers, ...teams.flatMap(t => t.players)].find(p => p.id === playerId);
    if (!player) return;

    // 添加到目标队伍中
    const updatedTeams = teams.map(team => {
      if (team.id === teamId) {
        // 检查选手是否已经在该队伍中，避免重复添加
        if (team.players.some(p => p.id === playerId)) {
          return team;
        }
        return {
          ...team,
          players: [...team.players, player],
          updated_at: new Date().toISOString()
        };
      }
      return team;
    });

    setTeams(updatedTeams);
    
    // 更新API
    try {
      const response = await fetch('/api/team-players', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ teamId, playerId }),
      });
      
      if (!response.ok) {
        throw new Error('添加选手到队伍失败');
      }
    } catch (error) {
      console.error('添加选手到队伍API记录失败:', error);
    }
  };

  // 从队伍中移除选手
  const removePlayerFromTeam = async (playerId, teamId) => {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    
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
    
    setTeams(updatedTeams);
    
    // 更新API
    try {
      const response = await fetch('/api/team-players', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ teamId, playerId }),
      });
      
      if (!response.ok) {
        throw new Error('从队伍移除选手失败');
      }
    } catch (error) {
      console.error('从队伍API记录中移除选手失败:', error);
    }
  };

  // 创建新选手
  const createNewPlayer = async (playerData) => {
    setIsCreatingPlayer(true);
    if (editingPlayer) {
      // 更新现有选手
      await updatePlayer(editingPlayer.id, playerData);
      setEditingPlayer(null);
    } else {
      // 创建新选手
      const newPlayer = {
        id: Date.now().toString(), // 使用时间戳作为ID，确保唯一性
        ...playerData,
        heroes: selectedHeroes,
        synergy_players: selectedSynergyPlayers,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        team_name: "unassigned"
      };
      
      setUnassignedPlayers([...unassignedPlayers, newPlayer]);
      
      // 添加到API
      try {
        console.log('正在发送选手数据到API:', newPlayer);
        const response = await fetch('/api/players', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(newPlayer),
        });
        
        const responseData = await response.json();
        console.log('API响应状态:', response.status, '响应数据:', responseData);
        
        if (!response.ok) {
          throw new Error(responseData.error || '添加选手失败');
        }
        
        alert('选手添加成功');
      } catch (error) {
        console.error('添加选手到API失败:', error);
        alert('选手添加失败');
      }
    }
    
    setShowNewPlayerModal(false);
    setSelectedHeroes([]);
    setSelectedSynergyPlayers([]);
    setIsCreatingPlayer(false);
  };

  // 更新选手信息
  const updatePlayer = async (playerId, playerData) => {
    // 更新未分配选手中的选手信息
    const updatedUnassignedPlayers = unassignedPlayers.map(player => {
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
    
    // 更新队伍中的选手信息
    const updatedTeams = teams.map(team => {
      const updatedPlayers = team.players.map(player => {
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
      
      return {
        ...team,
        players: updatedPlayers,
        updated_at: new Date().toISOString()
      };
    });
    
    setUnassignedPlayers(updatedUnassignedPlayers);
    setTeams(updatedTeams);
    
    // 更新API
    try {
      const response = await fetch('/api/players', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ playerId, player: playerData }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '更新选手失败');
      }
    } catch (error) {
      console.error('更新选手API记录失败:', error);
      alert(`更新选手失败: ${error.message}`);
    }
  };

  // 删除选手
  const deletePlayer = async (playerId) => {
    if (window.confirm('确定要删除这个选手吗？')) {
      // 从未分配选手中删除
      const updatedUnassignedPlayers = unassignedPlayers.filter(player => player.id !== playerId);
      
      // 从队伍中删除
      const updatedTeams = teams.map(team => ({
        ...team,
        players: team.players.filter(player => player.id !== playerId),
        updated_at: new Date().toISOString()
      }));
      
      setUnassignedPlayers(updatedUnassignedPlayers);
      setTeams(updatedTeams);
      
      // 从API中删除
      try {
        const response = await fetch('/api/players', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ playerId }),
        });
        
        if (!response.ok) {
          throw new Error('删除选手失败');
        }
      } catch (error) {
        console.error('从API删除选手失败:', error);
      }
    }
  };

  // 重置分配
  const resetAssignments = async () => {
    // 清空所有队伍中的选手
    const updatedTeams = teams.map(team => ({
      ...team,
      players: [],
      updated_at: new Date().toISOString()
    }));
    
    setTeams(updatedTeams);
    
    // 清空API中的队伍选手关系
    try {
      for (const team of teams) {
        const response = await fetch('/api/team-players', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ teamId: team.id, playerIds: [] }),
        });
        
        if (!response.ok) {
          throw new Error(`重置队伍${team.id}失败`);
        }
      }
    } catch (error) {
      console.error('重置队伍选手关系失败:', error);
    }
  };

  // 保存配置
  const saveConfig = async () => {
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
    
    // 同步到API
    try {
      // 更新所有队伍中的选手关系
      for (const team of teams) {
        const playerIds = team.players.map(p => parseInt(p.id));
        const response = await fetch('/api/team-players', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ teamId: team.id, playerIds }),
        });
        
        if (!response.ok) {
          throw new Error(`保存队伍${team.id}失败`);
        }
      }
    } catch (error) {
      console.error('保存配置到API失败:', error);
    }
  };

  // 导入配置
  const importConfig = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        // 更新前端状态
        setTeams(data.teams || []);
        setUnassignedPlayers(data.unassignedPlayers || []);
        
        // 将数据导入到数据库
        // 1. 导入选手数据
        const allPlayers = [
          ...(data.unassignedPlayers || []),
          ...(data.teams || []).flatMap(team => team.players || [])
        ];
        
        // 清理重复的选手数据
        const uniquePlayers = allPlayers.filter((player, index, self) => 
          index === self.findIndex(p => p.id === player.id)
        );
        
        // 发送选手数据到API
        for (const player of uniquePlayers) {
          try {
            await fetch('/api/players', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(player),
            });
          } catch (error) {
            console.error('导入选手到数据库失败:', error);
          }
        }
        
        // 2. 导入队伍数据
        for (const team of (data.teams || [])) {
          try {
            await fetch('/api/teams', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(team),
            });
          } catch (error) {
            console.error('导入队伍到数据库失败:', error);
          }
        }
        
        // 3. 更新队伍选手关系
        for (const team of (data.teams || [])) {
          try {
            const playerIds = team.players.map(p => p.id);
            await fetch('/api/team-players', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
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

  // 复制选手steamID
  const copyPlayerGameId = (gameId) => {
    navigator.clipboard.writeText(gameId);
  };

  // 添加赛季相关的状态
  const [currentTournament, setCurrentTournament] = useState(null);
  const [showTournamentSelector, setShowTournamentSelector] = useState(false);
  const [showEditTournamentResults, setShowEditTournamentResults] = useState(false);
  const [isSwitchingTournament, setIsSwitchingTournament] = useState(false);
  const [tournaments, setTournaments] = useState([]);
  // 获取指定赛季的数据
  const fetchTournamentData = async (tournamentId) => {
    try {
      // 获取队伍数据
      const teamsResponse = await fetch(`/api/teams?tournament_id=${tournamentId}`);
      const teamsData = await teamsResponse.json();
      
      // 获取选手数据（该赛季的所有选手）
      const playersResponse = await fetch(`/api/players?tournament_id=${tournamentId}`);
      const playersData = await playersResponse.json();
      
      if (teamsData.success && playersData.success) {
        setTeams(teamsData.teams);
        
        // 从所有选手中排除已分配到队伍的选手，得到真正未分配的选手
        const assignedPlayerIds = teamsData.teams.flatMap(team => team.players.map(p => p.id));
        const unassigned = playersData.players.filter(player => !assignedPlayerIds.includes(player.id));
        setUnassignedPlayers(unassigned);
      }
    } catch (error) {
      console.error('获取赛季数据失败:', error);
    }
  };
  
  // 处理赛季选择
  const handleTournamentSelect = (tournament) => {
    setIsSwitchingTournament(true);
    setCurrentTournament(tournament);
    fetchTournamentData(tournament.id).finally(() => {
      setIsSwitchingTournament(false);
    });
  };
  // 处理保存赛季结果
  const handleSaveTournamentResults = (updatedTournament) => {
    if (updatedTournament) {
      // 更新当前赛季信息
      setCurrentTournament(updatedTournament);
      
      // 更新赛季列表
      setTournaments(prev => prev.map(t => 
        t.id === updatedTournament.id ? updatedTournament : t
      ));
    } else {
      // 赛季被删除
      setCurrentTournament(null);
      setTournaments(prev => prev.filter(t => t.id !== currentTournament.id));
      
      // 重置队伍和选手数据
      setTeams([]);
      setUnassignedPlayers([]);
    }
  };
  
  // 初始化时加载第一个赛季
  useEffect(() => {
    const loadInitialTournament = async () => {
      try {
        const response = await fetch('/api/tournaments');
        const data = await response.json();
        if (data.success) {
          setTournaments(data.tournaments);
          if (data.tournaments.length > 0) {
            const firstTournament = data.tournaments[0];
            setCurrentTournament(firstTournament);
            // 加载第一个赛季的数据
            await fetchTournamentData(firstTournament.id);
          }
        }
      } catch (error) {
        console.error('加载赛季数据失败:', error);
      }
    };

    loadInitialTournament();
  }, []);

  return (
    <div className="container">
      <Head>
        <title>Dom的活动记录</title>
        <meta name="description" content="比赛选手人员分配系统" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* 赛季切换 Loading 动画 */}
      {isSwitchingTournament && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-spinner"></div>
            <div className="loading-text">切换赛季中...</div>
          </div>
        </div>
      )}

      {/* 全局loading动画 */}
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
        {/* 头部区域 */}
        <header className="header">
          <h1>Dom的比赛纪录</h1>
          <div className="instructions">
            <p>拖拽选手卡片到队伍中进行分配 | 点击添加按钮选择选手 | 支持搜索和筛选功能</p>
          </div>
          
          {/* 统计卡片区域 */}
          <div className="stats-cards">
            <div className="stat-card total-players">
              <div className="stat-icon">🎮</div>
              <div className="stat-info">
                <div className="stat-title">本次参加人数</div>
                <div className="stat-value" id="totalPlayersCount">
                  {loadingState.players === 'loading' ? '读取中...' : 
                   loadingState.players === 'error' ? '加载失败' : 
                   unassignedPlayers.length + teams.reduce((total, team) => total + team.players.length, 0)}
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
                onClick={() => {
                  // 打开编辑赛季结果的模态框
                  setShowEditTournamentResults(true);
                }}
              >
                编辑结果
              </button>
            )}
          </div>
        </header>
        
        {/* 主体内容 */}
        <main className="main-content">
          {/* 队伍展示区 */}
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
              onDragOver={(e) => e.preventDefault()}
            >
              {loadingState.teams === 'loading' ? (
                <div className="loading-message">队伍信息读取中...</div>
              ) : loadingState.teams === 'error' ? (
                <div className="error-message">{loadingState.error || '加载队伍信息失败，请刷新页面重试'}</div>
              ) : (
                teams.map(team => (
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
                ))
              )}
            </div>
          </section>

          {/* 参赛选手池 */}
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
                  <label><input type="checkbox" className="position-filter" value="优势路" disabled={loadingState.players === 'loading'} /> 优势路</label>
                  <label><input type="checkbox" className="position-filter" value="中单" disabled={loadingState.players === 'loading'} /> 中单</label>
                  <label><input type="checkbox" className="position-filter" value="劣势路" disabled={loadingState.players === 'loading'} /> 劣势路</label>
                  <label><input type="checkbox" className="position-filter" value="半辅助" disabled={loadingState.players === 'loading'} /> 半辅助</label>
                  <label><input type="checkbox" className="position-filter" value="纯辅助" disabled={loadingState.players === 'loading'} /> 纯辅助</label>
                  <label><input type="checkbox" className="position-filter" value="全才" disabled={loadingState.players === 'loading'} /> 全才</label>
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
                  // 从队伍中移除选手，但不添加到未分配池
                  const updatedTeams = teams.map(team => {
                    if (team.players.some(p => p.id === draggedPlayerId)) {
                      return {
                        ...team,
                        players: team.players.filter(p => p.id !== draggedPlayerId),
                        updated_at: new Date().toISOString()
                      };
                    }
                    return team;
                  });
                  
                  setTeams(updatedTeams);
                  setDraggedPlayerId(null);
                }
              }}
            >
              {loadingState.players === 'loading' ? (
                <div className="loading-message">选手信息读取中...</div>
              ) : loadingState.players === 'error' ? (
                <div className="error-message">{loadingState.error || '加载选手信息失败，请刷新页面重试'}</div>
              ) : (
                (() => {
                  // 获取所有已分配的选手（从各个队伍中）
                  const assignedPlayers = teams.flatMap(team => team.players);
                  // 过滤并排序所有选手：已分配的在前，未分配的在后
                  const allPlayers = [
                    ...assignedPlayers, 
                    ...unassignedPlayers
                  ].filter(player => {
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
                  });

                  return (
                    <>
                      {allPlayers.map((player, index) => {
                        // 检查是否需要添加分隔线（当前是第一个未分配选手且前面有已分配选手）
                        const isUnassignedPlayer = unassignedPlayers.some(p => p.id === player.id);
                        const isAssignedPlayer = assignedPlayers.some(p => p.id === player.id);
                        const showDivider = isUnassignedPlayer && index > 0 && assignedPlayers.length > 0 && index === assignedPlayers.length;
                        
                        return (
                          <>
                            {showDivider && (
                              <div className="player-section-divider">
                                <span className="divider-text">未分配选手</span>
                              </div>
                            )}
                            <PlayerCard 
                              key={player.id} 
                              player={player} 
                              onDragStart={handleDragStart}
                              onEdit={editPlayer}
                              onDelete={deletePlayer}
                              onCopy={copyPlayerGameId}
                              className={isAssignedPlayer ? 'assigned-player' : ''}
                            />
                          </>
                        );
                      })}
                    </>
                  );
                })()
              )}
            </div>
          </section>
        </main>
        
        {/* 留言板悬浮按钮 */}
        <button 
          className="message-board-toggle"
          onClick={() => setShowMessageBoard(!showMessageBoard)}
        >
          <span className="message-board-icon">💬</span>
          留言板
        </button>
        
        {/* 随机留言显示框 */}
        {showRandomMessage && randomMessage && (
          <div className="random-message-container">
            <div className="random-message">
              <div className="random-message-content">
                <div className="random-message-header">
                  <span className="random-message-username">{randomMessage.username}</span>
                  <span className="random-message-time">
                    {new Date(randomMessage.created_at).toLocaleString('zh-CN', {
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
                <div className="random-message-text">{randomMessage.content}</div>
              </div>
              <button 
                className="close-random-message"
                onClick={() => setShowRandomMessage(false)}
              >
                ×
              </button>
            </div>
          </div>
        )}
        
        {/* 留言板 */}
        {showMessageBoard && (
          <div className="message-board-overlay">
            <div className="message-board">
              <div className="message-board-header">
                <h3>留言板</h3>
                <button 
                  className="close-message-board"
                  onClick={() => setShowMessageBoard(false)}
                >
                  ×
                </button>
              </div>
              
              <div className="message-board-content">
                {/* 留言列表 */}
                <div className="messages-list">
                  {messages.length === 0 ? (
                    <div className="no-messages">暂无留言</div>
                  ) : (
                    messages.map(message => (
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
                            onClick={() => likeMessage(message.id)}
                          >
                            {likedMessages.has(message.id) ? '👍 取消点赞 ' : '👍 点赞 '}
                            {message.likes || 0}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                
                {/* 留言输入表单 */}
                <div className="message-form">
                  <h4>发表留言</h4>
                  <form onSubmit={handleSubmitMessage}>
                    <div className="form-group">
                      <input
                        type="text"
                        placeholder="用户名"
                        value={newMessage.username}
                        onChange={(e) => setNewMessage({...newMessage, username: e.target.value})}
                        className="form-input"
                      />
                    </div>
                    <div className="form-group">
                      <textarea
                        placeholder="留言内容"
                        value={newMessage.content}
                        onChange={(e) => setNewMessage({...newMessage, content: e.target.value})}
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
                    <label htmlFor="newPlayerGameId">steamID *</label>
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
                    <label className="position-tag"><input type="checkbox" name="positions" value="优势路" /> 优势路</label>
                    <label className="position-tag"><input type="checkbox" name="positions" value="中单" /> 中单</label>
                    <label className="position-tag"><input type="checkbox" name="positions" value="劣势路" /> 劣势路</label>
                    <label className="position-tag"><input type="checkbox" name="positions" value="半辅助" /> 半辅助</label>
                    <label className="position-tag"><input type="checkbox" name="positions" value="纯辅助" /> 纯辅助</label>
                    <label className="position-tag"><input type="checkbox" name="positions" value="全才" /> 全才</label>
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
    </div>
  );
}
