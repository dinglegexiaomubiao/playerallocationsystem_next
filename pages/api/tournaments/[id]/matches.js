// 赛程与结果接口
// GET：公开，返回轮次 + 对阵（含队伍名、恩怨局标记）
// POST / PUT / DELETE：管理员，编排赛程、录入比分、删除对阵/轮次
import { pool, ensureTournamentSchema } from '../../../../lib/db';
import { denyIfNotAdmin } from '../../../../lib/auth';
import heroIdToName from '../../../../lib/heroMapping';
import heroSlugByName from '../../../../lib/heroSlugs';
import itemSlugs from '../../../../lib/itemMapping';

/* 把一行明细里的物品 id 转成 CDN slug，前端直接拼 /api/item-icon/{slug} */
function itemsOf(r) {
  const ids = [r.item_0, r.item_1, r.item_2, r.item_3, r.item_4, r.item_5, r.item_neutral];
  return ids.filter((x) => x && itemSlugs[x]).map((id) => ({ id, slug: itemSlugs[id] }));
}

// 判断两队之间是否存在仇人关系（任意方向命中即「恩怨局」）
// 仇人标注由选手在个人资料里维护，存于全局 players.enemies，
// 与成员页展示保持一致（快照仅作报名时点存档，非恩怨判定源）。
async function isGrudgeMatch(client, tournamentId, teamAId, teamBId) {
  if (!teamAId || !teamBId) return false;
  // 取两队成员
  const members = await client.query(
    `SELECT team_id, player_id FROM public.team_players WHERE team_id IN ($1, $2) AND tournament_id = $3`,
    [teamAId, teamBId, tournamentId]
  );
  const aMembers = members.rows.filter((r) => String(r.team_id) === String(teamAId)).map((r) => String(r.player_id));
  const bMembers = members.rows.filter((r) => String(r.team_id) === String(teamBId)).map((r) => String(r.player_id));
  if (aMembers.length === 0 || bMembers.length === 0) return false;

  // 取两队成员的全局仇人标注
  const rows = await client.query(
    `SELECT id, enemies FROM public.players WHERE id = ANY($1::bigint[])`,
    [[...aMembers, ...bMembers].map(Number)]
  );
  for (const s of rows.rows) {
    const enemies = String(s.enemies || '').split(',').map((x) => x.trim()).filter(Boolean);
    const myTeam = aMembers.includes(String(s.id)) ? 'A' : 'B';
    for (const e of enemies) {
      const inOther = myTeam === 'A' ? bMembers.includes(e) : aMembers.includes(e);
      if (inOther) return true;
    }
  }
  return false;
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, error: '缺少赛季ID' });

  const client = await pool.connect();
  try {
    // 确保赛后明细表存在（旧库可能缺），公开接口也依赖它们
    await ensureTournamentSchema();
    // ---- GET：公开 ----
    if (req.method === 'GET') {
      // 轮次
      const rounds = await client.query(
        `SELECT * FROM public.tournament_rounds WHERE tournament_id = $1 ORDER BY order_no ASC, id ASC`,
        [id]
      );
      // 对阵（含队伍名）
      const matches = await client.query(
        `SELECT m.*,
                ta.name AS team_a_name, tb.name AS team_b_name,
                tw.name AS winner_name,
                dm.duration  AS dota_duration,
                dm.start_time AS dota_start_time
         FROM public.matches m
         LEFT JOIN public.teams ta ON ta.id = m.team_a_id
         LEFT JOIN public.teams tb ON tb.id = m.team_b_id
         LEFT JOIN public.teams tw ON tw.id = m.winner_team_id
         LEFT JOIN public.dota_matches dm ON dm.match_id = m.dota_match_id
         WHERE m.tournament_id = $1
         ORDER BY m.order_no ASC, m.id ASC`,
        [id]
      );

      // 为每场标记恩怨局，并附上 Dota2 对局明细（选手 / 英雄 / KDA）
      // 明细一次性查出来，避免每场比赛单独查一次（N+1）
      const dotaIds = matches.rows.map((m) => m.dota_match_id).filter(Boolean);
      const dotaPlayers = new Map();
      if (dotaIds.length > 0) {
        const dp = await client.query(
          `SELECT mp.match_id, mp.account_id, mp.player_id, mp.hero_id, mp.is_radiant,
                  mp.kills, mp.deaths, mp.assists, mp.net_worth, mp.gpm, mp.xpm,
                  mp.last_hits, mp.hero_damage, mp.is_standin,
                  mp.level,
                  mp.item_0, mp.item_1, mp.item_2, mp.item_3, mp.item_4, mp.item_5,
                  mp.item_neutral, mp.aghanims_scepter, mp.aghanims_shard,
                  p.nickname, p.group_nickname, p.score
             FROM public.dota_match_players mp
             LEFT JOIN public.players p ON p.id = mp.player_id
            WHERE mp.match_id = ANY($1::bigint[])
            ORDER BY mp.is_radiant DESC, mp.net_worth DESC NULLS LAST`,
          [dotaIds]
        );
        dp.rows.forEach((r) => {
          const k = String(r.match_id);
          if (!dotaPlayers.has(k)) dotaPlayers.set(k, []);
          dotaPlayers.get(k).push({
            ...r,
            hero_name: heroIdToName[r.hero_id] || null,
            hero_slug: heroIdToName[r.hero_id] ? heroSlugByName[heroIdToName[r.hero_id]] || null : null,
            items: itemsOf(r),
          });
        });
      }

      const withGrudge = [];
      for (const m of matches.rows) {
        m.is_grudge = await isGrudgeMatch(client, id, m.team_a_id, m.team_b_id);
        m.dota_players = m.dota_match_id ? dotaPlayers.get(String(m.dota_match_id)) || [] : [];
        withGrudge.push(m);
      }

      return res.status(200).json({
        success: true,
        rounds: rounds.rows,
        matches: withGrudge,
      });
    }

    // ---- 以下均为管理员 ----
    if (denyIfNotAdmin(req, res, '仅管理员可编排赛程')) return;

    if (req.method === 'POST') {
      const { type, name, order_no, team_a_id, team_b_id, round_id, orderNo } = req.body;
      // type === 'round'：新建轮次；否则新建对阵
      if (type === 'round') {
        const r = await client.query(
          `INSERT INTO public.tournament_rounds (tournament_id, name, order_no, created_at)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [id, name || '未命名阶段', order_no ?? 0, new Date().toISOString()]
        );
        return res.status(201).json({ success: true, round: r.rows[0] });
      }

      // 新建对阵
      if (!team_a_id || !team_b_id) {
        return res.status(400).json({ success: false, error: '缺少对阵双方队伍' });
      }
      const m = await client.query(
        `INSERT INTO public.matches (tournament_id, round_id, team_a_id, team_b_id, team_a_score, team_b_score, winner_team_id, status, order_no, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [id, round_id || null, team_a_id, team_b_id, null, null, null, 'scheduled', orderNo ?? order_no ?? 0, null, new Date().toISOString()]
      );
      return res.status(201).json({ success: true, match: m.rows[0] });
    }

    if (req.method === 'PUT') {
      const { matchId, roundId, name, team_a_score, team_b_score, winner_team_id, status, round_id, order_no, note } = req.body;

      // 轮次改名：赛程编排建完「淘汰赛」之后发现该叫「八强赛」，
      // 以前只能删掉重建（连带把该轮所有对阵删掉），这里给一条只改名的路。
      if (roundId && name !== undefined) {
        const nm = String(name).trim();
        if (!nm) return res.status(400).json({ success: false, error: '阶段名不能为空' });
        const r = await client.query(
          `UPDATE public.tournament_rounds SET name = $1 WHERE id = $2 AND tournament_id = $3 RETURNING *`,
          [nm, roundId, id]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, error: '这个阶段不存在' });
        return res.status(200).json({ success: true, round: r.rows[0] });
      }

      if (!matchId) return res.status(400).json({ success: false, error: '缺少 matchId' });

      const fields = [];
      const values = [];
      let idx = 1;
      const push = (col, val) => { fields.push(`${col} = $${idx}`); values.push(val); idx += 1; };
      if (team_a_score !== undefined) push('team_a_score', team_a_score);
      if (team_b_score !== undefined) push('team_b_score', team_b_score);
      if (winner_team_id !== undefined) push('winner_team_id', winner_team_id);
      if (status !== undefined) push('status', status);
      if (round_id !== undefined) push('round_id', round_id);
      if (order_no !== undefined) push('order_no', order_no);
      if (note !== undefined) push('note', note);

      if (fields.length === 0) return res.status(400).json({ success: false, error: '没有可更新字段' });

      values.push(matchId);
      const r = await client.query(
        `UPDATE public.matches SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (r.rowCount === 0) return res.status(404).json({ success: false, error: '对阵不存在' });
      return res.status(200).json({ success: true, match: r.rows[0] });
    }

    if (req.method === 'DELETE') {
      const { matchId, roundId } = req.body;
      if (matchId) {
        await client.query(`DELETE FROM public.matches WHERE id = $1 AND tournament_id = $2`, [matchId, id]);
        return res.status(200).json({ success: true, message: '对阵已删除' });
      }
      if (roundId) {
        await client.query(`DELETE FROM public.matches WHERE round_id = $1 AND tournament_id = $2`, [roundId, id]);
        await client.query(`DELETE FROM public.tournament_rounds WHERE id = $1 AND tournament_id = $2`, [roundId, id]);
        return res.status(200).json({ success: true, message: '轮次已删除' });
      }
      return res.status(400).json({ success: false, error: '缺少 matchId 或 roundId' });
    }

    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    console.error('赛程接口错误:', error);
    return res.status(500).json({ success: false, error: '赛程操作失败' });
  } finally {
    client.release();
  }
}
