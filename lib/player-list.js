/**
 * 群友列表的数据装配（服务端 / API 共用）。
 *
 * 为什么单独抽一份：这个列表既要给 `/api/players` 用，又要给 `/members` 的
 * getServerSideProps 直出。以前装配逻辑写在 API 路由里，页面只能靠客户端 fetch，
 * 于是「手机端 JS 没跑起来 / 请求卡住」就变成一片空白 + 永远加载中（2026-10-22 线上问题）。
 * 逻辑只留一份，避免预览一套、直出一套地漂移。
 *
 * 缓存：45s 内存缓存，键与旧实现一致（'playersList' 作用域），
 * 所有写操作（增删改、合并、头像同步）本来就会 clear 这个作用域，所以改动后仍能立即生效。
 */
import { getAllPlayers, ensureAvatarColumns, ensureGuildTables, pool } from './db';
import { toSerializable as serializeToProps } from './serialize.mjs';
import { ensureIdentityTables, identitiesForPlayers } from './player-identity';
import listCache from './list-cache';

const CACHE_SCOPE = 'playersList';

export const playerListCacheKey = (tournamentId) => (tournamentId ? String(tournamentId) : 'all');

export function clearPlayerListCache() {
  listCache.clear(CACHE_SCOPE);
}

// 一次查出所有人的参赛记录，避免按人循环查库（N+1）//
// 名次存在 teams.rank 上，而「谁在这支队伍里」要 join team_players；
// 队长可能还没被写进 team_players，所以额外按 captain_id 捞一遍。
async function getTeamRecordsByPlayer() {
  const byPlayer = new Map();
  const push = (playerId, rec) => {
    const key = String(playerId);
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    const list = byPlayer.get(key);
    if (list.some((x) => String(x.team_id) === String(rec.team_id))) return; // 队长+队员同一支队只记一次
    list.push(rec);
  };

  // 两次查询互不依赖，并行发出（串行等待是这个接口慢的主因）
  const [members, captains] = await Promise.all([
    pool.query(
      `SELECT tp.player_id, tp.position,
              tm.id AS team_id, tm.name AS team_name, tm.rank AS team_rank,
              t.id AS tournament_id, t.name AS tournament_name,
              t.status AS tournament_status, t.start_date, t.end_date
         FROM public.team_players tp
         JOIN public.teams tm ON tm.id = tp.team_id
         JOIN public.tournaments t ON t.id = tm.tournament_id`
    ),
    pool.query(
      `SELECT tm.captain_id AS player_id,
              tm.id AS team_id, tm.name AS team_name, tm.rank AS team_rank,
              t.id AS tournament_id, t.name AS tournament_name,
              t.status AS tournament_status, t.start_date, t.end_date
         FROM public.teams tm
         JOIN public.tournaments t ON t.id = tm.tournament_id
        WHERE tm.captain_id IS NOT NULL`
    ),
  ]);

  for (const r of members.rows) {
    push(r.player_id, {
      team_id: String(r.team_id),
      team_name: r.team_name || '未命名队伍',
      team_rank: r.team_rank === null || r.team_rank === undefined ? null : Number(r.team_rank),
      position: r.position || null,
      is_captain: false,
      tournament_id: r.tournament_id === null ? null : String(r.tournament_id),
      tournament_name: r.tournament_name || '未命名赛事',
      tournament_status: r.tournament_status || null,
      start_date: r.start_date || null,
      end_date: r.end_date || null,
    });
  }

  for (const r of captains.rows) {
    push(r.player_id, {
      team_id: String(r.team_id),
      team_name: r.team_name || '未命名队伍',
      team_rank: r.team_rank === null || r.team_rank === undefined ? null : Number(r.team_rank),
      position: '队长',
      is_captain: true,
      tournament_id: r.tournament_id === null ? null : String(r.tournament_id),
      tournament_name: r.tournament_name || '未命名赛事',
      tournament_status: r.tournament_status || null,
      start_date: r.start_date || null,
      end_date: r.end_date || null,
    });
  }

  // 已完赛的排后面，其余按开赛时间倒序
  for (const list of byPlayer.values()) {
    list.sort((a, b) => {
      const w = (s) => (s === 'finished' || s === 'done' ? 1 : 0);
      const d = w(a.tournament_status) - w(b.tournament_status);
      if (d !== 0) return d;
      return String(b.start_date || '').localeCompare(String(a.start_date || ''));
    });
  }

  return byPlayer;
}

/**
 * 把数据洗成「能进 getServerSideProps props」的纯对象。
 *
 * 实现搬到 `lib/serialize.mjs` 了 —— /admin 首页也踩了同一个坑
 * （`feedback.items[0].created_at` 是 timestamptz），两处各写一份迟早不一样。
 * 这里保留这个名字只是为了让调用点读起来还是「这份列表洗干净了」。
 */
const toSerializable = serializeToProps;

