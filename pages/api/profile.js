// 个人信息接口（登录后可用）
// GET：返回当前用户的选手资料 + 比赛履历（名次/担任位置）+ 可选地区列表
// PUT：更新当前用户的选手资料（地区/分数/位置/英雄/评价/默契队友/仇人）
import { pool, updatePlayer, getPlayerTournaments, getDistinctRegions, ensurePlayerTextColumns } from '../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../lib/auth';

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
      return res.status(200).json({
        success: true,
        bound: true,
        profile: shapePlayer(ply.rows[0]),
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
      const ply = await client.query('SELECT * FROM public.players WHERE id = $1', [playerId]);
      const cur = ply.rows[0];
      if (!cur) {
        return res.status(404).json({ success: false, error: '选手资料不存在' });
      }

      // 只允许更新资料字段，game_id / nickname 等标识由注册时确定
      // 天梯分量级校验：Dota 顶分约 1.2 万，超过 2 万必然是误填
      // （历史导入里就有一条 peak_score=99999 的占位）。允许留空。
      const scoreFields = { score: '当前天梯分', peak_score: '历史最高分' };
      for (const [key, label] of Object.entries(scoreFields)) {
        if (body[key] === undefined || body[key] === null || body[key] === '') continue;
        const n = Number(body[key]);
        if (!Number.isFinite(n) || n < 0 || n > 20000) {
          return res.status(400).json({
            success: false,
            error: `${label}请填 0 ~ 20000 之间的数字`,
          });
        }
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
