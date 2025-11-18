// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
const heroIdToName = require('../../lib/heroMapping');

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        const { playerId } = req.query;
        
        // 检查playerId是否存在
        if (!playerId) {
          return res.status(400).json({ error: '缺少playerId参数' });
        }
        
        // 首先获取玩家基本信息，以获取其Steam ID（存储在game_id字段中）
        const playerResponse = await fetch(`https://api.opendota.com/api/players/${playerId}`);
        if (!playerResponse.ok) {
          // 如果第一次请求失败，尝试将playerId视为Steam ID直接请求
          const directResponse = await fetch(`https://api.opendota.com/api/players/${playerId}`);
          if (!directResponse.ok) {
            throw new Error(`OpenDota API请求失败: ${playerResponse.status}`);
          }
        }
        
        // 使用playerId作为Steam ID获取数据
        const steamId = playerId;
        
        // 获取最近的比赛数据
        const recentMatchesResponse = await fetch(`https://api.opendota.com/api/players/${steamId}/recentMatches`);
        const recentMatches = await recentMatchesResponse.json();
        
        // 获取英雄统计数据
        const heroesResponse = await fetch(`https://api.opendota.com/api/players/${steamId}/heroes`);
        const heroesData = await heroesResponse.json();
        // 计算最近胜率
        let wins = 0;
        let total = Math.min(recentMatches.length, 20); // 最近20场比赛
        for (let i = 0; i < total; i++) {
          if (recentMatches[i].radiant_win === (recentMatches[i].player_slot < 128)) {
            wins++;
          }
        }
        const recentWinRate = total > 0 ? Math.round((wins / total) * 100) : 0;
        
        // 获取最常使用的英雄（按场次排序）
        const sortedHeroesByGames = [...heroesData].sort((a, b) => b.games - a.games);
        const mostPlayedHeroes = sortedHeroesByGames.slice(0, 3).map(hero => ({
          name: heroIdToName[hero.hero_id] || `英雄${hero.hero_id}`,
          matches: hero.games,
          winRate: hero.games > 0 ? Math.round((hero.win / hero.games) * 100) : 0
        }));
        
        // 获取胜率最高的英雄（至少有5场比赛）
        const heroesWithMinGames = heroesData.filter(hero => hero.games >= 5);
        const sortedHeroesByWinRate = [...heroesWithMinGames].sort((a, b) => {
          const winRateA = a.games > 0 ? (a.win / a.games) : 0;
          const winRateB = b.games > 0 ? (b.win / b.games) : 0;
          return winRateB - winRateA;
        });
        const highestWinRateHeroes = sortedHeroesByWinRate.slice(0, 3).map(hero => ({
          name: heroIdToName[hero.hero_id] || `英雄${hero.hero_id}`,
          matches: hero.games,
          winRate: hero.games > 0 ? Math.round((hero.win / hero.games) * 100) : 0
        }));
        
        const stats = {
          recentWinRate,
          mostPlayedHeroes,
          highestWinRateHeroes,
          debug: {
            recentMatches: recentMatches.slice(0, 5), // 只返回前5场比赛用于调试
            heroesData: heroesData.slice(0, 5) // 只返回前5个英雄用于调试
          }
        };
        
        res.status(200).json({ stats });
      } catch (error) {
        console.error('获取玩家统计数据错误:', error);
        // // 返回模拟数据作为备选方案
        // const mockStats = {
        //   recentWinRate: 65,
        //   mostPlayedHeroes: [
        //     { name: heroIdToName[11] || "影魔", matches: 42, winRate: 71 },
        //     { name: heroIdToName[12] || "幻影刺客", matches: 38, winRate: 68 },
        //     { name: heroIdToName[9] || "冥界亚龙", matches: 31, winRate: 58 }
        //   ],
        //   highestWinRateHeroes: [
        //     { name: heroIdToName[8] || "狙击手", matches: 12, winRate: 92 },
        //     { name: heroIdToName[20] || "剧毒术士", matches: 25, winRate: 88 },
        //     { name: heroIdToName[17] || "风暴之灵", matches: 18, winRate: 83 }
        //   ]
        // };
        res.status(200).json({ stats: mockStats });
      }
      break;

    default:
      res.setHeader('Allow', ['GET']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}