// 「我的赛事」：返回当前登录用户报名参与的所有赛事（含队长身份、队伍）
import { pool } from '../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `方法 ${req.method} 不被允许` });
  }
  if (denyIfNotLoggedIn(req, res)) return;

  const session = getSession(req);
  const client = await pool.connect();
  try {
    const acct = await client.query(
      'SELECT player_id FROM public.play_score WHERE name = $1',
      [session.name]
    );
    const playerId = acct.rows[0]?.player_id;
    if (!playerId) {
      return res.status(200).json({ success: true, tournaments: [], bound: false });
    }

    // 该选手报名的所有赛事（含快照 is_captain）
    const signups = await client.query(
      `SELECT tp.*, t.name AS tournament_name, t.status AS tournament_status, t.start_date, t.end_date
         FROM public.tournament_players tp
         JOIN public.tournaments t ON t.id = tp.tournament_id
        WHERE tp.player_id = $1
        ORDER BY tp.signed_at DESC`,
      [playerId]
    );

    // 该选手作为队长或队员所在的队伍
    const teams = await client.query(
      `SELECT DISTINCT tm.id, tm.name, tm.tournament_id, tm.captain_id
         FROM public.teams tm
         LEFT JOIN public.team_players tp ON tp.team_id = tm.id
        WHERE tm.captain_id = $1 OR tp.player_id = $1`,
      [playerId]
    );
    const teamByTournament = {};
    for (const t of teams.rows) {
      if (!teamByTournament[String(t.tournament_id)]) {
        teamByTournament[String(t.tournament_id)] = [];
      }
      teamByTournament[String(t.tournament_id)].push(t);
    }

    const tournaments = signups.rows.map((s) => ({
      tournament_id: s.tournament_id,
      tournament_name: s.tournament_name,
      tournament_status: s.tournament_status,
      start_date: s.start_date,
      end_date: s.end_date,
      is_captain: s.is_captain === true,
      signup_status: s.signup_status,
      signed_at: s.signed_at,
      teams: teamByTournament[String(s.tournament_id)] || [],
    }));

    return res.status(200).json({ success: true, tournaments, bound: true });
  } catch (error) {
    console.error('我的赛事错误:', error);
    return res.status(500).json({ success: false, error: '获取我的赛事失败' });
  } finally {
    client.release();
  }
}
