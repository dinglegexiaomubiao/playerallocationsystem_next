// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { getAllPlayers, addPlayer, updatePlayer, deletePlayer, getPlayersInTeam } from '../../lib/db';

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        // 获取所有选手
        const players = await getAllPlayers();
        // 格式化数据以适应前端需要
        const formattedPlayers = players.map(player => ({
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
          team_name: "unassigned",
          synergyPlayers: []
        }));
        res.status(200).json({ players: formattedPlayers });
      } catch (error) {
        console.error('获取选手列表错误:', error);
        res.status(500).json({ error: '获取选手列表失败' });
      }
      break;

    case 'POST':
      try {
        const player = req.body;
        console.log('收到添加选手请求:', player);
        // 格式化数据以适应数据库结构
        const playerForDB = {
          ...player,
          id: parseInt(player.id),
          game_id: parseInt(player.game_id) || 0,
          score: parseInt(player.score) || 0,
          win_rate: parseInt(player.win_rate) || 0,
          championships: parseInt(player.championships) || 0,
          positions: Array.isArray(player.positions) ? player.positions.join(',') : 
                    typeof player.positions === 'string' ? player.positions : '',
          heroes: Array.isArray(player.heroes) ? player.heroes.join(',') : 
                  typeof player.heroes === 'string' ? player.heroes : '',
          synergy_players: Array.isArray(player.synergy_players) ? player.synergy_players.join(',') : 
                          typeof player.synergy_players === 'string' ? player.synergy_players : '',
          created_at: player.created_at || new Date().toISOString(),
          updated_at: player.updated_at || new Date().toISOString()
        };
        console.log('准备插入的选手数据:', playerForDB);
        await addPlayer(playerForDB);
        res.status(201).json({ message: '选手添加成功' });
      } catch (error) {
        console.error('添加选手错误:', error);
        res.status(500).json({ error: '添加选手失败: ' + error.message });
      }
      break;

    case 'PUT':
      try {
        const { playerId, player } = req.body;
        // 格式化数据以适应数据库结构
        const playerForDB = {
          ...player,
          id: parseInt(playerId),
          game_id: parseInt(player.game_id) || 0,
          score: parseInt(player.score) || 0,
          win_rate: parseInt(player.win_rate) || 0,
          championships: parseInt(player.championships) || 0,
          positions: Array.isArray(player.positions) ? player.positions.join(',') : 
                    typeof player.positions === 'string' ? player.positions : '',
          heroes: Array.isArray(player.heroes) ? player.heroes.join(',') : 
                  typeof player.heroes === 'string' ? player.heroes : '',
          synergy_players: Array.isArray(player.synergy_players) ? player.synergy_players.join(',') : 
                          typeof player.synergy_players === 'string' ? player.synergy_players : '',
          updated_at: new Date().toISOString()
        };
        await updatePlayer(playerId, playerForDB);
        res.status(200).json({ message: '选手更新成功' });
      } catch (error) {
        console.error('更新选手错误:', error);
        res.status(500).json({ error: '更新选手失败: ' + error.message });
      }
      break;

    case 'DELETE':
      try {
        const { playerId } = req.body;
        await deletePlayer(playerId);
        res.status(200).json({ message: '选手删除成功' });
      } catch (error) {
        console.error('删除选手错误:', error);
        res.status(500).json({ error: '删除选手失败: ' + error.message });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}