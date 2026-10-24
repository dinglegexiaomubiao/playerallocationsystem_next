// 「我的赛事」：返回当前登录用户参与过的所有赛事（含队长身份、所在队伍）
//
// 有两个数据来源，缺一不可：
//   - tournament_players：报名记录（含 is_captain 快照、报名状态、报名时间）
//   - teams / team_players：实际分组结果（队长的 captain_id、队员的 team_players）
// 老数据只填了队伍、没填报名表，只查报名表会让老选手看到「还没有报名任何赛事」。
// 所以这里按赛事 id 合并两个来源，队长身份以 teams.captain_id 为准。
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

    // 报名记录
    const signups = await client.query(
      `SELECT tp.*, t.name AS tournament_name, t.status AS tournament_status,
              t.start_date, t.end_date
         FROM public.tournament_players tp
         JOIN public.tournaments t ON t.id = tp.tournament_id
        WHERE tp.player_id = $1
        ORDER BY tp.signed_at DESC`,
      [playerId]
    );

    // 队伍归属（队长或队员）
    const teams = await client.query(
      `SELECT tm.id, tm.name, tm.tournament_id, tm.captain_id,
              (tm.captain_id = $1) AS i_am_captain,
              t.name AS tournament_name, t.status AS tournament_status,
              t.start_date, t.end_date
         FROM public.teams tm
         JOIN public.tournaments t ON t.id = tm.tournament_id
         LEFT JOIN public.team_players tp
                ON tp.team_id = tm.id AND tp.player_id = $1
        WHERE tm.captain_id = $1 OR tp.player_id = $1
        ORDER BY tm.id ASC`,
      [playerId]
    );

    const byTournament = new Map();
    const ensure = (id) => {
      const key = String(id);
      if (!byTournament.has(key)) {
        byTournament.set(key, {
          tournament_id: id,
          tournament_name: null,
          tournament_status: null,
          is_captain: false,
          signup_status: null,
          signed_at: null,
          start_date: null,
          teams: [],
        });
      }
      return byTournament.get(key);
    };

    for (const s of signups.rows) {
      const it = ensure(s.tournament_id);
      it.tournament_name = s.tournament_name;
      it.tournament_status = s.tournament_status;
      it.signup_status = s.signup_status;
      it.signed_at = s.signed_at;
      if (s.start_date) it.start_date = s.start_date;
      if (s.is_captain === true) it.is_captain = true;
    }

    for (const t of teams.rows) {
      const it = ensure(t.tournament_id);
      if (!it.tournament_name) it.tournament_name = t.tournament_name;
      if (!it.tournament_status) it.tournament_status = t.tournament_status;
      if (t.i_am_captain === true) it.is_captain = true;
      if (t.start_date) it.start_date = it.start_date || t.start_date;
      if (!it.teams.some((x) => String(x.id) === String(t.id))) {
        it.teams.push({ id: t.id, name: t.name, tournament_id: t.tournament_id });
      }
    }

    const tournaments = [...byTournament.values()].sort((a, b) => {
      const w = (s) => (s === 'finished' || s === 'done' ? 1 : 0);
      const d = w(a.tournament_status) - w(b.tournament_status);
      if (d !== 0) return d;
      return String(b.signed_at || '').localeCompare(String(a.signed_at || ''));
    });

    return res.status(200).json({ success: true, tournaments, bound: true });
  } catch (error) {
    console.error('我的赛事错误:', error);
    return res.status(500).json({ success: false, error: '获取我的赛事失败' });
  } finally {
    client.release();
  }
}
