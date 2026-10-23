// 活动卡片：PATCH 改状态（关闭 / 重新招募）/ DELETE 删除
// 只有发起人本人能操作，避免别人替你关掉还在招募的活动。
import { pool, ensureActivityTables } from '../../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../../lib/auth';
import { ACTIVITY_STATUS } from '../../../../lib/options.mjs';

const STATUS_KEYS = Object.keys(ACTIVITY_STATUS);

export default async function handler(req, res) {
  try {
    await ensureActivityTables();
  } catch (e) {
    console.error('活动表初始化失败:', e);
    return res.status(500).json({ success: false, error: '数据库未就绪' });
  }

  if (denyIfNotLoggedIn(req, res, '操作活动卡片需要先登录')) return;
  const session = getSession(req);

  const postId = String(req.query.id || '');
  if (!/^\d+$/.test(postId)) {
    return res.status(400).json({ success: false, error: '活动不存在' });
  }

  const client = await pool.connect();
  try {
    const own = await client.query(
      `SELECT p.id, p.account_name
         FROM public.activity_posts p
        WHERE p.id = $1`,
      [postId]
    );
    if (own.rows.length === 0) {
      return res.status(404).json({ success: false, error: '活动不存在或已被删除' });
    }
    // account_name 是创建时记下的登录名，权限判断用它，不看 player_id（可能被换绑）
    if (own.rows[0].account_name !== session.name) {
      return res.status(403).json({ success: false, error: '只有发起人可以操作这个活动' });
    }

    if (req.method === 'PATCH') {
      const status = String((req.body || {}).status || '');
      if (!STATUS_KEYS.includes(status)) {
        return res.status(400).json({ success: false, error: '状态不合法' });
      }
      await client.query('UPDATE public.activity_posts SET status = $2 WHERE id = $1', [
        postId,
        status,
      ]);
      return res.status(200).json({
        success: true,
        status,
        statusLabel: ACTIVITY_STATUS[status].label,
      });
    }

    if (req.method === 'DELETE') {
      await client.query('DELETE FROM public.activity_signups WHERE post_id = $1', [postId]);
      await client.query('DELETE FROM public.activity_posts WHERE id = $1', [postId]);
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', ['PATCH', 'DELETE']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    console.error('活动卡片操作错误:', error);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  } finally {
    client.release();
  }
}
