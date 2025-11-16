// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

export default function handler(req, res) {
  if (req.method === 'GET') {
    // 返回默认选手数据
    const players = [
      {
        id: 1,
        nickname: '暗夜猎手',
        game_id: 'NightHunter',
        group_nickname: '猎手',
        score: 15000,
        positions: ['优势路'],
        heroes: [],
        win_rate: 60,
        championships: 2,
        synergy_players: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 2,
        nickname: '烈焰战士',
        game_id: 'FlameWarrior',
        group_nickname: '火男',
        score: 12000,
        positions: ['中单'],
        heroes: [],
        win_rate: 55,
        championships: 1,
        synergy_players: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];
    
    res.status(200).json({ players });
  } else if (req.method === 'POST') {
    // 创建新选手
    const playerData = req.body;
    const newPlayer = {
      id: Date.now(),
      ...playerData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    res.status(201).json({ player: newPlayer });
  } else {
    res.status(405).json({ message: 'Method not allowed' });
  }
}