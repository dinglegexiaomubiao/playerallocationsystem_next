// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { addPlayerToTeam, removePlayerFromTeam, updateTeamPlayers } from '../../lib/db';

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'POST':
      try {
        const { teamId, playerId } = req.body;
        await addPlayerToTeam(teamId, playerId);
        res.status(201).json({ message: '选手添加到队伍成功' });
      } catch (error) {
        console.error('添加选手到队伍错误:', error);
        res.status(500).json({ error: '添加选手到队伍失败' });
      }
      break;

    case 'DELETE':
      try {
        const { teamId, playerId } = req.body;
        await removePlayerFromTeam(teamId, playerId);
        res.status(200).json({ message: '选手从队伍移除成功' });
      } catch (error) {
        console.error('从队伍移除选手错误:', error);
        res.status(500).json({ error: '从队伍移除选手失败' });
      }
      break;

    case 'PUT':
      try {
        const { teamId, playerIds } = req.body;
        await updateTeamPlayers(teamId, playerIds);
        res.status(200).json({ message: '队伍选手更新成功' });
      } catch (error) {
        console.error('更新队伍选手错误:', error);
        res.status(500).json({ error: '更新队伍选手失败' });
      }
      break;

    default:
      res.setHeader('Allow', ['POST', 'PUT', 'DELETE']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}