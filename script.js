class TeamAssignmentSystem {
    // 生成低饱和度的随机背景色
    generateLowSaturationColor() {
        // 生成低饱和度的颜色，使用HSL色彩空间
        const hue = Math.floor(Math.random() * 360); // 色相 0-360
        const saturation = Math.floor(Math.random() * 30) + 10; // 饱和度 10-40%
        const lightness = Math.floor(Math.random() * 20) + 15; // 亮度 15-35%
        
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    constructor() {
        this.teams = [];
        this.unassignedPlayers = [];
        this.heroesList = [];
        this.currentTeamId = null;
        this.draggedPlayer = null;
        this.teamIdCounter = 1;
        this.selectedHeroes = [];
        this.selectedSynergyPlayers = [];
        this.tempSelectedSynergy = [];
        this.editingPlayerId = null;
        this.isEditing = false;
        
        this.init();
    }

    // 获取内嵌的默认数据
    getEmbeddedDefaultData() {
        return {
            teams: [],
            unassignedPlayers: [
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
            ],
            "timestamp": "2025-11-14T12:57:53.026Z"
        };
    }
    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.render();
    }

    async loadData() {
        try {
            // 使用内嵌的英雄列表
            this.heroesList = this.getEmbeddedHeroesList();
            
            // 尝试加载队伍配置文件
            try {
                const teamResponse = await fetch('data/teamconfig.json');
                const teamData = await teamResponse.json();
                
                this.teams = teamData.teams || [];
                this.unassignedPlayers = teamData.unassignedPlayers || [];
                
                // 如果没有队伍，创建一个默认队伍
                if (this.teams.length === 0) {
                    this.addTeam();
                } else {
                    // 设置队伍ID计数器
                    this.teamIdCounter = Math.max(...this.teams.map(t => t.id)) + 1;
                }
                
                // 生成一些示例选手数据（如果没有的话）
                if (this.unassignedPlayers.length === 0) {
                    this.generateSamplePlayers();
                }
            } catch (fileError) {
                console.log('配置文件加载失败，使用内嵌默认数据');
                // 使用内嵌的默认数据
                const defaultData = this.getEmbeddedDefaultData();
                this.teams = defaultData.teams;
                this.unassignedPlayers = defaultData.unassignedPlayers;
                
                // 创建默认队伍（如果没有的话）
                if (this.teams.length === 0) {
                    this.addTeam();
                } else {
                    // 设置队伍ID计数器
                    this.teamIdCounter = Math.max(...this.teams.map(t => t.id)) + 1;
                }
            }
        } catch (error) {
            console.error('加载数据失败:', error);
            this.generateSampleData();
        }
    }

    getEmbeddedHeroesList() {
        // 内嵌的英雄列表数据
        return [
            { id: 209, name: "上古巨神", nickname: "大牛,ET", created_at: "2025-11-14T00:10:34.125+08:00", updated_at: "2025-11-14T00:10:38.352806+08:00" },
            { id: 210, name: "不朽尸王", nickname: "尸王,DIRGE", created_at: "2025-11-14T00:10:34.214+08:00", updated_at: "2025-11-14T00:10:38.442318+08:00" },
            { id: 178, name: "主宰", nickname: "剑圣,Jugg", created_at: "2025-11-14T00:10:30.999+08:00", updated_at: "2025-11-14T00:10:35.528545+08:00" },
            { id: 272, name: "亚巴顿", nickname: "死骑,哑巴,LOA", created_at: "2025-11-14T00:10:40.342+08:00", updated_at: "2025-11-14T00:10:44.570866+08:00" },
            { id: 211, name: "伐木机", nickname: "花母鸡,伐木机,Timberraw", created_at: "2025-11-14T00:10:34.304+08:00", updated_at: "2025-11-14T00:10:38.532416+08:00" },
            { id: 241, name: "修补匠", nickname: "修补,TK,Tinker", created_at: "2025-11-14T00:10:37.522+08:00", updated_at: "2025-11-14T00:10:41.751688+08:00" },
            { id: 242, name: "光之守卫", nickname: "光法,白马,Koti", created_at: "2025-11-14T00:10:37.613+08:00", updated_at: "2025-11-14T00:10:41.84056+08:00" },
            { id: 179, name: "克林克兹", nickname: "骨弓,小骷髅,Clinkz", created_at: "2025-11-14T00:10:31.395+08:00", updated_at: "2025-11-14T00:10:35.623882+08:00" },
            { id: 212, name: "全能骑士", nickname: "全能,OK", created_at: "2025-11-14T00:10:34.395+08:00", updated_at: "2025-11-14T00:10:38.623627+08:00" },
            { id: 273, name: "兽王", nickname: "兽王,bm", created_at: "2025-11-14T00:10:40.432+08:00", updated_at: "2025-11-14T00:10:44.66164+08:00" },
            { id: 213, name: "军团指挥官", nickname: "军团,LC", created_at: "2025-11-14T00:10:34.487+08:00", updated_at: "2025-11-14T00:10:38.716164+08:00" },
            { id: 180, name: "冥界亚龙", nickname: "毒龙,Vip", created_at: "2025-11-14T00:10:31.489+08:00", updated_at: "2025-11-14T00:10:35.717792+08:00" },
            { id: 214, name: "冥魂大帝", nickname: "骷髅王,SNK", created_at: "2025-11-14T00:10:34.578+08:00", updated_at: "2025-11-14T00:10:38.80645+08:00" },
            { id: 274, name: "凤凰", nickname: "凤凰,phoanix", created_at: "2025-11-14T00:10:40.523+08:00", updated_at: "2025-11-14T00:10:44.752473+08:00" },
            { id: 303, name: "凯", nickname: "鸟人,", created_at: "2025-11-14T00:10:43.348+08:00", updated_at: "2025-11-14T00:10:47.577031+08:00" },
            { id: 275, name: "剧毒术士", nickname: "剧毒,veno", created_at: "2025-11-14T00:10:40.614+08:00", updated_at: "2025-11-14T00:10:44.842385+08:00" },
            { id: 181, name: "力丸", nickname: "隐刺,SA", created_at: "2025-11-14T00:10:31.58+08:00", updated_at: "2025-11-14T00:10:35.809432+08:00" },
            { id: 215, name: "半人马战行者", nickname: "人马,CW", created_at: "2025-11-14T00:10:34.668+08:00", updated_at: "2025-11-14T00:10:38.896516+08:00" },
            { id: 182, name: "卓尔游侠", nickname: "小黑,黑弓,DROW", created_at: "2025-11-14T00:10:31.671+08:00", updated_at: "2025-11-14T00:10:35.900372+08:00" },
            { id: 276, name: "发条技师", nickname: "发条,clock", created_at: "2025-11-14T00:10:40.705+08:00", updated_at: "2025-11-14T00:10:44.93357+08:00" },
            { id: 183, name: "变体精灵", nickname: "水人,波高,morph", created_at: "2025-11-14T00:10:31.762+08:00", updated_at: "2025-11-14T00:10:35.990491+08:00" },
            { id: 277, name: "司夜刺客", nickname: "小强,NA", created_at: "2025-11-14T00:10:40.795+08:00", updated_at: "2025-11-14T00:10:45.023493+08:00" },
            { id: 216, name: "哈斯卡", nickname: "神灵,单车武士,Hus", created_at: "2025-11-14T00:10:34.759+08:00", updated_at: "2025-11-14T00:10:38.987895+08:00" },
            { id: 217, name: "噬魂鬼", nickname: "小狗,IS", created_at: "2025-11-14T00:10:34.849+08:00", updated_at: "2025-11-14T00:10:39.077556+08:00" },
            { id: 184, name: "圣堂刺客", nickname: "圣堂,TA", created_at: "2025-11-14T00:10:31.852+08:00", updated_at: "2025-11-14T00:10:36.086014+08:00" },
            { id: 278, name: "复仇之魂", nickname: "VS", created_at: "2025-11-14T00:10:40.885+08:00", updated_at: "2025-11-14T00:10:45.116155+08:00" },
            { id: 218, name: "大地之灵", nickname: "土猫,Earth", created_at: "2025-11-14T00:10:34.939+08:00", updated_at: "2025-11-14T00:10:39.168273+08:00" },
            { id: 243, name: "天怒法师", nickname: "天怒,龙鹰,SKY", created_at: "2025-11-14T00:10:37.702+08:00", updated_at: "2025-11-14T00:10:41.931021+08:00" },
            { id: 244, name: "天涯墨客", nickname: "墨客,Grimstroke", created_at: "2025-11-14T00:10:37.792+08:00", updated_at: "2025-11-14T00:10:42.020256+08:00" },
            { id: 185, name: "天穹守望者", nickname: "电狗,AW", created_at: "2025-11-14T00:10:31.947+08:00", updated_at: "2025-11-14T00:10:36.175445+08:00" },
            { id: 186, name: "娜迦海妖", nickname: "小娜迦,nage", created_at: "2025-11-14T00:10:32.037+08:00", updated_at: "2025-11-14T00:10:36.265379+08:00" },
            { id: 219, name: "孽主", nickname: "大屁股,UL", created_at: "2025-11-14T00:10:35.03+08:00", updated_at: "2025-11-14T00:10:39.257866+08:00" },
            { id: 245, name: "宙斯", nickname: "宙斯,Zeus", created_at: "2025-11-14T00:10:37.883+08:00", updated_at: "2025-11-14T00:10:42.117863+08:00" },
            { id: 279, name: "寒冬飞龙", nickname: "冰龙,WW", created_at: "2025-11-14T00:10:40.977+08:00", updated_at: "2025-11-14T00:10:45.206359+08:00" },
            { id: 220, name: "小小", nickname: "小小,山岭,Tiny", created_at: "2025-11-14T00:10:35.119+08:00", updated_at: "2025-11-14T00:10:39.346352+08:00" },
            { id: 280, name: "工程师", nickname: "炸弹人,Techies", created_at: "2025-11-14T00:10:41.068+08:00", updated_at: "2025-11-14T00:10:45.296768+08:00" },
            { id: 221, name: "巨牙海民", nickname: "海民,Tusk", created_at: "2025-11-14T00:10:35.208+08:00", updated_at: "2025-11-14T00:10:39.436028+08:00" },
            { id: 187, name: "巨魔战将", nickname: "巨魔,Troll", created_at: "2025-11-14T00:10:32.13+08:00", updated_at: "2025-11-14T00:10:36.359644+08:00" },
            { id: 246, name: "巫医", nickname: "巫医,51,WD", created_at: "2025-11-14T00:10:37.979+08:00", updated_at: "2025-11-14T00:10:42.210203+08:00" },
            { id: 247, name: "巫妖", nickname: "巫妖,Lich", created_at: "2025-11-14T00:10:38.071+08:00", updated_at: "2025-11-14T00:10:42.300197+08:00" },
            { id: 248, name: "帕克", nickname: "帕克,大头苍蝇,精灵龙,puck", created_at: "2025-11-14T00:10:38.162+08:00", updated_at: "2025-11-14T00:10:42.391413+08:00" },
            { id: 222, name: "帕吉", nickname: "屠夫,Pudge", created_at: "2025-11-14T00:10:35.297+08:00", updated_at: "2025-11-14T00:10:39.525314+08:00" },
            { id: 249, name: "帕格纳", nickname: "骨法,Pugna", created_at: "2025-11-14T00:10:38.253+08:00", updated_at: "2025-11-14T00:10:42.481485+08:00" },
            { id: 250, name: "干扰者", nickname: "萨尔,Disruptor", created_at: "2025-11-14T00:10:38.342+08:00", updated_at: "2025-11-14T00:10:42.571273+08:00" },
            { id: 188, name: "幻影刺客", nickname: "幻刺,PA", created_at: "2025-11-14T00:10:32.223+08:00", updated_at: "2025-11-14T00:10:36.451896+08:00" },
            { id: 189, name: "幻影长矛手", nickname: "猴子,分身猴,PL", created_at: "2025-11-14T00:10:32.313+08:00", updated_at: "2025-11-14T00:10:36.54126+08:00" },
            { id: 190, name: "幽鬼", nickname: "幽鬼,UG,Spe", created_at: "2025-11-14T00:10:32.404+08:00", updated_at: "2025-11-14T00:10:36.631426+08:00" },
            { id: 191, name: "影魔", nickname: "影魔,SF", created_at: "2025-11-14T00:10:32.493+08:00", updated_at: "2025-11-14T00:10:36.725317+08:00" },
            { id: 192, name: "恐怖利刃", nickname: "魂守,TB", created_at: "2025-11-14T00:10:32.586+08:00", updated_at: "2025-11-14T00:10:36.815528+08:00" },
            { id: 281, name: "戴泽", nickname: "暗牧,Dazzle", created_at: "2025-11-14T00:10:41.158+08:00", updated_at: "2025-11-14T00:10:45.386785+08:00" },
            { id: 251, name: "拉席克", nickname: "老鹿,TS", created_at: "2025-11-14T00:10:38.432+08:00", updated_at: "2025-11-14T00:10:42.660681+08:00" },
            { id: 252, name: "拉比克", nickname: "大魔导,蜡笔,fy,Rubick", created_at: "2025-11-14T00:10:38.522+08:00", updated_at: "2025-11-14T00:10:42.753165+08:00" },
            { id: 223, name: "撼地者", nickname: "小牛,ES", created_at: "2025-11-14T00:10:35.386+08:00", updated_at: "2025-11-14T00:10:39.613827+08:00" },
            { id: 193, name: "敌法师", nickname: "敌法,AM", created_at: "2025-11-14T00:10:32.677+08:00", updated_at: "2025-11-14T00:10:36.90623+08:00" },
            { id: 224, name: "斧王", nickname: "斧王,Axe", created_at: "2025-11-14T00:10:35.474+08:00", updated_at: "2025-11-14T00:10:39.702384+08:00" },
            { id: 194, name: "斯拉克", nickname: "小鱼人,弟弟鱼,Slark", created_at: "2025-11-14T00:10:32.768+08:00", updated_at: "2025-11-14T00:10:36.995491+08:00" },
            { id: 225, name: "斯拉达", nickname: "大鱼,SL", created_at: "2025-11-14T00:10:35.564+08:00", updated_at: "2025-11-14T00:10:39.792389+08:00" },
            { id: 226, name: "斯温", nickname: "流浪,斯温,奥特曼,SV", created_at: "2025-11-14T00:10:35.653+08:00", updated_at: "2025-11-14T00:10:39.882465+08:00" },
            { id: 227, name: "昆卡", nickname: "船长,CoCo", created_at: "2025-11-14T00:10:35.743+08:00", updated_at: "2025-11-14T00:10:39.971858+08:00" },
            { id: 228, name: "暗夜魔王", nickname: "夜魔,NS", created_at: "2025-11-14T00:10:35.835+08:00", updated_at: "2025-11-14T00:10:40.084143+08:00" },
            { id: 253, name: "暗影恶魔", nickname: "毒狗,SD", created_at: "2025-11-14T00:10:38.614+08:00", updated_at: "2025-11-14T00:10:42.842619+08:00" },
            { id: 254, name: "暗影萨满", nickname: "小Y,SS", created_at: "2025-11-14T00:10:38.704+08:00", updated_at: "2025-11-14T00:10:42.93308+08:00" },
            { id: 229, name: "末日使者", nickname: "末日,Doom", created_at: "2025-11-14T00:10:35.945+08:00", updated_at: "2025-11-14T00:10:40.183859+08:00" },
            { id: 255, name: "术士", nickname: "术士,Warlock", created_at: "2025-11-14T00:10:38.794+08:00", updated_at: "2025-11-14T00:10:43.024198+08:00" },
            { id: 256, name: "杰奇洛", nickname: "双头龙,Jakiro", created_at: "2025-11-14T00:10:38.888+08:00", updated_at: "2025-11-14T00:10:43.119972+08:00" },
            { id: 230, name: "树精卫士", nickname: "大树,TP", created_at: "2025-11-14T00:10:36.046+08:00", updated_at: "2025-11-14T00:10:40.273863+08:00" },
            { id: 195, name: "森海飞霞", nickname: "小松鼠,Hoodwink", created_at: "2025-11-14T00:10:32.858+08:00", updated_at: "2025-11-14T00:10:37.086258+08:00" },
            { id: 257, name: "死亡先知", nickname: "DP", created_at: "2025-11-14T00:10:38.982+08:00", updated_at: "2025-11-14T00:10:43.215258+08:00" },
            { id: 258, name: "殁境神蚀者", nickname: "黑鸟,目光呆滞,OD", created_at: "2025-11-14T00:10:39.077+08:00", updated_at: "2025-11-14T00:10:43.305485+08:00" },
            { id: 259, name: "水晶侍女", nickname: "冰女,CM", created_at: "2025-11-14T00:10:39.166+08:00", updated_at: "2025-11-14T00:10:43.395016+08:00" },
            { id: 260, name: "沉默术士", nickname: "沉默,SIL", created_at: "2025-11-14T00:10:39.257+08:00", updated_at: "2025-11-14T00:10:43.486458+08:00" },
            { id: 282, name: "沙王", nickname: "沙王,鞋子,SK", created_at: "2025-11-14T00:10:41.248+08:00", updated_at: "2025-11-14T00:10:45.476618+08:00" },
            { id: 231, name: "混沌骑士", nickname: "混沌,CK", created_at: "2025-11-14T00:10:36.135+08:00", updated_at: "2025-11-14T00:10:40.609062+08:00" },
            { id: 232, name: "潮汐猎人", nickname: "潮汐,西瓜皮,TH", created_at: "2025-11-14T00:10:36.47+08:00", updated_at: "2025-11-14T00:10:40.698538+08:00" },
            { id: 196, name: "灰烬之灵", nickname: "火猫,ES", created_at: "2025-11-14T00:10:32.947+08:00", updated_at: "2025-11-14T00:10:37.175222+08:00" },
            { id: 233, name: "炼金术士", nickname: "炼金,GA", created_at: "2025-11-14T00:10:36.561+08:00", updated_at: "2025-11-14T00:10:40.996987+08:00" },
            { id: 197, name: "熊战士", nickname: "拍拍熊,Ursa", created_at: "2025-11-14T00:10:33.038+08:00", updated_at: "2025-11-14T00:10:37.267725+08:00" },
            { id: 198, name: "狙击手", nickname: "矮子,火枪,Sniper", created_at: "2025-11-14T00:10:33.129+08:00", updated_at: "2025-11-14T00:10:37.357297+08:00" },
            { id: 284, name: "独行德鲁伊", nickname: "德鲁伊,熊德,LD", created_at: "2025-11-14T00:10:41.431+08:00", updated_at: "2025-11-14T00:10:45.659851+08:00" },
            { id: 283, name: "狼人", nickname: "狼人,Lycan", created_at: "2025-11-14T00:10:41.337+08:00", updated_at: "2025-11-14T00:10:45.565742+08:00" },
            { id: 234, name: "獣", nickname: "畜,Beast", created_at: "2025-11-14T00:10:36.858+08:00", updated_at: "2025-11-14T00:10:41.087097+08:00" },
            { id: 235, name: "玛尔斯", nickname: "玛尔斯,Mars", created_at: "2025-11-14T00:10:36.948+08:00", updated_at: "2025-11-14T00:10:41.176893+08:00" },
            { id: 285, name: "玛西", nickname: "玛西,女拳,Marci", created_at: "2025-11-14T00:10:41.521+08:00", updated_at: "2025-11-14T00:10:45.750294+08:00" },
            { id: 261, name: "琼英碧灵", nickname: "奶绿,琼逼,Muerta", created_at: "2025-11-14T00:10:39.347+08:00", updated_at: "2025-11-14T00:10:43.575419+08:00" },
            { id: 286, name: "电炎绝手", nickname: "奶奶,老太婆,Snapfire", created_at: "2025-11-14T00:10:41.611+08:00", updated_at: "2025-11-14T00:10:45.839353+08:00" },
            { id: 262, name: "痛苦女王", nickname: "女王,QOP", created_at: "2025-11-14T00:10:39.437+08:00", updated_at: "2025-11-14T00:10:43.665369+08:00" },
            { id: 263, name: "瘟疫法师", nickname: "死灵法,nec", created_at: "2025-11-14T00:10:39.527+08:00", updated_at: "2025-11-14T00:10:43.757809+08:00" },
            { id: 264, name: "百戏大王", nickname: "百戏,小丑,Ringmaster", created_at: "2025-11-14T00:10:39.619+08:00", updated_at: "2025-11-14T00:10:43.848354+08:00" },
            { id: 199, name: "矮人直升机", nickname: "飞机,gyr", created_at: "2025-11-14T00:10:33.219+08:00", updated_at: "2025-11-14T00:10:37.447339+08:00" },
            { id: 287, name: "石鳞剑士", nickname: "滚滚,Pangolier", created_at: "2025-11-14T00:10:41.701+08:00", updated_at: "2025-11-14T00:10:45.93022+08:00" },
            { id: 236, name: "破晓辰星", nickname: "大锤,锤妹,DB", created_at: "2025-11-14T00:10:37.038+08:00", updated_at: "2025-11-14T00:10:41.267533+08:00" },
            { id: 288, name: "祈求者", nickname: "卡尔,Invoker", created_at: "2025-11-14T00:10:41.791+08:00", updated_at: "2025-11-14T00:10:46.022162+08:00" },
            { id: 265, name: "神谕者", nickname: "神谕,Oracle", created_at: "2025-11-14T00:10:39.711+08:00", updated_at: "2025-11-14T00:10:43.939353+08:00" },
            { id: 289, name: "祸乱之源", nickname: "祸乱,水桶腰,Bane", created_at: "2025-11-14T00:10:41.883+08:00", updated_at: "2025-11-14T00:10:46.112258+08:00" },
            { id: 290, name: "米拉娜", nickname: "白虎,Pom", created_at: "2025-11-14T00:10:41.974+08:00", updated_at: "2025-11-14T00:10:46.202298+08:00" },
            { id: 200, name: "米波", nickname: "地狗,米波,Meepo", created_at: "2025-11-14T00:10:33.309+08:00", updated_at: "2025-11-14T00:10:37.537556+08:00" },
            { id: 291, name: "维萨吉", nickname: "死灵龙,Vis", created_at: "2025-11-14T00:10:42.064+08:00", updated_at: "2025-11-14T00:10:46.291843+08:00" },
            { id: 201, name: "编织者", nickname: "蚂蚁,Weaver", created_at: "2025-11-14T00:10:33.399+08:00", updated_at: "2025-11-14T00:10:37.627781+08:00" },
            { id: 202, name: "美杜莎", nickname: "一姐,大娜迦,Med", created_at: "2025-11-14T00:10:33.492+08:00", updated_at: "2025-11-14T00:10:37.722027+08:00" },
            { id: 292, name: "育母蜘蛛", nickname: "蜘蛛,Broodmother", created_at: "2025-11-14T00:10:42.357+08:00", updated_at: "2025-11-14T00:10:46.585213+08:00" },
            { id: 266, name: "自然先知", nickname: "先知,FUR", created_at: "2025-11-14T00:10:39.801+08:00", updated_at: "2025-11-14T00:10:44.029518+08:00" },
            { id: 293, name: "艾欧", nickname: "小精灵,IO", created_at: "2025-11-14T00:10:42.446+08:00", updated_at: "2025-11-14T00:10:46.675374+08:00" },
            { id: 267, name: "莉娜", nickname: "莉娜,火女,lina", created_at: "2025-11-14T00:10:39.894+08:00", updated_at: "2025-11-14T00:10:44.121836+08:00" },
            { id: 268, name: "莱恩", nickname: "莱恩,若风巫师,Lion", created_at: "2025-11-14T00:10:39.983+08:00", updated_at: "2025-11-14T00:10:44.210854+08:00" },
            { id: 294, name: "虚无之灵", nickname: "紫猫,Void Spirit", created_at: "2025-11-14T00:10:42.537+08:00", updated_at: "2025-11-14T00:10:46.765685+08:00" },
            { id: 203, name: "虚空假面", nickname: "虚空,J8脸,FV", created_at: "2025-11-14T00:10:33.584+08:00", updated_at: "2025-11-14T00:10:37.812542+08:00" },
            { id: 295, name: "蝙蝠骑士", nickname: "蝙蝠,Bat", created_at: "2025-11-14T00:10:42.628+08:00", updated_at: "2025-11-14T00:10:46.856623+08:00" },
            { id: 204, name: "血魔", nickname: "血魔,BS", created_at: "2025-11-14T00:10:33.674+08:00", updated_at: "2025-11-14T00:10:37.903741+08:00" },
            { id: 237, name: "裂魂人", nickname: "白牛,SB", created_at: "2025-11-14T00:10:37.129+08:00", updated_at: "2025-11-14T00:10:41.357885+08:00" },
            { id: 296, name: "谜团", nickname: "谜团,Enigma", created_at: "2025-11-14T00:10:42.718+08:00", updated_at: "2025-11-14T00:10:46.947331+08:00" },
            { id: 205, name: "赏金猎人", nickname: "赏金,BH", created_at: "2025-11-14T00:10:33.765+08:00", updated_at: "2025-11-14T00:10:37.993385+08:00" },
            { id: 269, name: "远古冰魄", nickname: "冰魂,AA", created_at: "2025-11-14T00:10:40.072+08:00", updated_at: "2025-11-14T00:10:44.301233+08:00" },
            { id: 297, name: "邪影芳灵", nickname: "小仙女,花仙,Dark Willow", created_at: "2025-11-14T00:10:42.809+08:00", updated_at: "2025-11-14T00:10:47.03684+08:00" },
            { id: 298, name: "酒仙", nickname: "熊猫,PB", created_at: "2025-11-14T00:10:42.898+08:00", updated_at: "2025-11-14T00:10:47.126666+08:00" },
            { id: 238, name: "钢背兽", nickname: "刚被,BB猪,BB", created_at: "2025-11-14T00:10:37.22+08:00", updated_at: "2025-11-14T00:10:41.448625+08:00" },
            { id: 299, name: "陈", nickname: "圣骑,CHEN", created_at: "2025-11-14T00:10:42.988+08:00", updated_at: "2025-11-14T00:10:47.216177+08:00" },
            { id: 206, name: "雷泽", nickname: "电棍,电魂,Razor", created_at: "2025-11-14T00:10:33.855+08:00", updated_at: "2025-11-14T00:10:38.083623+08:00" },
            { id: 207, name: "露娜", nickname: "月骑,露娜,Luna", created_at: "2025-11-14T00:10:33.945+08:00", updated_at: "2025-11-14T00:10:38.174012+08:00" },
            { id: 270, name: "风暴之灵", nickname: "蓝猫,电猫,Storm", created_at: "2025-11-14T00:10:40.163+08:00", updated_at: "2025-11-14T00:10:44.391422+08:00" },
            { id: 300, name: "风行者", nickname: "风行,WR", created_at: "2025-11-14T00:10:43.078+08:00", updated_at: "2025-11-14T00:10:47.30609+08:00" },
            { id: 239, name: "食人魔魔法师", nickname: "蓝胖,OM", created_at: "2025-11-14T00:10:37.31+08:00", updated_at: "2025-11-14T00:10:41.540905+08:00" },
            { id: 301, name: "马格纳斯", nickname: "猛犸,颠勺,Magnus", created_at: "2025-11-14T00:10:43.168+08:00", updated_at: "2025-11-14T00:10:47.396342+08:00" },
            { id: 271, name: "魅惑魔女", nickname: "小鹿,Enchantress", created_at: "2025-11-14T00:10:40.252+08:00", updated_at: "2025-11-14T00:10:44.4809+08:00" },
            { id: 302, name: "黑暗贤者", nickname: "黑贤,兔子,DS", created_at: "2025-11-14T00:10:43.258+08:00", updated_at: "2025-11-14T00:10:47.486311+08:00" },
            { id: 208, name: "齐天大圣", nickname: "大圣,Monkey King", created_at: "2025-11-14T00:10:34.035+08:00", updated_at: "2025-11-14T00:10:38.263329+08:00" },
            { id: 240, name: "龙骑士", nickname: "龙骑,DK", created_at: "2025-11-14T00:10:37.402+08:00", updated_at: "2025-11-14T00:10:41.660232+08:00" }
        ];
    }

    generateSampleData() {
        // 使用内嵌的英雄列表
        this.heroesList = this.getEmbeddedHeroesList();
        
        // 创建默认队伍
        this.addTeam();
        
        // 生成示例选手
        this.generateSamplePlayers();
    }

    generateSamplePlayers() {
        const positions = ["优势路", "中单", "劣势路", "半辅助", "纯辅助", "全才"];
        const sampleNames = [
            { nickname: "暗夜猎手", game_id: "NightHunter", group_nickname: "猎手" },
            { nickname: "烈焰战士", game_id: "FlameWarrior", group_nickname: "火男" },
            { nickname: "冰霜法师", game_id: "FrostMage", group_nickname: "冰法" },
            { nickname: "雷霆骑士", game_id: "ThunderKnight", group_nickname: "雷骑" },
            { nickname: "暗影刺客", game_id: "ShadowAssassin", group_nickname: "影刺" },
            { nickname: "圣光牧师", game_id: "HolyPriest", group_nickname: "牧师" },
            { nickname: "狂战士", game_id: "Berserker", group_nickname: "狂战" },
            { nickname: "元素法师", game_id: "ElementMage", group_nickname: "元素" }
        ];

        this.unassignedPlayers = sampleNames.map((name, index) => ({
            id: Date.now() + index,
            nickname: name.nickname,
            game_id: name.game_id,
            group_nickname: name.group_nickname,
            score: Math.floor(Math.random() * 20000) + 5000,  // 更新为0-25000范围
            positions: [positions[Math.floor(Math.random() * positions.length)]],
            heroes: this.getRandomHeroes(3),
            win_rate: Math.floor(Math.random() * 40) + 40,
            championships: Math.floor(Math.random() * 5),
            synergy_players: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }));
    }

    getRandomHeroes(count) {
        const shuffled = [...this.heroesList].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count).map(hero => hero.name);
    }

    setupEventListeners() {
        // 添加队伍按钮
        document.getElementById('addTeamBtn').addEventListener('click', () => this.addTeam());
        
        // 新增选手按钮
        document.getElementById('addPlayerBtn').addEventListener('click', () => this.showNewPlayerModal());
        
        // 重置、保存、导入、导出按钮
        document.getElementById('resetBtn').addEventListener('click', () => this.resetAssignment());
        document.getElementById('saveBtn').addEventListener('click', () => this.saveConfiguration());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportData());
        document.getElementById('importBtn').addEventListener('click', () => {
            document.getElementById('importFile').click();
        });
        
        document.getElementById('importFile').addEventListener('change', (e) => this.importData(e));
        
        // 搜索功能
        document.getElementById('searchInput').addEventListener('input', (e) => this.filterPlayers(e.target.value));
        
        // 位置筛选
        document.querySelectorAll('.position-filter').forEach(checkbox => {
            checkbox.addEventListener('change', () => this.filterPlayers());
        });
        
        // 对话框相关
        document.getElementById('closeModal').addEventListener('click', () => this.closeModal());
        document.querySelector('.modal-backdrop').addEventListener('click', () => this.closeModal());
        document.getElementById('modalSearchInput').addEventListener('input', (e) => this.filterModalPlayers(e.target.value));
        
        // 新增选手对话框相关
        document.getElementById('closeNewPlayerModal').addEventListener('click', () => this.closeNewPlayerModal());
        document.getElementById('cancelNewPlayer').addEventListener('click', () => this.closeNewPlayerModal());
        document.getElementById('newPlayerForm').addEventListener('submit', (e) => this.handleNewPlayerSubmit(e));
        
        // 天梯分数实时预览
        document.getElementById('newPlayerScore').addEventListener('input', (e) => this.updateScorePreview(e.target.value));
        
        // 英雄选择相关
        document.getElementById('selectHeroesBtn').addEventListener('click', () => this.showHeroesModal());
        document.getElementById('closeHeroesModal').addEventListener('click', () => this.closeHeroesModal());
        document.getElementById('cancelHeroesSelect').addEventListener('click', () => this.closeHeroesModal());
        document.getElementById('confirmHeroesSelect').addEventListener('click', () => this.confirmHeroesSelect());
        document.getElementById('heroesSearchInput').addEventListener('input', (e) => this.filterHeroes(e.target.value));
        
        // 默契选手选择相关
        document.getElementById('selectSynergyBtn').addEventListener('click', () => this.showSynergyModal());
        document.getElementById('closeSynergyModal').addEventListener('click', () => this.closeSynergyModal());
        document.getElementById('cancelSynergySelect').addEventListener('click', () => this.closeSynergyModal());
        document.getElementById('confirmSynergySelect').addEventListener('click', () => this.confirmSynergySelect());
        document.getElementById('synergySearchInput').addEventListener('input', (e) => this.filterSynergyPlayers(e.target.value));
    }

    addTeam() {
        const newTeam = {
            id: this.teamIdCounter++,
            name: `队伍${this.teams.length + 1}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            players: [],
            unassignedPlayers: []
        };
        
        this.teams.push(newTeam);
        this.render();
    }

    removeTeam(teamId) {
        if (this.teams.length <= 1) {
            alert('至少需要保留一个队伍！');
            return;
        }
        
        const teamIndex = this.teams.findIndex(t => t.id === teamId);
        if (teamIndex !== -1) {
            const team = this.teams[teamIndex];
            // 将队伍中的选手移回未分配池
            this.unassignedPlayers.push(...team.players);
            this.teams.splice(teamIndex, 1);
            this.render();
        }
    }

    addPlayerToTeam(teamId) {
        const team = this.teams.find(t => t.id === teamId);
        if (team && team.players.length >= 5) {
            alert('该队伍已满员（5人），无法添加更多选手！');
            return;
        }
        this.currentTeamId = teamId;
        this.showModal();
    }

    removePlayerFromTeam(teamId, playerId) {
        const team = this.teams.find(t => t.id === teamId);
        if (team) {
            const playerIndex = team.players.findIndex(p => p.id === playerId);
            if (playerIndex !== -1) {
                const player = team.players[playerIndex];
                team.players.splice(playerIndex, 1);
                this.unassignedPlayers.push(player);
                this.render();
            }
        }
    }

    showModal() {
        const modal = document.getElementById('addPlayerModal');
        modal.classList.add('active');
        this.renderModalPlayers();
    }

    closeModal() {
        const modal = document.getElementById('addPlayerModal');
        modal.classList.remove('active');
        document.getElementById('modalSearchInput').value = '';
        this.currentTeamId = null;
    }

    renderModalPlayers(searchTerm = '') {
        const container = document.getElementById('modalPlayersList');
        let players = [...this.unassignedPlayers];
        
        // 搜索过滤
        if (searchTerm) {
            players = players.filter(player => 
                player.nickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
                player.game_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                player.group_nickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
                player.positions.some(pos => pos.toLowerCase().includes(searchTerm.toLowerCase())) ||
                player.heroes.some(hero => hero.toLowerCase().includes(searchTerm.toLowerCase()))
            );
        }
        
        container.innerHTML = players.map(player => `
            <div class="modal-player-item" onclick="teamSystem.selectPlayerForTeam(${player.id})">
                <div class="player-header">
                    <span class="player-name">${player.nickname}</span>
                    <span class="player-game-id">${player.game_id}</span>
                </div>
                <div class="player-info">
                    <div class="player-info-item">
                        <span class="player-info-label">群昵称</span>
                        <span class="player-info-value">${player.group_nickname}</span>
                    </div>
                    <div class="player-info-item">
                        <span class="player-info-label">天梯分数</span>
                        <span class="player-info-value score-value ${this.getScoreClass(player.score)}">${player.score}</span>
                    </div>
                    <div class="player-info-item">
                        <span class="player-info-label">胜率</span>
                        <span class="player-info-value">${player.win_rate}%</span>
                    </div>
                    <div class="player-info-item">
                        <span class="player-info-label">冠军</span>
                        <span class="player-info-value">${player.championships}</span>
                    </div>
                </div>
                <div class="position-tags">
                    ${player.positions.map(pos => `<span class="position-tag">${pos}</span>`).join('')}
                </div>
                <div class="heroes-list">
                    ${player.heroes.map(hero => `<span class="hero-tag">${hero}</span>`).join('')}
                </div>
            </div>
        `).join('');
    }

    filterModalPlayers(searchTerm) {
        this.renderModalPlayers(searchTerm);
    }

    selectPlayerForTeam(playerId) {
        const team = this.teams.find(t => t.id === this.currentTeamId);
        if (team) {
            // 检查队伍是否已满
            if (team.players.length >= 5) {
                alert('该队伍已满员（5人），无法添加更多选手！');
                return;
            }
            
            const playerIndex = this.unassignedPlayers.findIndex(p => p.id === playerId);
            if (playerIndex !== -1) {
                const player = this.unassignedPlayers[playerIndex];
                team.players.push(player);
                this.unassignedPlayers.splice(playerIndex, 1);
                this.closeModal();
                this.render();
            }
        }
    }

    filterPlayers(searchTerm = '') {
        const container = document.getElementById('unassignedPlayersContainer');
        const checkedPositions = Array.from(document.querySelectorAll('.position-filter:checked')).map(cb => cb.value);
        
        let players = [...this.unassignedPlayers];
        
        // 搜索过滤
        if (searchTerm) {
            players = players.filter(player => 
                player.nickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
                player.game_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                player.group_nickname.toLowerCase().includes(searchTerm.toLowerCase()) ||
                player.positions.some(pos => pos.toLowerCase().includes(searchTerm.toLowerCase())) ||
                player.heroes.some(hero => hero.toLowerCase().includes(searchTerm.toLowerCase()))
            );
        }
        
        // 位置过滤
        if (checkedPositions.length > 0) {
            players = players.filter(player => 
                player.positions.some(pos => checkedPositions.includes(pos))
            );
        }
        
        container.innerHTML = players.map(player => this.createPlayerCard(player, true)).join('');
        this.setupDragAndDrop();
    }

    getScoreClass(score) {
        if (score >= 20000) return 'score-high';
        if (score >= 10000) return 'score-medium';
        return 'score-low';
    }

    calculateTeamScore(players) {
        return players.reduce((total, player) => total + player.score, 0);
    }

    hasSynergy(team) {
        // 简单的羁绊检测逻辑
        const playerIds = team.players.map(p => p.id);
        return team.players.some(player => 
            player.synergy_players && player.synergy_players.some(sp => playerIds.includes(sp))
        );
    }

    createPlayerCard(player, isDraggable = false, isSimplified = false) {
        const draggable = isDraggable ? 'draggable="true"' : '';
        const randomBgColor = this.generateLowSaturationColor();
        
        if (isSimplified) {
            // 简化模式：只显示昵称、游戏ID、群昵称、天梯分数、冠军数量
            return `
                <div class="player-card simplified" ${draggable} data-player-id="${player.id}" style="background: ${randomBgColor};">
                    ${!isDraggable ? `<button class="remove-player-btn" onclick="teamSystem.removePlayerFromTeam(${player.teamId}, ${player.id})">×</button>` : ''}
                    <div class="player-header">
                        <span class="player-name">${player.nickname}</span>
                        <span class="player-game-id">${player.game_id}</span>
                    </div>
                    <div class="player-info simplified-info">
                        <div class="player-info-item">
                            <span class="player-info-label">群昵称</span>
                            <span class="player-info-value">${player.group_nickname}</span>
                        </div>
                        <div class="player-info-item">
                            <span class="player-info-label">天梯分数</span>
                            <span class="player-info-value score-value ${this.getScoreClass(player.score)}">${player.score}</span>
                        </div>
                        <div class="player-info-item">
                            <span class="player-info-label">冠军</span>
                            <span class="player-info-value">${player.championships}</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // 完整模式：显示所有信息
            const synergyHtml = player.synergy_players && player.synergy_players.length > 0 ? `
                <div class="synergy-players">
                    <div class="synergy-players-label">默契选手:</div>
                    <div>
                        ${player.synergy_players.map(sp => `<span class="synergy-player-name">${sp}</span>`).join('')}
                    </div>
                </div>
            ` : '';
            
            return `
                <div class="player-card" ${draggable} data-player-id="${player.id}" style="background: ${randomBgColor};">
                    ${!isDraggable ? `<button class="remove-player-btn" onclick="teamSystem.removePlayerFromTeam(${player.teamId}, ${player.id})">×</button>` : ''}
                    ${isDraggable ? `
                        <div class="player-actions">
                            <button class="player-action-btn edit-btn" onclick="teamSystem.editPlayer(${player.id})" title="修改选手信息">✏️</button>
                            <button class="player-action-btn delete-btn" onclick="teamSystem.deletePlayer(${player.id})" title="删除选手">🗑️</button>
                            <button class="player-action-btn copy-btn" onclick="teamSystem.copyPlayerGameId(${player.id})" title="复制游戏ID">📋</button>
                        </div>
                    ` : ''}
                    <div class="player-header">
                        <span class="player-name">${player.nickname}</span>
                        <span class="player-game-id">${player.game_id}</span>
                    </div>
                    <div class="player-info">
                        <div class="player-info-item">
                            <span class="player-info-label">群昵称</span>
                            <span class="player-info-value">${player.group_nickname}</span>
                        </div>
                        <div class="player-info-item">
                            <span class="player-info-label">天梯分数</span>
                            <span class="player-info-value score-value ${this.getScoreClass(player.score)}">${player.score}</span>
                        </div>
                        <div class="player-info-item">
                            <span class="player-info-label">胜率</span>
                            <span class="player-info-value">${player.win_rate}%</span>
                        </div>
                        <div class="player-info-item">
                            <span class="player-info-label">冠军</span>
                            <span class="player-info-value">${player.championships}</span>
                        </div>
                    </div>
                    <div class="position-tags">
                        ${player.positions.map(pos => `<span class="position-tag">${pos}</span>`).join('')}
                    </div>
                    <div class="heroes-list">
                        ${player.heroes.map(hero => `<span class="hero-tag">${hero}</span>`).join('')}
                    </div>
                    ${synergyHtml}
                </div>
            `;
        }
    }

    createTeamCard(team) {
        const teamScore = this.calculateTeamScore(team.players);
        const hasSynergy = this.hasSynergy(team);
        const synergyIndicator = hasSynergy ? '<span class="synergy-indicator">羁绊</span>' : '';
        const isFull = team.players.length >= 5;
        
        return `
            <div class="team-card ${isFull ? 'full-team' : ''}" data-team-id="${team.id}">
                <div class="team-header">
                    <div class="team-info">
                        <h3>${team.name} (ID: ${team.id})</h3>
                        <div class="team-stats">
                            总天梯分数: <span class="team-score">${teamScore}</span>
                            ${synergyIndicator}
                            <span class="team-player-count">${team.players.length}/5人</span>
                        </div>
                    </div>
                    <div class="team-actions">
                        ${this.teams.length > 1 ? `<button class="remove-team-btn" onclick="teamSystem.removeTeam(${team.id})">删除队伍</button>` : ''}
                    </div>
                </div>
                <div class="team-players">
                    ${team.players.map(player => {
                        const playerWithTeamId = { ...player, teamId: team.id };
                        return this.createPlayerCard(playerWithTeamId, false, true); // 使用简化模式
                    }).join('')}
                    ${team.players.length === 0 ? '<div class="empty-state">暂无选手</div>' : ''}
                </div>
                ${!isFull ? `<button class="add-player-btn" onclick="teamSystem.addPlayerToTeam(${team.id})">
                    + 添加选手
                </button>` : '<div class="team-full-indicator">队伍已满</div>'}
            </div>
        `;
    }

    setupDragAndDrop() {
        // 设置选手卡片拖拽
        document.querySelectorAll('.player-card[draggable="true"]').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                this.draggedPlayer = parseInt(e.target.dataset.playerId);
                e.target.classList.add('dragging');
            });
            
            card.addEventListener('dragend', (e) => {
                e.target.classList.remove('dragging');
                this.draggedPlayer = null;
            });
        });
        
        // 设置队伍卡片放置区域
        document.querySelectorAll('.team-card').forEach(card => {
            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                const teamId = parseInt(card.dataset.teamId);
                const team = this.teams.find(t => t.id === teamId);
                
                // 检查队伍是否已满
                if (team && team.players.length >= 5) {
                    card.classList.add('drag-over-full');
                } else {
                    card.classList.add('drag-over');
                }
            });
            
            card.addEventListener('dragleave', () => {
                card.classList.remove('drag-over');
                card.classList.remove('drag-over-full');
            });
            
            card.addEventListener('drop', (e) => {
                e.preventDefault();
                card.classList.remove('drag-over');
                card.classList.remove('drag-over-full');
                
                if (this.draggedPlayer) {
                    const teamId = parseInt(card.dataset.teamId);
                    this.movePlayerToTeam(this.draggedPlayer, teamId);
                }
            });
        });
    }

    movePlayerToTeam(playerId, teamId) {
        const team = this.teams.find(t => t.id === teamId);
        if (team) {
            // 检查队伍是否已满
            if (team.players.length >= 5) {
                alert('该队伍已满员（5人），无法添加更多选手！');
                return;
            }
            
            const playerIndex = this.unassignedPlayers.findIndex(p => p.id === playerId);
            if (playerIndex !== -1) {
                const player = this.unassignedPlayers[playerIndex];
                team.players.push(player);
                this.unassignedPlayers.splice(playerIndex, 1);
                this.render();
            }
        }
    }

    render() {
        // 渲染队伍
        const teamsContainer = document.getElementById('teamsContainer');
        teamsContainer.innerHTML = this.teams.map(team => this.createTeamCard(team)).join('');
        
        // 渲染未分配选手
        this.filterPlayers();
        
        // 更新统计卡片
        this.updateStatsCards();
    }

    resetAssignment() {
        if (confirm('确定要重置所有分配吗？')) {
            this.teams.forEach(team => {
                this.unassignedPlayers.push(...team.players);
                team.players = [];
            });
            this.render();
            this.updateStatsCards();
        }
    }

    saveConfiguration() {
        const data = {
            teams: this.teams,
            unassignedPlayers: this.unassignedPlayers,
            timestamp: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `team-assignment-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        alert('配置已保存！');
    }

    exportData() {
        this.saveConfiguration();
    }

    importData(event) {
        const file = event.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    // 覆盖内嵌数据
                    this.teams = data.teams || [];
                    this.unassignedPlayers = data.unassignedPlayers || [];
                    
                    if (this.teams.length === 0) {
                        this.addTeam();
                    } else {
                        this.teamIdCounter = Math.max(...this.teams.map(t => t.id)) + 1;
                    }
                    
                    this.render();
                    alert('数据导入成功！内嵌数据已覆盖。');
                } catch (error) {
                    alert('导入失败：文件格式错误');
                }
            };
            reader.readAsText(file);
        }
    }

    // 新增选手相关方法
    showNewPlayerModal() {
        const modal = document.getElementById('newPlayerModal');
        modal.classList.add('active');
        this.resetNewPlayerForm();
    }

    closeNewPlayerModal() {
        const modal = document.getElementById('newPlayerModal');
        modal.classList.remove('active');
        
        // 只在非编辑模式下重置数据
        if (!this.editingPlayerId) {
            this.selectedHeroes = [];
            this.selectedSynergyPlayers = [];
        }
    }

    resetNewPlayerForm() {
        document.getElementById('newPlayerForm').reset();
        document.getElementById('selectedHeroes').innerHTML = '';
        document.getElementById('selectedSynergy').innerHTML = '';
        document.getElementById('scorePreview').textContent = '';
        
        // 只在非编辑模式下重置数据
        if (!this.editingPlayerId) {
            this.selectedHeroes = [];
            this.selectedSynergyPlayers = [];
        }
    }

    updateScorePreview(score) {
        // 移除分数等级预览功能，保留方法以避免错误
        const preview = document.getElementById('scorePreview');
        preview.textContent = '';
    }

    handleNewPlayerSubmit(event) {
        event.preventDefault();
        
        // 如果在编辑模式，不应该执行新增选手逻辑
        if (this.isEditing || this.editingPlayerId) {
            console.log('编辑模式下，阻止新增选手逻辑');
            return;
        }
        
        const formData = new FormData(event.target);
        const positions = Array.from(document.querySelectorAll('input[name="positions"]:checked'))
            .map(cb => cb.value);
        
        if (positions.length === 0) {
            alert('请至少选择一个擅长位置！');
            return;
        }
        
        if (this.selectedHeroes.length === 0) {
            alert('请至少选择一个擅长英雄！');
            return;
        }
        
        const newPlayer = {
            id: Date.now(),
            nickname: document.getElementById('newPlayerNickname').value,
            game_id: document.getElementById('newPlayerGameId').value,
            group_nickname: document.getElementById('newPlayerGroupNickname').value || document.getElementById('newPlayerNickname').value,
            score: parseInt(document.getElementById('newPlayerScore').value),
            positions: positions,
            heroes: [...this.selectedHeroes],
            win_rate: parseInt(document.getElementById('newPlayerWinRate').value) || 50,
            championships: parseInt(document.getElementById('newPlayerChampionships').value) || 0,
            synergy_players: this.selectedSynergyPlayers.map(p => p.nickname),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        // 更新现有选手的默契关系
        this.selectedSynergyPlayers.forEach(synergyPlayer => {
            const existingPlayer = this.findPlayerById(synergyPlayer.id);
            if (existingPlayer) {
                if (!existingPlayer.synergy_players) {
                    existingPlayer.synergy_players = [];
                }
                if (!existingPlayer.synergy_players.includes(newPlayer.nickname)) {
                    existingPlayer.synergy_players.push(newPlayer.nickname);
                }
            }
        });
        
        this.unassignedPlayers.push(newPlayer);
        this.closeNewPlayerModal();
        this.render();
        this.updateStatsCards();
        alert('选手创建成功！');
    }

    findPlayerById(playerId) {
        // 在未分配选手中查找
        let player = this.unassignedPlayers.find(p => p.id === playerId);
        if (player) return player;
        
        // 在所有队伍中查找
        for (let team of this.teams) {
            player = team.players.find(p => p.id === playerId);
            if (player) return player;
        }
        
        return null;
    }

    // 英雄选择相关方法
    showHeroesModal() {
        const modal = document.getElementById('heroesSelectModal');
        modal.classList.add('active');
        this.renderHeroesList();
    }

    closeHeroesModal() {
        const modal = document.getElementById('heroesSelectModal');
        modal.classList.remove('active');
    }

    renderHeroesList(searchTerm = '') {
        const container = document.getElementById('heroesList');
        let heroes = [...this.heroesList];
        
        if (searchTerm) {
            heroes = heroes.filter(hero => 
                hero.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                hero.nickname.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }
        
        container.innerHTML = heroes.map(hero => {
            const isSelected = this.selectedHeroes.includes(hero.name);
            return `
                <div class="hero-item ${isSelected ? 'selected' : ''}" onclick="teamSystem.toggleHeroSelection('${hero.name}')">
                    <div class="hero-name">${hero.name}</div>
                    <div class="hero-nickname">${hero.nickname}</div>
                </div>
            `;
        }).join('');
    }

    filterHeroes(searchTerm) {
        this.renderHeroesList(searchTerm);
    }

    toggleHeroSelection(heroName) {
        const index = this.selectedHeroes.indexOf(heroName);
        if (index > -1) {
            this.selectedHeroes.splice(index, 1);
        } else {
            if (this.selectedHeroes.length < 10) { // 限制最多选择10个英雄
                this.selectedHeroes.push(heroName);
            } else {
                alert('最多只能选择10个英雄！');
                return;
            }
        }
        this.renderHeroesList(document.getElementById('heroesSearchInput').value);
        this.updateSelectedHeroesDisplay();
    }

    updateSelectedHeroesDisplay() {
        const container = document.getElementById('selectedHeroes');
        container.innerHTML = this.selectedHeroes.map(hero => `
            <div class="selected-hero-tag">
                ${hero}
                <span class="remove-tag" onclick="teamSystem.removeSelectedHero('${hero}')">&times;</span>
            </div>
        `).join('');
    }

    removeSelectedHero(heroName) {
        const index = this.selectedHeroes.indexOf(heroName);
        if (index > -1) {
            this.selectedHeroes.splice(index, 1);
        }
        this.renderHeroesList(document.getElementById('heroesSearchInput').value);
        this.updateSelectedHeroesDisplay();
    }

    confirmHeroesSelect() {
        this.updateSelectedHeroesDisplay();
        this.closeHeroesModal();
    }

    // 默契选手选择相关方法
    showSynergyModal() {
        const modal = document.getElementById('synergySelectModal');
        modal.classList.add('active');
        this.tempSelectedSynergy = [...this.selectedSynergyPlayers];
        this.renderSynergyPlayersList();
    }

    closeSynergyModal() {
        const modal = document.getElementById('synergySelectModal');
        modal.classList.remove('active');
        this.tempSelectedSynergy = [];
    }

    renderSynergyPlayersList(searchTerm = '') {
        const container = document.getElementById('synergyPlayersList');
        const allPlayers = [...this.unassignedPlayers, ...this.teams.flatMap(t => t.players)];
        
        let players = allPlayers.filter(player => 
            player.id !== this.getCurrentNewPlayerId() // 排除当前新增的选手
        );
        
        if (searchTerm) {
            // 直接匹配的选手
            const directMatches = players.filter(player => 
                player.nickname.toLowerCase().includes(searchTerm.toLowerCase())
            );
            
            // 有默契关系的选手
            const synergyMatches = players.filter(player => 
                !directMatches.includes(player) &&
                player.synergy_players && 
                player.synergy_players.some(sp => 
                    sp.toLowerCase().includes(searchTerm.toLowerCase())
                )
            );
            
            players = [...directMatches, ...synergyMatches];
        }
        
        container.innerHTML = players.map(player => {
            const isSelected = this.tempSelectedSynergy.some(p => p.id === player.id);
            const isSynergyMatch = searchTerm && 
                !player.nickname.toLowerCase().includes(searchTerm.toLowerCase()) &&
                player.synergy_players && 
                player.synergy_players.some(sp => 
                    sp.toLowerCase().includes(searchTerm.toLowerCase())
                );
            
            return `
                <div class="synergy-player-item ${isSelected ? 'selected' : ''}" onclick="teamSystem.toggleSynergySelection(${player.id})">
                    <div class="player-header">
                        <span class="player-name">${player.nickname}</span>
                        <span class="player-game-id">${player.game_id}</span>
                        ${isSynergyMatch ? '<span class="synergy-indicator">默契匹配</span>' : ''}
                    </div>
                    <div class="player-info">
                        <div class="player-info-item">
                            <span class="player-info-label">群昵称</span>
                            <span class="player-info-value">${player.group_nickname}</span>
                        </div>
                        <div class="player-info-item">
                            <span class="player-info-label">天梯分数</span>
                            <span class="player-info-value score-value ${this.getScoreClass(player.score)}">${player.score}</span>
                        </div>
                        <div class="player-info-item">
                            <span class="player-info-label">擅长位置</span>
                            <span class="player-info-value">${player.positions.join(', ')}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    filterSynergyPlayers(searchTerm) {
        this.renderSynergyPlayersList(searchTerm);
    }

    getCurrentNewPlayerId() {
        // 返回一个临时ID用于排除当前新增的选手
        return -1;
    }

    toggleSynergySelection(playerId) {
        const allPlayers = [...this.unassignedPlayers, ...this.teams.flatMap(t => t.players)];
        const player = allPlayers.find(p => p.id === playerId);
        
        if (!player) return;
        
        const index = this.tempSelectedSynergy.findIndex(p => p.id === playerId);
        if (index > -1) {
            this.tempSelectedSynergy.splice(index, 1);
        } else {
            if (this.tempSelectedSynergy.length < 5) { // 限制最多选择5个默契选手
                this.tempSelectedSynergy.push({ id: player.id, nickname: player.nickname });
            } else {
                alert('最多只能选择5个默契选手！');
                return;
            }
        }
        this.renderSynergyPlayersList(document.getElementById('synergySearchInput').value);
    }

    confirmSynergySelect() {
        this.selectedSynergyPlayers = [...this.tempSelectedSynergy];
        this.updateSelectedSynergyDisplay();
        this.closeSynergyModal();
    }

    updateSelectedSynergyDisplay() {
        const container = document.getElementById('selectedSynergy');
        container.innerHTML = this.selectedSynergyPlayers.map(player => `
            <div class="selected-synergy-tag">
                ${player.nickname}
                <span class="remove-tag" onclick="teamSystem.removeSelectedSynergy(${player.id})">&times;</span>
            </div>
        `).join('');
    }

    removeSelectedSynergy(playerId) {
        const index = this.selectedSynergyPlayers.findIndex(p => p.id === playerId);
        if (index > -1) {
            this.selectedSynergyPlayers.splice(index, 1);
        }
        this.updateSelectedSynergyDisplay();
    }

    // 新增选手操作功能
    editPlayer(playerId) {
        const player = this.unassignedPlayers.find(p => p.id === playerId);
        if (!player) return;
        
        // 填充表单数据
        document.getElementById('newPlayerNickname').value = player.nickname;
        document.getElementById('newPlayerGameId').value = player.game_id;
        document.getElementById('newPlayerGroupNickname').value = player.group_nickname;
        document.getElementById('newPlayerScore').value = player.score;
        document.getElementById('newPlayerWinRate').value = player.win_rate;
        document.getElementById('newPlayerChampionships').value = player.championships;
        
        // 设置位置选择
        document.querySelectorAll('input[name="positions"]').forEach(checkbox => {
            checkbox.checked = player.positions.includes(checkbox.value);
        });
        
        // 设置英雄选择
        this.selectedHeroes = [...player.heroes];
        this.updateSelectedHeroesDisplay();
        
        // 设置默契选手
        if (player.synergy_players && player.synergy_players.length > 0) {
            this.selectedSynergyPlayers = player.synergy_players.map(nickname => {
                const allPlayers = [...this.unassignedPlayers, ...this.teams.flatMap(t => t.players)];
                const foundPlayer = allPlayers.find(p => p.nickname === nickname);
                return foundPlayer ? { id: foundPlayer.id, nickname: foundPlayer.nickname } : null;
            }).filter(p => p !== null);
            this.updateSelectedSynergyDisplay();
        }
        
        // 显示编辑对话框
        this.showEditPlayerModal(playerId);
    }

    deletePlayer(playerId) {
        const player = this.unassignedPlayers.find(p => p.id === playerId);
        if (!player) return;
        
        if (confirm(`确定要删除选手"${player.nickname}"吗？此操作不可撤销。`)) {
            const index = this.unassignedPlayers.findIndex(p => p.id === playerId);
            if (index > -1) {
                // 移除与其他选手的默契关系
                this.removeSynergyRelations(player.nickname);
                
                this.unassignedPlayers.splice(index, 1);
                this.render();
                alert('选手删除成功！');
            }
        }
    }

    copyPlayerGameId(playerId) {
        const player = this.unassignedPlayers.find(p => p.id === playerId);
        if (!player) return;
        
        // 复制到剪贴板
        navigator.clipboard.writeText(player.game_id).then(() => {
            // 显示复制成功提示
            this.showToast(`已复制 ${player.nickname} 的游戏ID: ${player.game_id}`);
        }).catch(err => {
            // 降级方案：使用传统方法
            const textArea = document.createElement('textarea');
            textArea.value = player.game_id;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.showToast(`已复制 ${player.nickname} 的游戏ID: ${player.game_id}`);
        });
    }

    showEditPlayerModal(playerId) {
        const modal = document.getElementById('newPlayerModal');
        modal.classList.add('active');
        
        // 修改表单标题和按钮
        const modalTitle = modal.querySelector('.modal-header h3');
        const submitBtn = modal.querySelector('.new-player-form button[type="submit"]');
        modalTitle.textContent = '编辑选手';
        submitBtn.textContent = '保存修改';
        
        // 设置编辑模式
        this.editingPlayerId = playerId;
        this.isEditing = true;
        
        // 修改表单提交事件
        const form = document.getElementById('newPlayerForm');
        form.removeEventListener('submit', this.handleNewPlayerSubmit.bind(this));
        form.addEventListener('submit', this.handleEditPlayerSubmit.bind(this));
    }

    handleEditPlayerSubmit(event) {
        event.preventDefault();
        
        const playerIndex = this.unassignedPlayers.findIndex(p => p.id === this.editingPlayerId);
        if (playerIndex === -1) return;
        
        const formData = new FormData(event.target);
        const positions = Array.from(document.querySelectorAll('input[name="positions"]:checked'))
            .map(cb => cb.value);
        
        if (positions.length === 0) {
            alert('请至少选择一个擅长位置！');
            return;
        }
        
        if (this.selectedHeroes.length === 0) {
            alert('请至少选择一个擅长英雄！');
            return;
        }
        
        // 更新选手信息
        const originalPlayer = this.unassignedPlayers[playerIndex];
        const updatedPlayer = {
            id: originalPlayer.id,  // 确保ID保持不变
            created_at: originalPlayer.created_at,  // 保持创建时间
            nickname: document.getElementById('newPlayerNickname').value,
            game_id: document.getElementById('newPlayerGameId').value,
            group_nickname: document.getElementById('newPlayerGroupNickname').value || document.getElementById('newPlayerNickname').value,
            score: parseInt(document.getElementById('newPlayerScore').value),
            positions: positions,
            heroes: [...this.selectedHeroes],
            win_rate: parseInt(document.getElementById('newPlayerWinRate').value) || 50,
            championships: parseInt(document.getElementById('newPlayerChampionships').value) || 0,
            synergy_players: this.selectedSynergyPlayers.map(p => p.nickname),
            updated_at: new Date().toISOString()
        };
        
        // 更新默契关系
        this.updateSynergyRelations(this.unassignedPlayers[playerIndex].nickname, updatedPlayer.nickname, updatedPlayer.synergy_players);
        
        this.unassignedPlayers[playerIndex] = updatedPlayer;
        
        // 重置编辑状态
        this.editingPlayerId = null;
        
        // 恢复表单状态
        const modalTitle = document.querySelector('#newPlayerModal .modal-header h3');
        const submitBtn = document.querySelector('.new-player-form button[type="submit"]');
        modalTitle.textContent = '新增选手';
        submitBtn.textContent = '创建选手';
        
        // 恢复表单提交事件
        const form = document.getElementById('newPlayerForm');
        form.removeEventListener('submit', this.handleEditPlayerSubmit.bind(this));
        form.addEventListener('submit', this.handleNewPlayerSubmit.bind(this));
        
        // 重置编辑状态标志
        this.isEditing = false;
        
        this.closeNewPlayerModal();
        this.render();
        alert('选手信息修改成功！');
    }

    updateStatsCards() {
        // 计算总选手数
        const allPlayers = [...this.unassignedPlayers, ...this.teams.flatMap(t => t.players)];
        const totalPlayersCount = allPlayers.length;
        
        // 更新统计显示
        this.updateStatCard('totalPlayersCount', totalPlayersCount);
        this.updateStatCard('unassignedPlayersCount', this.unassignedPlayers.length);
        this.updateStatCard('teamsCount', this.teams.length);
    }

    updateStatCard(statId, value) {
        const element = document.getElementById(statId);
        if (element) {
            element.textContent = value;
            // 添加数字动画效果
            element.style.animation = 'none';
            element.offsetHeight; // 触发重排
            element.style.animation = 'countUp 0.6s ease-out';
        }
    }

    removeSynergyRelations(playerNickname) {
        // 移除其他选手中对该选手的默契关系
        const allPlayers = [...this.unassignedPlayers, ...this.teams.flatMap(t => t.players)];
        allPlayers.forEach(player => {
            if (player.synergy_players) {
                const index = player.synergy_players.indexOf(playerNickname);
                if (index > -1) {
                    player.synergy_players.splice(index, 1);
                }
            }
        });
    }

    updateSynergyRelations(oldNickname, newNickname, newSynergyPlayers) {
        const allPlayers = [...this.unassignedPlayers, ...this.teams.flatMap(t => t.players)];
        
        // 更新其他选手中对这个选手的默契关系（昵称更改）
        allPlayers.forEach(player => {
            if (player.synergy_players) {
                const index = player.synergy_players.indexOf(oldNickname);
                if (index > -1) {
                    player.synergy_players[index] = newNickname;
                }
            }
        });
        
        // 为新的默契选手添加关系
        newSynergyPlayers.forEach(synergyNickname => {
            const synergyPlayer = allPlayers.find(p => p.nickname === synergyNickname);
            if (synergyPlayer) {
                if (!synergyPlayer.synergy_players) {
                    synergyPlayer.synergy_players = [];
                }
                if (!synergyPlayer.synergy_players.includes(newNickname)) {
                    synergyPlayer.synergy_players.push(newNickname);
                }
            }
        });
    }

    showToast(message) {
        // 创建临时提示元素
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(46, 204, 113, 0.9);
            color: white;
            padding: 12px 20px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            font-size: 14px;
            backdrop-filter: blur(4px);
            animation: slideInRight 0.3s ease;
        `;
        toast.textContent = message;
        
        // 添加动画样式
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(toast);
        
        // 3秒后自动移除
        setTimeout(() => {
            toast.style.animation = 'slideInRight 0.3s ease reverse';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }
}

// 初始化系统
let teamSystem;
document.addEventListener('DOMContentLoaded', () => {
    teamSystem = new TeamAssignmentSystem();
});
