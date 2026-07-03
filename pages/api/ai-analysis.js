import Anthropic from '@anthropic-ai/sdk';

// Simple in-memory cache (TTL: 30 minutes)
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

function getCacheKey(type, data) {
  return `${type}_${JSON.stringify(data)}`;
}

function buildPlayerPrompt(player, stats) {
  const score = player.score || 0;
  const tier = score >= 5420 ? '冠绝一世' 
    : score >= 4620 ? '超凡入圣' 
    : score >= 3850 ? '万古流芳'
    : score >= 3080 ? '传奇'
    : score >= 2310 ? '统帅' 
    : score >= 1540 ? '中军'
    : score >= 770 ? '卫士'  
    : '先锋';
  const positions = (player.positions || []).join('、') || '未填写';
  const selfHeroes = (player.heroes || []).join('、') || '未填写';
  const synergyNames = (player.synergy_names || []).join('、') || '未填写';
  const winRate = player.win_rate || 0;
  const championships = player.championships || 0;

  let statsText = '';
  if (stats) {
    const recentMatchesText = (stats.recentMatches || []).map((m, i) =>
      `${i + 1}. ${m.hero} ${m.isWin ? '胜' : '负'} | ${m.lobbyType} | GPM:${m.gpm} | KDA:${m.kda} | 伤害:${m.heroDamage}`
    ).join('\n');

    statsText = `
【近期${stats.recentTotal || 0}场比赛详细数据】
${recentMatchesText || '无数据'}

【近期数据汇总】
- 近${stats.recentTotal || 0}场胜率: ${stats.recentWinRate || 'N/A'}%
- 平均GPM: ${stats.avgGpm || 'N/A'}
- 平均KDA: ${stats.avgKda || 'N/A'} (击杀${stats.avgKills || 'N/A'} / 死亡${stats.avgDeaths || 'N/A'} / 助攻${stats.avgAssists || 'N/A'})
- 平均英雄伤害: ${stats.avgHeroDamage || 'N/A'}

【近期100场英雄统计（天梯/匹配）】
- 场次最多英雄: ${(stats.mostPlayedHeroes || []).map(h => `${h.name}(${h.matches}场/${h.winRate}%胜率)`).join(', ') || '无数据'}
- 胜率最高英雄(≥3场): ${(stats.highestWinRateHeroes || []).map(h => `${h.name}(${h.matches}场/${h.winRate}%胜率)`).join(', ') || '无数据'}

【全期英雄数据（用于判断绝活：累计使用>100场且胜率>51%即为绝活英雄）】
${(stats.heroesLifetime || []).map(h => `${h.name}(${h.matches}场/${h.winRate}%胜率)`).join(', ') || '无数据'}`;
  }

  return `你是一个Dota2比赛数据分析师。请基于数据对以下选手进行分析，侧重观察和推论，不要下结论性判断。内容简洁，每条1-2句话。

【选手信息】
昵称: ${player.nickname}
天梯分: ${score} (${tier})
自报位置: ${positions}
自报擅长英雄: ${selfHeroes}
自报胜率: ${winRate}%
冠军数: ${championships}个
默契队友: ${synergyNames}
${statsText}

请从以下角度分析（中文，每条1-2句话，只做分析不做评判），语气幽默搞怪，不要有太强的攻击性：

1. 🦸 **英雄池与打法特征**：根据近期100场英雄使用分布和胜率，分析该选手的英雄偏好类型（如先手控、刷核、游走等）、常用英雄之间的共性。这条尽量简短一些
2. 🤝 **作为队友如何BP**：该选手的英雄池适合搭配什么类型的英雄或体系，BP时帮他抢什么英雄能最大化其作用
3. 🎯 **作为对手如何针对**：该选手英雄池的薄弱环节在哪，BP时ban掉其核心英雄后他可能拿什么替代，替代英雄的效果预计如何
4. 📊 **数据特征**：近期GPM、KDA、伤害数据反映了怎样的打法风格（偏刷/偏打架/偏推进等），是否与其常用英雄类型吻合


直接输出分析，不要开场白和结束语。`;
}

