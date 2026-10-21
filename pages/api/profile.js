// 个人信息接口（登录后可用）
// GET：返回当前用户的选手资料 + 比赛履历（名次/担任位置）+ 可选地区列表
// PUT：更新当前用户的选手资料（地区/分数/位置/英雄/评价/默契队友/仇人）
import { pool, updatePlayer, getPlayerTournaments, getDistinctRegions, ensurePlayerTextColumns, ensureTournamentSchema } from '../../lib/db';
import {
  ensureIdentityTables,
  listIdentities,
  replaceIdentities,
  IdentityError,
} from '../../lib/player-identity';
import { getSession, denyIfNotLoggedIn } from '../../lib/auth';
import listCache from '../../lib/list-cache';

// 库里 positions / heroes / synergy_players / enemies 是逗号分隔的 text，
// 直接返回原始行会让前端把它们当数组用（.join / [0] 全都会出错），这里统一成数组。
const toList = (v) =>
  Array.isArray(v)
    ? v
    : String(v || '')
        .split(/[，,、\/;；|]/)
        .map((s) => s.trim())
        .filter(Boolean);

const shapePlayer = (row) => ({
  ...row,
  positions: toList(row.positions),
  heroes: toList(row.heroes),
  synergy_players: toList(row.synergy_players).map(String),
  enemies: toList(row.enemies).map(String),
});

export default async function handler(req, res) {
  if (denyIfNotLoggedIn(req, res)) return;

  const session = getSession(req);
  const client = await pool.connect();

  // 确保名次表 / 历史最高分列存在（旧库可能缺），本接口读 peak_score
  await ensureTournamentSchema();

  try {
    // 找到账号绑定的选手
    const acct = await client.query(
      'SELECT player_id FROM public.play_score WHERE name = $1',
      [session.name]
    );
    const playerId = acct.rows[0]?.player_id;

    if (req.method === 'GET') {
      if (!playerId) {
        return res.status(200).json({ success: true, bound: false, profile: null, tournaments: [], regions: [] });
      }
      const ply = await client.query('SELECT * FROM public.players WHERE id = $1', [playerId]);
      if (ply.rows.length === 0) {
        return res.status(200).json({ success: true, bound: false, profile: null, tournaments: [], regions: [] });
      }
      const tournaments = await getPlayerTournaments(playerId);
      const regions = await getDistinctRegions();
      // 一个群友可以有多个 SteamID / 多个群昵称，全部带出去给编辑页用
      await ensureIdentityTables(client);
      const identities = await listIdentities(client, playerId);
      return res.status(200).json({
        success: true,
        bound: true,
        profile: {
          ...shapePlayer(ply.rows[0]),
          steamIds: identities.steam,
          groupNicknames: identities.nicknames,
        },
        tournaments,
        regions,
      });
    }

    if (req.method === 'PUT') {
      if (!playerId) {
        return res.status(400).json({ success: false, error: '账号未绑定选手资料，请先在个人信息页补填' });
      }
      const body = req.body || {};
      // heroes 原来是 varchar(50)，多选英雄会超长，先确保已放宽为 text
      await ensurePlayerTextColumns();
      await ensureIdentityTables(client);
      const ply = await client.query('SELECT * FROM public.players WHERE id = $1', [playerId]);
      const cur = ply.rows[0];
      if (!cur) {
        return res.status(404).json({ success: false, error: '选手资料不存在' });
      }

      // ---------- 多值身份（SteamID / 群昵称）----------
      // 自助场景传 requirePrimary：主号只能「替换」不能直接删空，
      // 否则头像、战绩、赛程会集体失联，用户还不知道自己干了什么。
      if (Array.isArray(body.steamIds) || Array.isArray(body.groupNicknames)) {
        try {
          await replaceIdentities(client, playerId, {
            steamIds: body.steamIds,
            nicknames: body.groupNicknames,
            source: 'self',
            requirePrimary: true,
          });
        } catch (e) {
          if (e instanceof IdentityError) {
            return res.status(400).json({ success: false, error: e.message, code: e.code });
          }
          throw e;
        }
      }

      // 只允许更新资料字段，game_id / nickname 等标识由注册时确定
      //
      // 注意：score / peak_score / win_rate 在库里都是 integer。
      // 只校验范围是不够的 —— 小数（线上实测有人填 49.5）会被原样传给 Postgres，
      // 触发 22P02 invalid input syntax for type integer 直接 500，
      // 用户只看到一句「个人信息操作失败」。所以这里必须显式拒绝小数，
      // 并且不要静默四舍五入（填 49.5 的人多半想填 4950，四舍五入成 50 更误导）。
      const numericFields = [
        { key: 'score', label: '当前天梯分', max: 20000 },
        { key: 'peak_score', label: '历史最高分', max: 20000 },
        { key: 'win_rate', label: '自报胜率', max: 100 },
      ];
      for (const { key, label, max } of numericFields) {
        const raw = body[key];
        if (raw === undefined) continue; // 没传这个字段，保留库里原值
        if (raw === null || raw === '') {
          body[key] = null; // 明确清空
          continue;
        }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > max) {
          return res.status(400).json({
            success: false,
            error: `${label}请填 0 ~ ${max} 之间的数字`,
          });
        }
        if (!Number.isInteger(n)) {
          return res.status(400).json({
            success: false,
            error: `${label}请填整数（例如 ${key === 'win_rate' ? 55 : 4950}），不能带小数点`,
          });
        }
        body[key] = n; // 统一成 number，避免字符串形式的数字进 SQL
      }

      const updated = await updatePlayer(playerId, {
        nickname: cur.nickname,
        game_id: cur.game_id,
        group_nickname: body.group_nickname !== undefined ? body.group_nickname : cur.group_nickname,
        score: body.score !== undefined ? body.score : cur.score,
        // 历史最高分：由本人自填。分数会回落，所以它和 score 是两件事，
        // 不能互相推导 —— 当前 4000 的人历史最高可能是 6200。
        peak_score: body.peak_score !== undefined ? body.peak_score : cur.peak_score,
        positions: body.positions !== undefined ? body.positions : cur.positions,
        heroes: body.heroes !== undefined ? body.heroes : cur.heroes,
        win_rate: body.win_rate !== undefined ? body.win_rate : cur.win_rate,
        championships: body.championships !== undefined ? body.championships : cur.championships,
        synergy_players: body.synergy_players !== undefined ? body.synergy_players : cur.synergy_players,
        region: body.region !== undefined ? body.region : cur.region,
        self_intro: body.self_intro !== undefined ? body.self_intro : cur.self_intro,
        enemies: body.enemies !== undefined ? body.enemies : cur.enemies,
        updated_at: new Date().toISOString(),
      });
      // 群友列表带了头像/分数/身份，改完要立刻失效，否则公开页最多 45 秒看不到新号
      listCache.clear('playersList');
      return res.status(200).json({ success: true, profile: updated });
    }

    res.setHeader('Allow', ['GET', 'PUT']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    console.error('个人信息接口错误:', error);
    return res.status(500).json({ success: false, error: '个人信息操作失败' });
  } finally {
    client.release();
  }
}
