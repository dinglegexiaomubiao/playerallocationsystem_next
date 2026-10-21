import heroIdToName from '../../lib/heroMapping';
import { fetchJson } from '../../lib/http-json';
import { modeKeyOf, modeLabelOf, rankLabelOf, kdaOf, patchForTime } from '../../lib/match-format.mjs';

/**
 * 群友的最近对局（公开比赛数据，来自 OpenDota）。
 *
 * 为什么不读本地库：本地 `dota_matches` 只存「群内赛事」的对局，
 * 而这里要的是天梯/普通/加速/技能征召的日常战绩，OpenDota 才有的。
 *
 * 一次拉 200 场原始数据 + 版本表，模式/版本筛选放在前端做——
 * 这样切 tab 不用再打网络，体验接近截图里的小黑盒。
 */

const MATCH_CACHE_TTL = 20 * 60 * 1000; // 对局 20 分钟
const PATCH_CACHE_TTL = 24 * 60 * 60 * 1000; // 版本表 1 天
const MATCH_LIMIT = 200;

const matchCache = new Map(); // accountId -> { data, ts }
let patchCache = { list: null, ts: 0 };

async function loadPatches() {
  if (patchCache.list && Date.now() - patchCache.ts < PATCH_CACHE_TTL) return patchCache.list;
  const raw = await fetchJson('https://api.opendota.com/api/constants/patch', { timeoutMs: 12000 });
  const list = (Array.isArray(raw) ? raw : [])
    .map((p) => ({ id: Number(p.id), name: String(p.name || ''), ts: Date.parse(p.date) / 1000 }))
    .filter((p) => p.name && Number.isFinite(p.ts))
    .sort((a, b) => a.ts - b.ts);
  patchCache = { list, ts: Date.now() };
  return list;
}

function normalize(raw, patches) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const m of list) {
    if (!m || !m.match_id) continue;
    const isRadiant = Number(m.player_slot) < 128;
    // radiant_win 缺失时（少数被清理过的对局）不猜，直接跳过
    if (typeof m.radiant_win !== 'boolean') continue;
    const heroId = Number(m.hero_id) || 0;
    out.push({
      matchId: String(m.match_id),
      heroId,
      hero: heroIdToName[heroId] || (heroId ? `英雄${heroId}` : '未知英雄'),
      isWin: m.radiant_win === isRadiant,
      kills: Number(m.kills) || 0,
      deaths: Number(m.deaths) || 0,
      assists: Number(m.assists) || 0,
      kda: kdaOf(m.kills, m.deaths, m.assists),
      duration: Number(m.duration) || 0,
      startTime: Number(m.start_time) || 0,
      modeKey: modeKeyOf(m),
      modeLabel: modeLabelOf(m),
      patch: patchForTime(patches, m.start_time),
      rankLabel: rankLabelOf(m.average_rank),
      partySize: Number(m.party_size) || 1,
    });
  }
  out.sort((a, b) => b.startTime - a.startTime);
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const accountId = String(req.query.accountId || '').trim();
  if (!/^\d{1,12}$/.test(accountId)) {
    return res.status(400).json({ success: false, error: '缺少或非法的 accountId' });
  }

  const cached = matchCache.get(accountId);
  if (cached && Date.now() - cached.ts < MATCH_CACHE_TTL) {
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ ...cached.data, cached: true });
  }

  try {
    const [patches, rawMatches] = await Promise.all([
      loadPatches(),
      fetchJson(`https://api.opendota.com/api/players/${accountId}/matches?limit=${MATCH_LIMIT}`, {
        timeoutMs: 15000,
      }),
    ]);

    const matches = normalize(rawMatches, patches);

    // 生涯胜负（一次轻量请求，挂了不影响主数据）
    let lifetime = null;
    try {
      const wl = await fetchJson(`https://api.opendota.com/api/players/${accountId}/wl`, { timeoutMs: 10000 });
      const win = Number(wl && wl.win) || 0;
      const lose = Number(wl && wl.lose) || 0;
      if (win + lose > 0) {
        lifetime = {
          win,
          lose,
          total: win + lose,
          winRate: Math.round((win / (win + lose)) * 1000) / 10,
        };
      }
    } catch {
      lifetime = null;
    }

    // tab 计数 + 版本下拉选项都基于全量数据，切换时不闪
    const modeCounts = { all: matches.length, ranked: 0, normal: 0, turbo: 0, omg: 0, other: 0 };
    const patchCount = new Map();
    for (const m of matches) {
      modeCounts[m.modeKey] = (modeCounts[m.modeKey] || 0) + 1;
      if (m.patch) patchCount.set(m.patch, (patchCount.get(m.patch) || 0) + 1);
    }
    const patchOrder = new Map(patches.map((p, i) => [p.name, i]));
    const patchOptions = [...patchCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => (patchOrder.get(b.name) ?? -1) - (patchOrder.get(a.name) ?? -1));

    const data = {
      success: true,
      accountId,
      source: 'OpenDota',
      fetchedAt: Date.now(),
      lifetime,
      matches,
      modeCounts,
      patchOptions,
    };

    matchCache.set(accountId, { data, ts: Date.now() });
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json(data);
  } catch (error) {
    console.error('获取最近对局失败 accountId=' + accountId + ':', error.message);
    return res.status(502).json({
      success: false,
      error:
        matches(error) ||
        '暂时拿不到 OpenDota 的数据，可能是对方未公开比赛数据，或 OpenDota 暂时不可用。',
    });
  }
}

function matches(error) {
  const msg = String((error && error.message) || '');
  if (/超时/.test(msg)) return 'OpenDota 响应超时，稍后再试。';
  if (/404/.test(msg)) return 'OpenDota 里没有这个账号，可能未公开比赛数据。';
  return '';
}
