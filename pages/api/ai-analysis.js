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

  return `你是一个Dota2比赛队伍分析专家，拥有职业战队教练级别的分析能力。请分析以下选手，给出精准、犀利的评价。

【选手信息】
昵称: ${player.nickname}
天梯分: ${score} (${tier})
自报位置: ${positions}
自报擅长英雄: ${selfHeroes}
自报胜率: ${winRate}%
冠军数: ${championships}个
默契队友: ${synergyNames}
${statsText}

请从以下维度深度分析（中文，每条2-3句话）：

1. 🎯 **定位与实力评估**：结合天梯分、近期GPM/KDA/伤害数据，判断真实水平是否匹配分数段位，最适合打几号位，能否胜任更高强度比赛
2. 🦸 **英雄池深度**：对比自报擅长英雄 vs 实际常用/高胜率英雄的一致性，判断英雄池是广是窄。根据「全期英雄数据」判断是否存在绝活英雄（绝活定义：累计使用次数>100场 且 胜率>51%），如有绝活英雄请明确指出。近期使用的英雄是否多样化
3. 📈 **近期状态分析**：从近20场数据看状态趋势——是上升期还是低谷，GPM和伤害数据是否匹配其位置要求，KD是否健康
4. ⚠️ **核心短板**：一针见血指出最大问题（如英雄池窄、GPM偏低、KDA不佳、某个位置表现差、英雄选择与版本脱节等）
5. 🎯 **提升路径**：给出1条可立即执行的改进建议（具体到英雄选择、出装思路、或打法调整）
6. 📊 **综合评价**：一句话给队长参考——这个选手适合当什么角色，在BP中应该围绕他还是补充他

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

  return `你是一个Dota2比赛队伍分析专家。请分析以下队伍的完整信息。

【队伍信息】
- 队伍名: ${team.name}
- 人数: ${playersData.length}/5

【队员详情】
${playersText}

【队伍数据】
- 总分: ${totalScore} | 平均分: ${avgScore} | 最高: ${maxScore} | 最低: ${minScore} | 分差: ${maxScore - minScore}
- 位置分布: ${Object.entries(positionCount).map(([p, c]) => `${p}(${c}人)`).join(', ') || '无数据'}
- 英雄重叠(多人会): ${overlappingHeroes.join(', ') || '无重叠'}

请从以下维度分析（用中文，每条1-2句话，总共不超过300字）：

1. 🎯 **阵容完整度**：5个位置覆盖情况，是否有位置重叠或空缺，建议如何调整
2. ⚖️ **分数平衡性**：队伍分差是否合理，高分选手能否带动低分选手，是否存在"短板"
3. 🦸 **英雄池评估**：全队英雄池的广度和重叠情况，重叠是优势(可摇摆)还是劣势(池子窄)
4. 🎮 **BP与战术建议**：基于队伍英雄池，推荐1-2个适合的首选英雄或体系，建议ban掉什么类型
5. ⚠️ **关键风险**：指出队伍最大隐患（如某位置无人、英雄池严重重叠、分差过大等）
6. 📊 **综合评价**：一句话评价这支队伍的实力和前景

请直接输出分析内容，不要开头语和结尾语。`;
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
      system: '你是一个专业的Dota2比赛数据分析师，拥有职业战队教练级别的分析能力。你的分析精准、犀利、有数据支撑。使用中文输出，使用emoji作为维度标记。',
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
