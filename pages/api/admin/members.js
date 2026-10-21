/**
 * 后台群友管理专用接口。
 *
 * 为什么不在 /api/players 上加：那个接口是公开的，不能暴露账号名和登录次数。
 *
 * 返回完整字段（含 heroes / win_rate / championships 等），是因为
 * updatePlayer 是「全量 UPDATE」——少传一个字段就会被写成空值。
 * 前端编辑时必须拿到完整对象再整体提交。
 */
import { getSession, isAdmin } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { ensureIdentityTables, identitiesForPlayers } from '../../../lib/player-identity';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: '请先登录' });
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: '仅管理员可访问' });

  try {
    const r = await pool.query(`
      SELECT
        p.id, p.nickname, p.group_nickname, p.game_id, p.score,
        p.positions, p.heroes, p.win_rate, p.championships,
        p.synergy_players, p.region, p.self_intro, p.enemies,
        p.avatar_url, p.steam_name, p.created_at, p.updated_at,
        ps.name  AS account_name,
        ps.count AS login_count
      FROM public.players p
      LEFT JOIN public.play_score ps ON ps.player_id = p.id
      ORDER BY p.nickname ASC
    `);

    const players = r.rows.map((p) => ({
      ...p,
      // 统一成前端好用的类型，避免 null / undefined 混用
      game_id: p.game_id == null ? '' : String(p.game_id),
      score: p.score == null ? 0 : Number(p.score),
      positions: p.positions || '',
      heroes: p.heroes || '',
      region: p.region || '',
      self_intro: p.self_intro || '',
      account_name: p.account_name || null,
      login_count: p.login_count == null ? 0 : Number(p.login_count),
    }));

    // 多值身份（全部 SteamID / 全部群昵称）：一次批量查出，避免逐人查库
    await ensureIdentityTables(pool);
    const ids = players.map((p) => String(p.id));
    const identityMap = await identitiesForPlayers(pool, ids);
    players.forEach((p) => {
      const id = identityMap.get(String(p.id)) || { steam: [], nicknames: [] };
      p.steam_ids = id.steam;          // [{ accountId, isPrimary }]
      p.group_nicknames_all = id.nicknames; // [nickname]
    });

    return res.status(200).json({ ok: true, players });
  } catch (error) {
    console.error('后台群友列表查询失败:', error);
    return res.status(500).json({ ok: false, error: '查询失败：' + error.message });
  }
}
