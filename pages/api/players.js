// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import {
  getAllPlayers,
  addPlayer,
  updatePlayer,
  deletePlayer,
  getPlayerById,
  ensureAvatarColumns,
  pool,
} from '../../lib/db';
import { denyIfNotAdmin } from '../../lib/auth';
import listCache from '../../lib/list-cache';

// ===== 列表结果的内存缓存 =====
// 这个接口要跑「全员参赛记录」的重量级聚合，而群友页每次进入都会调一次。
// 缓存 45s：够挡住刷新/来回跳页的重复查询，又不至于让人看不到刚刚的修改。
// 任何写操作（POST/PUT/DELETE）以及头像同步都会主动 clear，所以不会有"改完不生效"的观感。
const CACHE_SCOPE = 'playersList';

const readListCache = (key) => listCache.get(CACHE_SCOPE, key);
const writeListCache = (key, payload) => listCache.set(CACHE_SCOPE, key, payload);
const clearListCache = () => listCache.clear(CACHE_SCOPE);

// 一次查出所有人的参赛记录，避免按人循环查库（N+1）
//
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

  // 两次查询互不依赖，并行发出。跨区域部署下每次往返都要 200ms 量级，
  // 串行等待是这个接口慢的主因（参见 vercel.json 的 region 说明）。
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

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        const { tournament_id } = req.query;
        const cacheKey = tournament_id ? String(tournament_id) : 'all';

        const cached = readListCache(cacheKey);
        if (cached) {
          res.setHeader('X-List-Cache', 'HIT');
          return res.status(200).json({ success: true, players: cached });
        }
        res.setHeader('X-List-Cache', 'MISS');

        // 三件事互不依赖，并行发出 —— 避免三次串行的跨区域往返：
        //   1. 头像列自动补齐（幂等，失败也不阻断列表）
        //   2. 选手列表
        //   3. 全员参赛记录聚合
        const [, players, recordsByPlayer] = await Promise.all([
          ensureAvatarColumns(),
          getAllPlayers(tournament_id),
          getTeamRecordsByPlayer(),
        ]);

        // 格式化选手数据
        const formattedPlayers = players.map(player => {
          const records = recordsByPlayer.get(String(player.id)) || [];
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
            // 冠军数不再只看写死的字段：以 teams.rank=1 实算为准，
            // 老数据里导入过冠军数的，取两者较大值以免历史战绩"消失"
            championships: Math.max(legacyTitles, titles),
            championships_legacy: legacyTitles,
            // 亚军数没有历史字段可兼容，直接按 teams.rank=2 实算
            runner_up: runnerUps,
            // 比赛记录（页面上的「比赛记录」直接用这份）
            records,
            record_count: records.length,
            best_rank: ranks.length ? Math.min(...ranks) : null,
            // 头像走本地代理 /api/avatar/{id}（服务端已缓存，避免直连 Steam）。
            // 没同步到头像时给 null，前端回退成昵称首字色块。
            avatar: player.avatar_url ? `/api/avatar/${player.id}` : null,
            steam_name: player.steam_name || null,
            positions: player.positions ? player.positions.split(',').filter(p => p) : [],
            heroes: player.heroes ? player.heroes.split(',').filter(h => h) : [],
            synergy_players: player.synergy_players ? player.synergy_players.split(',').filter(sp => sp) : [],
            enemies: player.enemies ? player.enemies.split(',').filter(e => e) : [],
            region: player.region || '',
            self_intro: player.self_intro || '',
            created_at: player.created_at || "",
            updated_at: player.updated_at || "",
            position_priority: {}
          };
        });

        writeListCache(cacheKey, formattedPlayers);
        res.status(200).json({ success: true, players: formattedPlayers });
      } catch (error) {
        console.error('获取选手列表错误:', error);
        res.status(500).json({ success: false, error: '获取选手列表失败' });
      }
      break;

    case 'POST':
      try {
        // 选手写操作一律限管理员。UI 入口只有两个：/main（页面服务端已限管理员）
        // 与 Excel 批量导入（members 页，管理员功能）。
        // 此前这里只校验 x-excel-import 头，不带该头的 POST / PUT / DELETE 完全对外开放。
        if (denyIfNotAdmin(req, res, '仅管理员可新增选手')) return;
        const { tournament_id, ...playerData } = req.body;
        const newPlayer = await addPlayer(playerData, tournament_id);
        clearListCache();
        res.status(201).json({ success: true, player: newPlayer });
      } catch (error) {
        console.error('创建选手错误:', error);
        res.status(500).json({ success: false, error: '创建选手失败' });
      }
      break;

    case 'PUT':
      try {
        if (denyIfNotAdmin(req, res, '仅管理员可修改选手资料')) return;
        const { playerId, player: updates, tournament_id } = req.body;

        // 更新选手信息
        await updatePlayer(playerId, updates);
        clearListCache();

        // 获取更新后的选手信息
        const updatedPlayer = await getPlayerById(playerId);
        
        // 如果提供了tournament_id，更新选手与赛季的关联
        if (tournament_id) {
          const client = await pool.connect();
          try {
            // 检查是否已存在关联
            const existing = await client.query(
              'SELECT * FROM public.player_tournament_participations WHERE player_id = $1 AND tournament_id = $2',
              [playerId, tournament_id]
            );
            
            if (existing.rows.length === 0) {
              // 如果不存在关联，则创建新的关联
              await client.query(
                `INSERT INTO public.player_tournament_participations (player_id, tournament_id, created_at)
                 VALUES ($1, $2, $3)`,
                [playerId, tournament_id, new Date().toISOString()]
              );
              // 创建选手赛季参与记录成功
            } else {
              // 选手赛季参与记录已存在
            }
          } finally {
            client.release();
          }
        }
        
        res.status(200).json({ success: true, player: updatedPlayer });
      } catch (error) {
        console.error('更新选手错误:', error);
        res.status(500).json({ success: false, error: `更新选手失败: ${error.message}` });
      }
      break;

    case 'DELETE':
      try {
        if (denyIfNotAdmin(req, res, '仅管理员可删除选手')) return;
        const { id } = req.body;
        await deletePlayer(id);
        clearListCache();
        res.status(200).json({ success: true, message: '选手删除成功' });
      } catch (error) {
        console.error('删除选手错误:', error);
        res.status(500).json({ success: false, error: '删除选手失败' });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}