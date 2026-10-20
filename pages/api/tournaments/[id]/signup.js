// 赛事报名 / 退赛接口
// GET：查当前账号在本赛事的报名状态 + 档案里的位置/分数（供报名弹窗预填）
// POST：报名（可带本届确认过的 score / positions，自动通过并生成快照）
//       已报名时带这两个值等于「重新确认」，会更新快照
// DELETE：退赛
import { pool } from '../../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../../lib/auth';
import { POSITIONS } from '../../../../lib/options.mjs';

/* 位置的存储形态是逗号分隔字符串，和 players.positions 保持一致。
   入参可能是数组也可能是字符串，统一归一；不在白名单里的直接丢掉，
   避免把「中单，劣势路」这类带标点的脏值写进快照。 */
function normalizePositions(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  return raw
    .map((x) => String(x).trim())
    .filter((x) => POSITIONS.includes(x))
    .join(',');
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, error: '缺少赛季ID' });

  // GET 要能被匿名调用（页面只是想知道「我报名了没」），所以不能走统一的登录闸门
  if (req.method === 'GET') {
    const session = getSession(req);
    if (!session || !session.name) {
      return res.status(200).json({ success: true, loggedIn: false, signedUp: false, signup: null });
    }
    const client = await pool.connect();
    try {
      const acct = await client.query('SELECT player_id FROM public.play_score WHERE name = $1', [session.name]);
      const playerId = acct.rows[0]?.player_id;
      if (!playerId) {
        return res.status(200).json({ success: true, loggedIn: true, bound: false, signedUp: false, signup: null });
      }
      const row = await client.query(
        'SELECT * FROM public.tournament_players WHERE player_id = $1 AND tournament_id = $2',
        [playerId, id]
      );
      // 档案里的当前值：报名弹窗用它做预填，让选手在此基础上改成本届的实际情况
      const prof = await client.query(
        `SELECT nickname, group_nickname, score, peak_score, positions
           FROM public.players WHERE id = $1`,
        [playerId]
      );
      return res.status(200).json({
        success: true,
        loggedIn: true,
        bound: true,
        playerId: String(playerId),
        signedUp: row.rows.length > 0,
        isCaptain: row.rows.length > 0 ? Boolean(row.rows[0].is_captain) : false,
        signup: row.rows[0] || null,
        profile: prof.rows[0] || null,
      });
    } catch (error) {
      console.error('查询报名状态失败:', error);
      return res.status(500).json({ success: false, error: '查询报名状态失败' });
    } finally {
      client.release();
    }
  }

  if (denyIfNotLoggedIn(req, res)) return;

  const session = getSession(req);
  const client = await pool.connect();

  try {
    if (req.method === 'POST') {
      // 找到当前账号绑定的选手
      const acct = await client.query(
        'SELECT player_id FROM public.play_score WHERE name = $1',
        [session.name]
      );
      const playerId = acct.rows[0]?.player_id;
      if (!playerId) {
        return res.status(400).json({
          success: false,
          error: '你的账号还未绑定选手资料，请先在个人信息页补填',
        });
      }

      // 取全局选手资料，作为快照来源
      const ply = await client.query('SELECT * FROM public.players WHERE id = $1', [playerId]);
      if (ply.rows.length === 0) {
        return res.status(404).json({ success: false, error: '选手资料不存在' });
      }
      const p = ply.rows[0];

      /* 报名时要确认「本届参赛信息」——
         常玩位置和档案天梯分是个人档案，不等于本届实际打的位置/分数。
         这里接受前端确认过的值，没传才回退档案。 */
      const body = req.body || {};
      const hasScore = body.score !== undefined && body.score !== null && body.score !== '';
      const hasPositions = body.positions !== undefined && body.positions !== null;

      if (hasScore) {
        const n = Number(body.score);
        if (!Number.isFinite(n) || n < 0 || n > 20000) {
          return res.status(400).json({
            success: false,
            error: '参赛天梯分请填 0 ~ 20000 之间的数字',
          });
        }
      }

      const snapScore = hasScore ? Number(body.score) : p.score;
      const snapPositions = hasPositions
        ? normalizePositions(body.positions)
        : p.positions;

      // 幂等：已报名则直接返回，不重复建快照；但带了确认值就更新
      const existing = await client.query(
        'SELECT * FROM public.tournament_players WHERE player_id = $1 AND tournament_id = $2',
        [playerId, id]
      );
      if (existing.rows.length > 0) {
        if (!hasScore && !hasPositions) {
          return res.status(200).json({
            success: true,
            message: '已报名，无需重复',
            signup: existing.rows[0],
          });
        }
        const upd = await client.query(
          `UPDATE public.tournament_players
              SET score = $3, positions = $4
            WHERE player_id = $1 AND tournament_id = $2
            RETURNING *`,
          [playerId, id, snapScore, snapPositions]
        );
        return res.status(200).json({
          success: true,
          message: '已更新本届参赛信息',
          updated: true,
          signup: upd.rows[0],
        });
      }

      const inserted = await client.query(
        `INSERT INTO public.tournament_players
           (player_id, tournament_id, score, positions, heroes, region, self_intro, enemies, signup_status, signed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'approved',CURRENT_TIMESTAMP)
         RETURNING *`,
        [playerId, id, snapScore, snapPositions, p.heroes, p.region, p.self_intro, p.enemies]
      );

      return res.status(201).json({ success: true, signup: inserted.rows[0] });
    }

    if (req.method === 'DELETE') {
      const acct = await client.query(
        'SELECT player_id FROM public.play_score WHERE name = $1',
        [session.name]
      );
      const playerId = acct.rows[0]?.player_id;
      if (!playerId) {
        return res.status(400).json({ success: false, error: '未绑定选手资料' });
      }

      const del = await client.query(
        `DELETE FROM public.tournament_players
         WHERE player_id = $1 AND tournament_id = $2 AND is_captain = false
         RETURNING id`,
        [playerId, id]
      );
      if (del.rowCount === 0) {
        return res.status(400).json({
          success: false,
          error: '退赛失败（未报名，或身为队长需先卸任）',
        });
      }
      return res.status(200).json({ success: true, message: '已退赛' });
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    console.error('报名操作错误:', error);
    return res.status(500).json({ success: false, error: '报名操作失败' });
  } finally {
    client.release();
  }
}
