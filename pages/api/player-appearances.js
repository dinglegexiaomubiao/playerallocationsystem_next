/**
 * 选手出战记录：GET /api/player-appearances?player_id=<players.id>
 *
 * 与「比赛记录」（/api/players 里的 records）的区别：
 *   records        = 按赛事聚合，一届一行，回答「他参加过哪几届、什么名次」
 *   appearances    = 按场次展开，一局一行，回答「他哪几局上了、是不是替补」
 *
 * 替补判定来自 dota_match_players.is_standin —— 补录时按队籍名单投票认队，
 * 场上的人不在该队名单里就标记为替补。
 */
import { pool } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const raw = Array.isArray(req.query.player_id) ? req.query.player_id[0] : req.query.player_id;
  const playerId = String(raw || '').trim();
  if (!/^\d{5,20}$/.test(playerId)) {
    return res.status(400).json({ success: false, error: '缺少 player_id' });
  }

  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT m.dota_match_id,
              m.tournament_id,
              t.name            AS tournament_name,
              rd.name           AS round_name,
              m.order_no,
              m.team_a_id, m.team_b_id, m.winner_team_id,
              m.team_a_score, m.team_b_score,
              ta.name           AS team_a_name,
              tb.name           AS team_b_name,
              mp.is_radiant,
              mp.is_standin,
              mp.hero_id,
              mp.kills, mp.deaths, mp.assists,
              mp.net_worth,
              dm.start_time,
              dm.duration
         FROM public.dota_match_players mp
         JOIN public.dota_matches dm ON dm.match_id = mp.match_id
         JOIN public.matches m       ON m.dota_match_id = mp.match_id
         JOIN public.tournaments t   ON t.id = m.tournament_id
         LEFT JOIN public.tournament_rounds rd ON rd.id = m.round_id
         LEFT JOIN public.teams ta   ON ta.id = m.team_a_id
         LEFT JOIN public.teams tb   ON tb.id = m.team_b_id
        WHERE mp.player_id = $1
        ORDER BY dm.start_time DESC NULLS LAST, m.id DESC`,
      [playerId]
    );

    const rows = r.rows.map((x) => {
      const myTeamId = x.is_radiant ? x.team_a_id : x.team_b_id;
      const oppTeamId = x.is_radiant ? x.team_b_id : x.team_a_id;
      const myName = x.is_radiant ? x.team_a_name : x.team_b_name;
      const oppName = x.is_radiant ? x.team_b_name : x.team_a_name;
      const myScore = x.is_radiant ? x.team_a_score : x.team_b_score;
      const oppScore = x.is_radiant ? x.team_b_score : x.team_a_score;
      const win =
        x.winner_team_id === null || x.winner_team_id === undefined
          ? null
          : String(x.winner_team_id) === String(myTeamId);
      return {
        match_id: String(x.dota_match_id),
        tournament_id: x.tournament_id,
        tournament_name: x.tournament_name,
        round_name: x.round_name,
        order_no: x.order_no,
        team_name: myName,
        opponent_name: oppName,
        my_score: myScore,
        opp_score: oppScore,
        win,
        is_radiant: x.is_radiant,
        is_standin: x.is_standin,
        hero_id: x.hero_id,
        kills: x.kills,
        deaths: x.deaths,
        assists: x.assists,
        net_worth: x.net_worth,
        start_time: x.start_time,
        duration: x.duration,
        opp_team_id: oppTeamId,
        _my_team: myTeamId,
      };
    });

    const standins = rows.filter((x) => x.is_standin).length;
    return res.status(200).json({
      success: true,
      appearances: rows,
      total: rows.length,
      standin_count: standins,
    });
  } catch (e) {
    console.error('出战记录查询失败:', e);
    return res.status(500).json({ success: false, error: '查询失败' });
  } finally {
    client.release();
  }
}
