// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
const heroIdToName = require('../../lib/heroMapping');
const { query } = require('../../lib/db');

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
        
        // 首先尝试从数据库获取数据
        const dbResult = await query(
          'SELECT recent_win_rate, most_played_heroes, highest_win_rate_heroes, updated_at FROM public.players WHERE game_id = $1',
          [playerId]
        );
        
        // 检查数据库中是否有数据且未过期（3小时内）
        if (dbResult.rows.length > 0 && dbResult.rows[0].updated_at) {
          const lastUpdate = new Date(dbResult.rows[0].updated_at);
          const now = new Date();
          const diffHours = Math.abs(now - lastUpdate) / 36e5; // 小时差
          
          if (diffHours <= 3 && 
              dbResult.rows[0].recent_win_rate !== null && 
              dbResult.rows[0].most_played_heroes !== null && 
              dbResult.rows[0].highest_win_rate_heroes !== null) {
            
            // 数据未过期，直接返回数据库中的数据
            const stats = {
              recentWinRate: dbResult.rows[0].recent_win_rate,
              mostPlayedHeroes: dbResult.rows[0].most_played_heroes,
              highestWinRateHeroes: dbResult.rows[0].highest_win_rate_heroes
            };
            
            return res.status(200).json({ stats });
          }
        }
        
        // 数据不存在或已过期，从API获取数据
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
        
        // 获取胜率最高的英雄（至少有20场比赛）
        const heroesWithMinGames = heroesData.filter(hero => hero.games >= 20);
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
        
        // 将获取到的数据保存到数据库
        try {
          await query(
            `UPDATE public.players 
             SET recent_win_rate = $1, most_played_heroes = $2, highest_win_rate_heroes = $3, updated_at = $4
             WHERE game_id = $5`,
            [recentWinRate, JSON.stringify(mostPlayedHeroes), JSON.stringify(highestWinRateHeroes), new Date().toISOString(), playerId]
          );
        } catch (dbError) {
          console.error('更新数据库玩家统计数据错误:', dbError);
          // 即使数据库更新失败，也不影响API响应
        }
        
        res.status(200).json({ stats });
      } catch (error) {
        console.error('获取玩家统计数据错误:', error);
        res.status(500).json({ error: '获取玩家统计数据失败: ' + error.message });
      }
      break;

    default:
      res.setHeader('Allow', ['GET']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}