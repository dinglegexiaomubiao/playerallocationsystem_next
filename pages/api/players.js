// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { addPlayer, updatePlayer, deletePlayer, getPlayerById } from '../../lib/db';
import { denyIfNotAdmin } from '../../lib/auth';
import { loadPlayerList, clearPlayerListCache } from '../../lib/player-list';

// 列表装配（45s 缓存 + 全员参赛记录聚合 + 多值身份）统一在 lib/player-list.js：
// 页面 SSR 与这个接口共用同一份，避免「直出一套、接口一套」的漂移。
// 任何写操作（POST/PUT/DELETE）以及头像同步都要主动清缓存，否则改完看不到效果。
const clearListCache = clearPlayerListCache;

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      try {
        const { tournament_id } = req.query;
        const { players, cached } = await loadPlayerList({ tournamentId: tournament_id });

        res.setHeader('X-List-Cache', cached ? 'HIT' : 'MISS');
        // 这份数据是「谁改了要立刻看到」的类型，别让手机端拿缓存里的旧结果或空结果
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, players });
      } catch (error) {
        console.error('获取选手列表错误:', error);
        res.status(500).json({ success: false, error: '获取选手列表失败' });
      }
      break;

    case 'POST':
      try {
        // 选手写操作一律限管理员。UI 入口只有两个：/main（页面服务端已限管理员）
        // 与 Excel 批量导入（members 页，管理员功能）。
        // 此前这里只校验 x-excel-import 头，不带该头的 POST / PUT / DELETE 完全对外开放。
        if (denyIfNotAdmin(req, res, '仅管理员可新增选手')) return;
        const { tournament_id, ...playerData } = req.body;
        const newPlayer = await addPlayer(playerData, tournament_id);
        clearListCache();
        res.status(201).json({ success: true, player: newPlayer });
      } catch (error) {
        console.error('创建选手错误:', error);
        // SteamID 被别人占用这类是可修正的输入问题，回 400 并把原因带给前端
        const code = error && error.name === 'IdentityError' ? 400 : 500;
        res.status(code).json({
          success: false,
          error: code === 400 ? error.message : '创建选手失败',
          code: error && error.code,
        });
      }
      break;

    case 'PUT':
      try {
        if (denyIfNotAdmin(req, res, '仅管理员可修改选手资料')) return;
        const { playerId, player: updates, tournament_id } = req.body;

        // 更新选手信息
        await updatePlayer(playerId, updates);
        clearListCache();

        // 获取更新后的选手信息
        const updatedPlayer = await getPlayerById(playerId);
        
        // 如果提供了tournament_id，更新选手与赛季的关联
        if (tournament_id) {
          const client = await pool.connect();
          try {
            // 检查是否已存在关联
            const existing = await client.query(
              'SELECT * FROM public.player_tournament_participations WHERE player_id = $1 AND tournament_id = $2',
              [playerId, tournament_id]
            );
            
            if (existing.rows.length === 0) {
              // 如果不存在关联，则创建新的关联
              await client.query(
                `INSERT INTO public.player_tournament_participations (player_id, tournament_id, created_at)
                 VALUES ($1, $2, $3)`,
                [playerId, tournament_id, new Date().toISOString()]
              );
              // 创建选手赛季参与记录成功
            } else {
              // 选手赛季参与记录已存在
            }
          } finally {
            client.release();
          }
        }
        
        res.status(200).json({ success: true, player: updatedPlayer });
      } catch (error) {
        console.error('更新选手错误:', error);
        const isIdentity = error && error.name === 'IdentityError';
        res.status(isIdentity ? 400 : 500).json({
          success: false,
          error: isIdentity ? error.message : `更新选手失败: ${error.message}`,
          code: error && error.code,
        });
      }
      break;

    case 'DELETE':
      try {
        if (denyIfNotAdmin(req, res, '仅管理员可删除选手')) return;
        const { id } = req.body;
        await deletePlayer(id);
        clearListCache();
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