/** 格式化单人档案：列表卡片、详情页、SSR 都用这一份 */
function formatPlayer(player, records) {
  const titles = records.filter((r) => r.team_rank === 1).length;
  const runnerUps = records.filter((r) => r.team_rank === 2).length;
  const legacyTitles = player.championships ? parseInt(player.championships, 10) || 0 : 0;
  const ranks = records.map((r) => r.team_rank).filter((n) => typeof n === 'number');
  return {
    ...player,
    id: player.id?.toString(),
    game_id: player.game_id?.toString(),
    score: player.score ? parseInt(player.score) : 0,
    win_rate: player.win_rate ? parseInt(player.win_rate) : 0,
    // 冠军数以 teams.rank=1 实算为准；老数据里导入过冠军数的取较大值，避免历史战绩"消失"
    championships: Math.max(legacyTitles, titles),
    championships_legacy: legacyTitles,
    runner_up: runnerUps,
    records,
    record_count: records.length,
    best_rank: ranks.length ? Math.min(...ranks) : null,
    // 头像走本地代理 /api/avatar/{id}；没同步到时给 null，前端回退成昵称首字色块
    avatar: player.avatar_url ? `/api/avatar/${player.id}` : null,
    steam_name: player.steam_name || null,
    positions: player.positions ? String(player.positions).split(',').filter((p) => p) : [],
    heroes: player.heroes ? String(player.heroes).split(',').filter((h) => h) : [],
    synergy_players: player.synergy_players ? String(player.synergy_players).split(',').filter((sp) => sp) : [],
    enemies: player.enemies ? String(player.enemies).split(',').filter((e) => e) : [],
    region: player.region || '',
    self_intro: player.self_intro || '',
    created_at: player.created_at || '',
    updated_at: player.updated_at || '',
    position_priority: {},
  };
}

/**
 * 取群友列表（格式化 + 多值身份），带 45s 缓存。
 *
 * @param {object} opts
 *   tournamentId: 只取某届的参赛选手
 *   cache: 默认 true；SSR 也走缓存，避免每次开页都跑重量级聚合
 * @returns {{ players: Array, cached: boolean }}
 */
export async function loadPlayerList({ tournamentId = null, cache = true } = {}) {
  const key = playerListCacheKey(tournamentId);
  if (cache) {
    const hit = listCache.get(CACHE_SCOPE, key);
    if (hit) return { players: hit, cached: true };
  }

  // 三件事互不依赖，并行发出（跨区域部署下每次往返都要 200ms 量级）
  const [, rawPlayers, recordsByPlayer] = await Promise.all([
    ensureAvatarColumns(),
    getAllPlayers(tournamentId),
    getTeamRecordsByPlayer(),
  ]);

  /* pg 的 timestamptz 会解析成 Date，而 Date **不能**出现在 getServerSideProps 的 props 里。
     ⚠ 这个错只在 dev / 构建期报（Next 的 isSerializableProps 检查带 __NEXT_DEV_SERVER 条件），
       线上会被 JSON.stringify 悄悄转成 ISO 字符串 —— 于是「本地 /members 直接 500、
       线上却好好的」，是最难查的那种。
     已经是第三次被它咬了（players.avatar_synced_at、records[].start_date…），
     所以这里做**深度**转换，而不是逐个字段列 —— 下次再加一个 timestamptz 列不用改这里。 */
  const players = rawPlayers
    .map((p) => formatPlayer(p, recordsByPlayer.get(String(p.id)) || []))
    .map(toSerializable);

  // 多值身份：全部 SteamID / 全部群昵称（详情页公开显示，卡片取主号）
  try {
    await ensureIdentityTables(pool);
    const identityMap = await identitiesForPlayers(pool, players.map((p) => String(p.id)));
    players.forEach((p) => {
      const id = identityMap.get(String(p.id)) || { steam: [], nicknames: [] };
      p.steamIds = id.steam; // [{ accountId, isPrimary }]
      p.groupNicknames = id.nicknames; // [{ nickname, isPrimary }]
    });
  } catch (e) {
    // 身份表没建好也不该让整个列表挂掉，退回单值
    console.error('附加多值身份失败（列表仍返回单值）:', e.message);
    players.forEach((p) => {
      p.steamIds = p.game_id ? [{ accountId: String(p.game_id), isPrimary: true }] : [];
      p.groupNicknames = p.group_nickname ? [{ nickname: p.group_nickname, isPrimary: true }] : [];
    });
  }

  // 帮派（小团体）：一次查完所有在帮里的人，不按人循环查（171 人会变成 171 次往返）。
  // 只回 id/name/slogan/colorKey，具体色值由前端从 lib/guild-colors.mjs 取 ——
  // 色板改了不用动接口，也不会让列表 payload 因为塞 rgba 变胖。
  // slogan 一起带上：详情页要在帮名下面显示口号，列表卡片也能当 title 用，
  // 单独再请求一次 /api/guilds 只为拿一句话不划算。
  try {
    await ensureGuildTables();
    const gr = await pool.query(
      `SELECT gm.player_id, g.id, g.name, g.slogan, g.color_key
         FROM public.guild_members gm
         JOIN public.guilds g ON g.id = gm.guild_id`
    );
    const guildByPlayer = new Map(
      gr.rows.map((r) => [
        String(r.player_id),
        { id: Number(r.id), name: r.name, slogan: r.slogan || '', colorKey: r.color_key },
      ])
    );
    players.forEach((p) => {
      p.guild = guildByPlayer.get(String(p.id)) || null;
    });
  } catch (e) {
    // 帮派表没建好也不该让整份列表挂掉 —— 群友信息比帮派重要
    console.error('附加帮派信息失败（列表仍返回，guild 为 null）:', e.message);
    players.forEach((p) => {
      p.guild = null;
    });
  }

  if (cache) listCache.set(CACHE_SCOPE, key, players);
  return { players, cached: false };
}
