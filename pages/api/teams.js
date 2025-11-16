// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

export default function handler(req, res) {
  if (req.method === 'GET') {
    // 返回默认队伍数据
    const teams = [
      {
        id: 1,
        name: '队伍1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        players: []
      }
    ];
    
    res.status(200).json({ teams });
  } else if (req.method === 'POST') {
    // 创建新队伍
    const { name } = req.body;
    const newTeam = {
      id: Date.now(), // 简单的ID生成方式
      name: name || `队伍${Date.now()}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      players: []
    };
    
    res.status(201).json({ team: newTeam });
  } else {
    res.status(405).json({ message: 'Method not allowed' });
  }
}