function buildTeamPrompt(team, playersData) {
  const playersText = playersData.map(({ player, stats }, i) => {
    const score = player.score || 0;
    const tier = score >= 5420 ? '冠绝一世' 
    : score >= 4620 ? '超凡入圣' 
    : score >= 3850 ? '万古流芳'
    : score >= 3080 ? '传奇'
    : score >= 2310 ? '统帅' 
    : score >= 1540 ? '中军'
    : score >= 770 ? '卫士'  
    : '先锋';
    const positions = (player.positions || []).join('/') || '?';
    const heroes = (player.heroes || []).slice(0, 5).join('、') || '无';
    let apiHeroes = '';
    if (stats) {
      apiHeroes = ` | API常用:${(stats.mostPlayedHeroes || []).slice(0, 3).map(h => h.name).join(',')}`;
    }
    return `选手${i + 1}: ${player.nickname} | ${score}分(${tier}) | 位置:${positions} | 英雄:${heroes}${apiHeroes}`;
  }).join('\n');

  const totalScore = playersData.reduce((sum, { player }) => sum + (player.score || 0), 0);
  const avgScore = playersData.length > 0 ? Math.round(totalScore / playersData.length) : 0;
  const scores = playersData.map(({ player }) => player.score || 0);
  const maxScore = Math.max(...scores, 0);
  const minScore = Math.min(...scores, 0);

  // Collect all positions
  const allPositions = playersData.flatMap(({ player }) => player.positions || []);
  const positionCount = {};
  allPositions.forEach(p => { positionCount[p] = (positionCount[p] || 0) + 1; });

  // Collect all heroes
  const allHeroes = playersData.flatMap(({ player }) => player.heroes || []);
  const heroCount = {};
  allHeroes.forEach(h => { heroCount[h] = (heroCount[h] || 0) + 1; });
  const overlappingHeroes = Object.entries(heroCount).filter(([, c]) => c >= 2).map(([h, c]) => `${h}(${c}人)`);

  return `你是一个Dota2比赛数据分析师。请基于数据对以下队伍进行分析，侧重观察和推论，不要下结论性判断。内容简洁，每条1-2句话。

【队伍信息】
- 队伍名: ${team.name}
- 人数: ${playersData.length}/5

【队员详情】
${playersText}

【队伍数据】
- 总分: ${totalScore} | 平均分: ${avgScore} | 最高: ${maxScore} | 最低: ${minScore} | 分差: ${maxScore - minScore}
- 位置分布: ${Object.entries(positionCount).map(([p, c]) => `${p}(${c}人)`).join(', ') || '无数据'}
- 英雄重叠(多人会): ${overlappingHeroes.join(', ') || '无重叠'}

请从以下角度分析（中文，每条1-2句话，只做分析不做评判），语气幽默搞怪，不要有太强的攻击性：

1. 🎯 **阵容完整度**：5个位置覆盖情况，哪些位置存在多人重叠、哪些位置空缺，队员的位置灵活性如何
2. 🦸 **英雄池与体系特征**：全队英雄池的交集和差异，哪些英雄可以摇摆，队伍整体更倾向于什么体系（推进/团战/抓人/带线等）
3. 🎮 **BP与战术建议**：基于队伍英雄池，首轮优先抢什么英雄能最大化体系灵活性，建议ban掉什么类型的英雄来保护己方短板
4. 🎯 **作为对手如何BP**：针对这支队伍，第一轮ban位应该瞄准哪个选手的哪个核心英雄，逼他们被迫拿不擅长的英雄或体系

直接输出分析内容，不要开头语和结尾语。`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI API key not configured' });
  }

  const { type, data } = req.body;

  if (!type || !data) {
    return res.status(400).json({ error: 'Missing type or data' });
  }

  // Check cache
  const cacheKey = getCacheKey(type, data);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.status(200).json({ success: true, analysis: cached.analysis, cached: true });
  }

  try {
    let prompt;
    if (type === 'player') {
      prompt = buildPlayerPrompt(data.player, data.stats);
    } else if (type === 'team') {
      prompt = buildTeamPrompt(data.team, data.playersData);
    } else {
      return res.status(400).json({ error: 'Invalid type. Use "player" or "team".' });
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic',
    });

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: '你是一个专业的Dota2比赛数据分析师。你的分析基于数据、客观、简洁。使用中文输出，使用emoji作为维度标记。',
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'disabled' },
    });

    // Extract text from content blocks (skip non-text blocks like thinking)
    const analysis = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // If no text content found (e.g., all output went to thinking blocks), return error
    if (!analysis || analysis.trim().length === 0) {
      console.error('AI returned no text content. Content blocks:', JSON.stringify(message.content.map(b => ({ type: b.type }))));
      return res.status(500).json({ error: 'AI 返回了空内容，请稍后重试' });
    }

    // Store in cache
    cache.set(cacheKey, { analysis, timestamp: Date.now() });

    return res.status(200).json({ success: true, analysis });
  } catch (error) {
    console.error('AI analysis error:', error);
    return res.status(500).json({ error: 'AI analysis failed', details: error.message });
  }
}
