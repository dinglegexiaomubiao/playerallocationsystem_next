/**
 * 后台开黑管理专用接口。
 *
 * 为什么不复用 /api/party/[id]：那个接口限定「只有发起人本人能改状态/删除」，
 * 管理员要维护全群的开黑信息，需要独立的、权限更高的入口。
 *
 * 字段白名单动态拼 SET，避免把 created_at / id 之类误改。
 */
import { getSession, isAdmin } from '../../../lib/auth';
import { pool, ensurePartyTables } from '../../../lib/db';

const TEXT_FIELDS = {
  mode: 20,
  account_name: 60,
  my_rank: 30,
  my_positions: 500,
  want_rank: 30,
  want_positions: 500,
  play_time: 120,
  voice_app: 50,
  note: 500,
  status: 20,
};
const INT_FIELDS = ['my_score', 'want_score_min', 'want_score_max', 'game_id'];
const BOOL_FIELDS = ['has_voice'];

const clip = (v, n) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, n) : null;
};

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: '请先登录' });
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: '仅管理员可访问' });

  try {
    await ensurePartyTables();
  } catch (e) {
    return res.status(500).json({ ok: false, error: '数据库未就绪' });
  }

  const client = await pool.connect();
  try {
    /* ---------------- 列表 ---------------- */
    if (req.method === 'GET') {
      const r = await client.query(`
        SELECT p.*,
               pl.nickname       AS creator_nickname,
               pl.group_nickname AS creator_group_nickname,
               (p.created_at AT TIME ZONE current_setting('TimeZone')) AS created_at_ts,
               (SELECT count(*)::int FROM public.party_signups s WHERE s.post_id = p.id) AS signup_count
          FROM public.party_posts p
          LEFT JOIN public.players pl ON pl.id = p.player_id
         ORDER BY p.created_at DESC
      `);
      return res.status(200).json({ ok: true, posts: r.rows });
    }

    /* ---------------- 修改 ---------------- */
    if (req.method === 'PUT') {
      const body = req.body || {};
      const id = String(body.id || '');
      if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: '缺少有效的 id' });

      const sets = [];
      const vals = [];

      Object.entries(TEXT_FIELDS).forEach(([k, max]) => {
        if (body[k] === undefined) return;
        vals.push(clip(body[k], max));
        sets.push(`${k} = $${vals.length}`);
      });
      INT_FIELDS.forEach((k) => {
        if (body[k] === undefined) return;
        const v = body[k] === '' || body[k] === null ? null : Number(body[k]);
        vals.push(Number.isFinite(v) ? Math.round(v) : null);
        sets.push(`${k} = $${vals.length}`);
      });
      BOOL_FIELDS.forEach((k) => {
        if (body[k] === undefined) return;
        vals.push(!!body[k]);
        sets.push(`${k} = $${vals.length}`);
      });

      if (sets.length === 0) return res.status(400).json({ ok: false, error: '没有要更新的字段' });

      vals.push(id);
      const up = await client.query(
        `UPDATE public.party_posts SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id`,
        vals
      );
      if (up.rowCount === 0) return res.status(404).json({ ok: false, error: '卡片不存在' });
      return res.status(200).json({ ok: true });
    }

    /* ---------------- 删除 ---------------- */
    if (req.method === 'DELETE') {
      const id = String((req.body || {}).id || '');
      if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: '缺少有效的 id' });
      await client.query('DELETE FROM public.party_signups WHERE post_id = $1', [id]);
      const del = await client.query('DELETE FROM public.party_posts WHERE id = $1 RETURNING id', [id]);
      if (del.rowCount === 0) return res.status(404).json({ ok: false, error: '卡片不存在' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('后台开黑管理失败:', error);
    return res.status(500).json({ ok: false, error: '操作失败：' + error.message });
  } finally {
    client.release();
  }
}
