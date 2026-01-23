// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { getAllTeams, getPlayersInTeam, addTeam, updateTeam, deleteTeam, addTeamToTournament } from '../../lib/db';

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        // 获取所有队伍
        let teams;
        const { tournament_id } = req.query;
        
        if (tournament_id) {
          // 如果指定了tournament_id，则只获取该赛季的队伍
          const result = await getAllTeams(tournament_id);
          teams = result;
        } else {
          // 否则获取所有队伍
          teams = await getAllTeams();
        }
        
        // 获取每个队伍中的选手
        const formattedTeams = await Promise.all(teams.map(async (team) => {
          const playersInTeam = await getPlayersInTeam(team.id, tournament_id);
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

        res.status(200).json({ success: true, teams: formattedTeams });
      } catch (error) {
        console.error('获取队伍列表错误:', error);
        res.status(500).json({ success: false, error: '获取队伍列表失败' });
      }
      break;

    case 'POST':
      try {
        const { tournament_id, ...teamData } = req.body;
        
        // 如果没有提供tournament_id，则返回错误
        if (!tournament_id) {
          return res.status(400).json({ success: false, error: '缺少必要参数: tournament_id' });
        }
        
        const newTeam = await addTeam(teamData, tournament_id);
        
        // 将队伍与该赛季关联
        await addTeamToTournament(newTeam.id, tournament_id);
        
        res.status(201).json({ success: true, team: newTeam });
      } catch (error) {
        console.error('创建队伍错误:', error);
        res.status(500).json({ success: false, error: '创建队伍失败' });
      }
      break;

    case 'PUT':
      try {
        const { id, tournament_id, ...updates } = req.body;
        const updatedTeam = await updateTeam(id, updates);
        res.status(200).json({ success: true, team: updatedTeam });
      } catch (error) {
        console.error('更新队伍错误:', error);
        res.status(500).json({ success: false, error: '更新队伍失败' });
      }
      break;

    case 'DELETE':
      try {
        const { id } = req.body;
        await deleteTeam(id);
        res.status(200).json({ success: true, message: '队伍删除成功' });
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