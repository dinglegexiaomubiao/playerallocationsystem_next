// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { getAllTeams, addTeam, updateTeam, deleteTeam, getPlayersInTeam, updateTeamPlayers } from '../../lib/db';

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        // 获取所有队伍
        const teams = await getAllTeams();
        // 获取每个队伍中的选手
        const formattedTeams = await Promise.all(teams.map(async (team) => {
          const playersInTeam = await getPlayersInTeam(team.id);
          // 格式化选手数据
          const formattedPlayers = playersInTeam.map(player => ({
            ...player,
            id: player.id?.toString(),
            game_id: player.game_id?.toString(),
            score: player.score ? parseInt(player.score) : 0,
            win_rate: player.win_rate ? parseInt(player.win_rate) : 0,
            championships: player.championships ? parseInt(player.championships) : 0,
            positions: player.positions ? player.positions.split(',').filter(p => p) : [],
            heroes: player.heroes ? player.heroes.split(',').filter(h => h) : [],
            synergy_players: player.synergy_players ? player.synergy_players.split(',').filter(sp => sp) : [],
            created_at: player.created_at || "",
            updated_at: player.updated_at || "",
            position_priority: {},
            team_name: team.name,
            synergyPlayers: []
          }));

          return {
            ...team,
            id: team.id,
            players: formattedPlayers,
            created_at: team.created_at || new Date().toISOString(),
            updated_at: team.updated_at || new Date().toISOString()
          };
        }));

        res.status(200).json({ teams: formattedTeams });
      } catch (error) {
        console.error('获取队伍列表错误:', error);
        res.status(500).json({ error: '获取队伍列表失败' });
      }
      break;

    case 'POST':
      try {
        const team = req.body;
        await addTeam(team);
        res.status(201).json({ message: '队伍添加成功', team });
      } catch (error) {
        console.error('添加队伍错误:', error);
        res.status(500).json({ error: '添加队伍失败' });
      }
      break;

    case 'PUT':
      try {
        const { teamId, team, playerIds } = req.body;
        // 如果有队伍信息需要更新
        if (team) {
          const teamForDB = {
            ...team,
            updated_at: new Date().toISOString()
          };
          await updateTeam(teamId, teamForDB);
        }
        
        // 如果有选手列表需要更新
        if (playerIds) {
          await updateTeamPlayers(teamId, playerIds);
        }
        
        res.status(200).json({ message: '队伍更新成功' });
      } catch (error) {
        console.error('更新队伍错误:', error);
        res.status(500).json({ error: '更新队伍失败' });
      }
      break;

    case 'DELETE':
      try {
        const { teamId } = req.body;
        await deleteTeam(teamId);
        res.status(200).json({ message: '队伍删除成功' });
      } catch (error) {
        console.error('删除队伍错误:', error);
        res.status(500).json({ error: '删除队伍失败' });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}