// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { getAllTeams, getPlayersInTeam, addTeam, updateTeam, updateTeamRank, deleteTeam } from '../../lib/db';
import { denyIfNotLoggedIn, denyIfNotAdmin } from '../../lib/auth';
import { canManageTeam } from '../../lib/team-permission.mjs';
import { checkText, LIMITS } from '../../lib/moderation.mjs';

// 队名合规初筛 + 截断
const checkTeamName = (name, res) => {
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ success: false, error: '请填写队伍名称' });
    return false;
  }
  const hit = checkText(name);
  if (!hit.ok) {
    res.status(400).json({ success: false, error: `队伍名称里检测到不合适的内容（${hit.category}），请修改后再提交` });
    return false;
  }
  return true;
};

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        let teams;
        const { tournament_id } = req.query;
        
        if (tournament_id) {
          const result = await getAllTeams(tournament_id);
          teams = result;
        } else {
          teams = await getAllTeams();
        }
        
        const formattedTeams = await Promise.all(teams.map(async (team) => {
          const playersInTeam = await getPlayersInTeam(team.id, tournament_id);
          const formattedPlayers = playersInTeam.map(player => {
            // 队伍是「本届参赛阵容」，位置与分数以报名快照为准；
            // 没确认过快照的（历史导入）回退到档案值。
            // profile_* 保留档案原值，前端用于提示差异。
            const snapScore = player.signup_score !== null && player.signup_score !== undefined
              ? parseInt(player.signup_score, 10) || 0
              : null;
            const snapPositions = player.signup_positions
              ? String(player.signup_positions).split(',').filter(p => p)
              : null;
            const profPositions = player.positions ? String(player.positions).split(',').filter(p => p) : [];
            return {
              ...player,
              id: player.id?.toString(),
              game_id: player.game_id?.toString(),
              score: snapScore !== null ? snapScore : (player.score ? parseInt(player.score) : 0),
              profile_score: player.score ? parseInt(player.score) : 0,
              positions: snapPositions || profPositions,
              profile_positions: profPositions,
              win_rate: player.win_rate ? parseInt(player.win_rate) : 0,
              championships: player.championships ? parseInt(player.championships) : 0,
              heroes: player.heroes ? player.heroes.split(',').filter(h => h) : [],
              synergy_players: player.synergy_players ? player.synergy_players.split(',').filter(sp => sp) : [],
              enemies: player.enemies ? player.enemies.split(',').filter(e => e) : [],
              created_at: player.created_at || "",
              updated_at: player.updated_at || "",
              position_priority: {},
              team_name: team.name,
              team_position: player.team_position || null,
              synergyPlayers: []
            };
          });

          return {
            ...team,
            id: team.id,
            players: formattedPlayers,
            created_at: team.created_at || new Date().toISOString(),
            updated_at: team.updated_at || new Date().toISOString()
          };
        }));

        res.status(200).json({ success: true, teams: formattedTeams });
      } catch (error) {
        console.error('获取队伍列表错误:', error);
        res.status(500).json({ success: false, error: '获取队伍列表失败' });
      }
      break;

    case 'POST':
      if (denyIfNotLoggedIn(req, res)) return;
      try {
        const { name, tournament_id, created_at, updated_at } = req.body;
        if (!checkTeamName(name, res)) return;
        const newTeam = await addTeam({ name: [...name].slice(0, LIMITS.teamName).join(''), created_at, updated_at }, tournament_id);
        res.status(201).json({ success: true, team: newTeam });
      } catch (error) {
        console.error('创建队伍错误:', error);
        res.status(500).json({ success: false, error: `创建队伍失败: ${error.message}` });
      }
      break;

    case 'PUT':
      if (denyIfNotLoggedIn(req, res)) return;
      try {
        const { id, ...updates } = req.body;
        if (!id) {
          return res.status(400).json({ success: false, error: '缺少队伍ID' });
        }
        const perm = await canManageTeam(req, id);
        if (!perm.allowed) {
          return res.status(perm.status).json({ success: false, error: perm.reason });
        }
        // 更新队伍名次（rank）
        if (updates.rank !== undefined) {
          await updateTeamRank(id, updates.rank);
          return res.status(200).json({ success: true, message: '队伍名次已更新' });
        }
        if (updates.name !== undefined && !checkTeamName(updates.name, res)) return;
        await updateTeam(id, { ...updates, updated_at: new Date().toISOString() });
        res.status(200).json({ success: true, message: '更新队伍成功' });
      } catch (error) {
        console.error('更新队伍错误:', error);
        res.status(500).json({ success: false, error: '更新队伍失败' });
      }
      break;

    case 'DELETE':
      if (denyIfNotAdmin(req, res, '仅管理员可删除队伍')) return;
      try {
        const { id, teamId } = req.body;
        const targetId = id || teamId;
        if (!targetId) {
          return res.status(400).json({ success: false, error: '缺少队伍ID' });
        }
        await deleteTeam(targetId);
        res.status(200).json({ success: true, message: '删除队伍成功' });
      } catch (error) {
        console.error('删除队伍错误:', error);
        res.status(500).json({ success: false, error: '删除队伍失败' });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}
