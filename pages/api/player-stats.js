// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
const heroIdToName = require('../../lib/heroMapping');
const { query } = require('../../lib/db');

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        const { playerId } = req.query;
        
        console.log('接收到的playerId:', playerId); // 添加调试信息
        
        // 检查playerId是否存在
        if (!playerId) {
          return res.status(400).json({ error: '缺少playerId参数' });
        }
        
        // 因为现有players表中没有recent_win_rate等字段来存储Dota统计数据，
        // 所以我们跳过数据库缓存检查，直接从OpenDota API获取最新数据。
        console.log(`开始从OpenDota API获取数据，playerId: ${playerId}`); // 添加调试信息
        console.log(`开始从OpenDota API获取数据，playerId: ${playerId}`); // 添加调试信息
        
        // 获取最近的比赛数据
        const recentMatchesResponse = await fetch(`https://api.opendota.com/api/players/${playerId}/recentMatches`);
        if (!recentMatchesResponse.ok) {
          throw new Error(`获取最近比赛失败: ${recentMatchesResponse.status}`);
        }
        const recentMatches = await recentMatchesResponse.json();
        
        // 获取英雄统计数据
        const heroesResponse = await fetch(`https://api.opendota.com/api/players/${playerId}/heroes`);
        if (!heroesResponse.ok) {
          throw new Error(`获取英雄统计失败: ${heroesResponse.status}`);
        }
        const heroesData = await heroesResponse.json();
        
        // 计算最近胜率
        let wins = 0;
        let total = Math.min(recentMatches.length, 20); // 最近20场比赛
        for (let i = 0; i < total; i++) {
          if (recentMatches[i]?.radiant_win === undefined) continue;
          if (typeof recentMatches[i].radiant_win !== 'boolean') continue;
          
          const isRadiant = recentMatches[i].player_slot < 128;
          const isWin = recentMatches[i].radiant_win === isRadiant;
          if (isWin) wins++;
        }
        const recentWinRate = total > 0 ? Math.round((wins / total) * 100) : 0;
        
        // 获取最常使用的英雄（按场次排序）
        const sortedHeroesByGames = [...heroesData].sort((a, b) => (b.games || 0) - (a.games || 0));
        const mostPlayedHeroes = sortedHeroesByGames.slice(0, 5).map(hero => ({  // 从3改为5
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
        const highestWinRateHeroes = sortedHeroesByWinRate.slice(0, 5).map(hero => ({  // 从3改为5
          name: heroIdToName[hero.hero_id] || `英雄${hero.hero_id}`,
          matches: hero.games,
          winRate: hero.games > 0 ? Math.round((hero.win / hero.games) * 100) : 0
        }));
        
        const stats = {
          recentWinRate,
          mostPlayedHeroes,
          highestWinRateHeroes
        };
        
        console.log('从API获取的数据:', stats); // 添加调试信息
        
        // 目前不更新数据库，因为我们没有在players表中定义
        // recent_win_rate, most_played_heroes, highest_win_rate_heroes等字段。
        // TODO: 将来可以添加这些字段以实现数据库缓存。
        console.log('暂不更新数据库，因为缺少相应的字段'); // 添加调试信息
        
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