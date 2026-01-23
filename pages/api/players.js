// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { getAllPlayers, addPlayer, updatePlayer, deletePlayer, pool } from '../../lib/db';

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        const { tournament_id } = req.query;
        let players = await getAllPlayers(tournament_id);
        
        // 格式化选手数据
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
          position_priority: {}
        }));

        res.status(200).json({ success: true, players: formattedPlayers });
      } catch (error) {
        console.error('获取选手列表错误:', error);
        res.status(500).json({ success: false, error: '获取选手列表失败' });
      }
      break;

    case 'POST':
      try {
        const { tournament_id, ...playerData } = req.body;
        const newPlayer = await addPlayer(playerData, tournament_id);
        res.status(201).json({ success: true, player: newPlayer });
      } catch (error) {
        console.error('创建选手错误:', error);
        res.status(500).json({ success: false, error: '创建选手失败' });
      }
      break;

    case 'PUT':
      try {
        const { id, tournament_id, ...updates } = req.body;
        const updatedPlayer = await updatePlayer(id, updates);
        
        // 如果提供了tournament_id，更新选手与赛季的关联
        if (tournament_id) {
          const client = await pool.connect();
          try {
            // 检查是否已存在关联
            const existing = await client.query(
              'SELECT * FROM public.player_tournament_participations WHERE player_id = $1 AND tournament_id = $2',
              [id, tournament_id]
            );
            
            if (existing.rows.length === 0) {
              // 如果不存在关联，则创建新的关联
              await client.query(
                `INSERT INTO public.player_tournament_participations (player_id, tournament_id, created_at)
                 VALUES ($1, $2, $3)`,
                [id, tournament_id, new Date().toISOString()]
              );
            }
          } finally {
            client.release();
          }
        }
        
        res.status(200).json({ success: true, player: updatedPlayer });
      } catch (error) {
        console.error('更新选手错误:', error);
        res.status(500).json({ success: false, error: '更新选手失败' });
      }
      break;

    case 'DELETE':
      try {
        const { id } = req.body;
        await deletePlayer(id);
        res.status(200).json({ success: true, message: '选手删除成功' });
      } catch (error) {
        console.error('删除选手错误:', error);
        res.status(500).json({ success: false, error: '删除选手失败' });
      }
      break;

    default:
      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}