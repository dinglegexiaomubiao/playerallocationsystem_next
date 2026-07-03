import heroIdToName from '../../lib/heroMapping';

const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

async function fetchWithTimeout(url, timeout = 10000) {
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
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { playerId } = req.query;
    if (!playerId) {
      return res.status(400).json({ error: '缺少playerId参数' });
    }

    // Check cache
    const cached = cache.get(playerId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return res.status(200).json({ stats: cached.stats, cached: true });
    }

    // 1. Fetch recent matches (last 20)
    const recentMatchesResponse = await fetchWithTimeout(
      `https://api.opendota.com/api/players/${playerId}/recentMatches`,
      10000
    );
    if (!recentMatchesResponse.ok) {
      throw new Error(`获取最近比赛失败: ${recentMatchesResponse.status}`);
    }
    const recentMatches = await recentMatchesResponse.json();

    // 2. Fetch hero stats (all time)
    const heroesResponse = await fetchWithTimeout(
      `https://api.opendota.com/api/players/${playerId}/heroes`,
      10000
    );
    if (!heroesResponse.ok) {
      throw new Error(`获取英雄统计失败: ${heroesResponse.status}`);
    }
    const heroesData = await heroesResponse.json();

    // 3. Fetch player totals (for overall win/loss, GPM, KDA averages)
    const totalsResponse = await fetchWithTimeout(
      `https://api.opendota.com/api/players/${playerId}/totals`,
      10000
    );
    let totalsData = null;
    if (totalsResponse.ok) {
      totalsData = await totalsResponse.json();
    }

    // --- Process recent matches ---
    const recentMatchesDetail = [];
    let recentWins = 0;
    let recentTotal = 0;
    let totalGpm = 0;
    let totalKills = 0;
    let totalDeaths = 0;
    let totalAssists = 0;
    let totalHeroDamage = 0;

    for (let i = 0; i < Math.min(recentMatches.length, 20); i++) {
      const m = recentMatches[i];
      if (typeof m.radiant_win !== 'boolean') continue;

      const isRadiant = m.player_slot < 128;
      const isWin = m.radiant_win === isRadiant;
      recentTotal++;
      if (isWin) recentWins++;

      const gpm = m.gold_per_min || 0;
      const kills = m.kills || 0;
      const deaths = m.deaths || 0;
      const assists = m.assists || 0;
      const heroDamage = m.hero_damage || 0;

      totalGpm += gpm;
      totalKills += kills;
      totalDeaths += deaths;
      totalAssists += assists;
      totalHeroDamage += heroDamage;

      recentMatchesDetail.push({
        hero: heroIdToName[m.hero_id] || `英雄${m.hero_id}`,
        isWin,
        lobbyType: m.lobby_type === 7 ? '天梯' : '匹配',
        gpm,
        kills,
        deaths,
        assists,
        kda: deaths > 0 ? ((kills + assists) / deaths).toFixed(1) : (kills + assists),
        heroDamage,
        duration: m.duration ? Math.floor(m.duration / 60) + 'min' : 'N/A',
      });
    }

    const recentWinRate = recentTotal > 0 ? Math.round((recentWins / recentTotal) * 100) : 0;
    const avgGpm = recentTotal > 0 ? Math.round(totalGpm / recentTotal) : 0;
    const avgKills = recentTotal > 0 ? (totalKills / recentTotal).toFixed(1) : 0;
    const avgDeaths = recentTotal > 0 ? (totalDeaths / recentTotal).toFixed(1) : 0;
    const avgAssists = recentTotal > 0 ? (totalAssists / recentTotal).toFixed(1) : 0;
    const avgKda = recentTotal > 0 && totalDeaths > 0
      ? ((totalKills + totalAssists) / totalDeaths).toFixed(1)
      : (totalKills + totalAssists).toFixed(1);
    const avgHeroDamage = recentTotal > 0 ? Math.round(totalHeroDamage / recentTotal) : 0;

    // --- Most played heroes (all time) ---
    const sortedHeroesByGames = [...heroesData].sort((a, b) => (b.games || 0) - (a.games || 0));
    const mostPlayedHeroes = sortedHeroesByGames.slice(0, 5).map(hero => ({
      name: heroIdToName[hero.hero_id] || `英雄${hero.hero_id}`,
      matches: hero.games,
      winRate: hero.games > 0 ? Math.round((hero.win / hero.games) * 100) : 0,
    }));

    // --- Highest win rate heroes (min 10 games) ---
    const heroesWithMinGames = heroesData.filter(hero => hero.games >= 10);
    const sortedHeroesByWinRate = [...heroesWithMinGames].sort((a, b) => {
      const wrA = a.games > 0 ? (a.win / a.games) : 0;
      const wrB = b.games > 0 ? (b.win / b.games) : 0;
      return wrB - wrA;
    });
    const highestWinRateHeroes = sortedHeroesByWinRate.slice(0, 5).map(hero => ({
      name: heroIdToName[hero.hero_id] || `英雄${hero.hero_id}`,
      matches: hero.games,
      winRate: hero.games > 0 ? Math.round((hero.win / hero.games) * 100) : 0,
    }));

    const stats = {
      recentWinRate,
      recentTotal,
      recentWins,
      avgGpm,
      avgKills,
      avgDeaths,
      avgAssists,
      avgKda,
      avgHeroDamage,
      recentMatches: recentMatchesDetail,
      mostPlayedHeroes,
      highestWinRateHeroes,
    };

    cache.set(playerId, { stats, timestamp: Date.now() });

    return res.status(200).json({ stats });
  } catch (error) {
    console.error('获取玩家统计数据错误:', error);
    return res.status(500).json({ error: '获取玩家统计数据失败: ' + error.message });
  }
}
