// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
const heroIdToName = require('../../lib/heroMapping');

// 内存缓存：playerId -> { stats, timestamp }
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟

// 带超时的 fetch
async function fetchWithTimeout(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      throw new Error('请求超时');
    }
    throw error;
  }
}

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        const { playerId } = req.query;

        if (!playerId) {
          return res.status(400).json({ error: '缺少playerId参数' });
        }

        // 检查缓存
        const cached = cache.get(playerId);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          return res.status(200).json({ stats: cached.stats, cached: true });
        }

        // 获取最近的比赛数据
        const recentMatchesResponse = await fetchWithTimeout(
          `https://api.opendota.com/api/players/${playerId}/recentMatches`,
          8000
        );
        if (!recentMatchesResponse.ok) {
          throw new Error(`获取最近比赛失败: ${recentMatchesResponse.status}`);
        }
        const recentMatches = await recentMatchesResponse.json();

        // 获取英雄统计数据
        const heroesResponse = await fetchWithTimeout(
          `https://api.opendota.com/api/players/${playerId}/heroes`,
          8000
        );
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
        const mostPlayedHeroes = sortedHeroesByGames.slice(0, 5).map(hero => ({
          name: heroIdToName[hero.hero_id] || `英雄${hero.hero_id}`,
          matches: hero.games,
          winRate: hero.games > 0 ? Math.round((hero.win / hero.games) * 100) : 0
        }));

        // 获取胜率最高的英雄（至少有50场比赛）
        const heroesWithMinGames = heroesData.filter(hero => hero.games >= 50);
        const sortedHeroesByWinRate = [...heroesWithMinGames].sort((a, b) => {
          const winRateA = a.games > 0 ? (a.win / a.games) : 0;
          const winRateB = b.games > 0 ? (b.win / b.games) : 0;
          return winRateB - winRateA;
        });
        const highestWinRateHeroes = sortedHeroesByWinRate.slice(0, 5).map(hero => ({
          name: heroIdToName[hero.hero_id] || `英雄${hero.hero_id}`,
          matches: hero.games,
          winRate: hero.games > 0 ? Math.round((hero.win / hero.games) * 100) : 0
        }));

        const stats = {
          recentWinRate,
          mostPlayedHeroes,
          highestWinRateHeroes
        };

        // 写入缓存
        cache.set(playerId, { stats, timestamp: Date.now() });

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
