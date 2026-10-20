// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
// 队内成员管理：加人 / 踢人 / 换人。
// 权限规则（P3）：操作者必须是「该队队长」（队长身份限定在对应赛季），或管理员。
import { addPlayerToTeam, removePlayerFromTeam, updateTeamPlayers } from '../../lib/db';
import { denyIfNotLoggedIn } from '../../lib/auth';
import { canManageTeam } from '../../lib/team-permission.mjs';

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'POST': {
      if (denyIfNotLoggedIn(req, res)) return;
      try {
        const { teamId, playerId, tournament_id } = req.body;
        if (!teamId || !playerId) {
          return res.status(400).json({ success: false, error: '缺少 teamId 或 playerId' });
        }
        const perm = await canManageTeam(req, teamId);
        if (!perm.allowed) {
          return res.status(perm.status).json({ success: false, error: perm.reason });
        }
        await addPlayerToTeam(teamId, playerId, tournament_id);
        res.status(201).json({ success: true, message: '选手添加到队伍成功' });
      } catch (error) {
        console.error('添加选手到队伍错误:', error);
        res.status(500).json({ success: false, error: '添加选手到队伍失败' });
      }
      break;
    }

    case 'DELETE': {
      if (denyIfNotLoggedIn(req, res)) return;
      try {
        const { teamId, playerId, tournament_id } = req.body;
        if (!teamId || !playerId) {
          return res.status(400).json({ success: false, error: '缺少 teamId 或 playerId' });
        }
        const perm = await canManageTeam(req, teamId);
        if (!perm.allowed) {
          return res.status(perm.status).json({ success: false, error: perm.reason });
        }
        await removePlayerFromTeam(teamId, playerId, tournament_id);
        res.status(200).json({ success: true, message: '选手从队伍移除成功' });
      } catch (error) {
        console.error('从队伍移除选手错误:', error);
        res.status(500).json({ success: false, error: '从队伍移除选手失败' });
      }
      break;
    }

    case 'PUT': {
      if (denyIfNotLoggedIn(req, res)) return;
      try {
        const { teamId, playerIds, tournament_id } = req.body;
        if (!teamId) {
          return res.status(400).json({ success: false, error: '缺少 teamId' });
        }
        const perm = await canManageTeam(req, teamId);
        if (!perm.allowed) {
          return res.status(perm.status).json({ success: false, error: perm.reason });
        }
        await updateTeamPlayers(teamId, playerIds || [], tournament_id);
        res.status(200).json({ success: true, message: '队伍选手更新成功' });
      } catch (error) {
        console.error('更新队伍选手错误:', error);
        res.status(500).json({ success: false, error: '更新队伍选手失败' });
      }
      break;
    }

    default:
      res.setHeader('Allow', ['POST', 'PUT', 'DELETE']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}
