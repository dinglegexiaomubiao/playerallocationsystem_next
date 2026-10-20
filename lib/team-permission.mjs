// 队内管理权限判定（共享）：
// 操作者必须是「该队队长」（队长身份限定在对应赛季），或管理员。
// 队长判定：teams.captain_id 指向的选手 == 当前账号绑定的 player_id，
//           且该队伍所属赛季 == 该选手当队长（is_captain=true）的赛季。
import { pool, getTeamInfo } from './db.js';
import { getSession, isAdmin } from './auth.js';

export async function canManageTeam(req, teamId) {
  const team = await getTeamInfo(teamId);
  if (!team) return { allowed: false, reason: '队伍不存在', status: 404 };

  if (isAdmin(req)) return { allowed: true, reason: '', status: 200 };

  const session = getSession(req);
  if (!session) return { allowed: false, reason: '未登录', status: 401 };

  const client = await pool.connect();
  try {
    const acct = await client.query(
      'SELECT player_id FROM public.play_score WHERE name = $1',
      [session.name]
    );
    const playerId = acct.rows[0]?.player_id;
    if (!playerId) return { allowed: false, reason: '账号未绑定选手资料', status: 403 };

    const cap = await client.query(
      `SELECT tp.is_captain
         FROM public.tournament_players tp
        WHERE tp.player_id = $1 AND tp.tournament_id = $2`,
      [playerId, team.tournament_id]
    );
    const isCaptainHere = cap.rows[0]?.is_captain === true;

    if (team.captain_id !== null && String(team.captain_id) === String(playerId) && isCaptainHere) {
      return { allowed: true, reason: '', status: 200 };
    }
    return { allowed: false, reason: '只有本队队长或管理员可管理队伍', status: 403 };
  } finally {
    client.release();
  }
}
