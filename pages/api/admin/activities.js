/**
 * 后台活动招募管理专用接口（镜像 api/admin/party.js 的设计）。
 *
 * 为什么不复用 /api/activities/[id]：那个接口限定「只有发起人本人能关帖/删帖」，
 * 管理员要维护全群的活动信息，需要独立的、权限更高的入口。
 *
 * 文本字段走 moderation 合规初筛；超长自动截断。
 */
import { getSession, isAdmin } from '../../../lib/auth';
import { pool, ensureActivityTables } from '../../../lib/db';
import { checkText, LIMITS } from '../../../lib/moderation.mjs';

const TEXT_FIELDS = {
  title: LIMITS.title,
  type: 20,
  status: 20,
  region: LIMITS.region,
  location: LIMITS.location,
  cost: 40,
  note: LIMITS.note,
};
const INT_FIELDS = ['need_people', 'duration_min'];

const clip = (v, n) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? [...s].slice(0, n).join('') : null;
};

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: '请先登录' });
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: '仅管理员可访问' });

  try {
    await ensureActivityTables();
  } catch (e) {
    return res.status(500).json({ ok: false, error: '数据库未就绪' });
  }

  const client = await pool.connect();
  try {
    /* ---------------- 列表 ---------------- */
    if (req.method === 'GET') {
      const r = await client.query(`
        SELECT a.*,
               pl.nickname       AS creator_nickname,
               pl.group_nickname AS creator_group_nickname,
               (a.created_at AT TIME ZONE current_setting('TimeZone')) AS created_at_ts,
               (a.meet_at    AT TIME ZONE current_setting('TimeZone')) AS meet_at_ts,
               (SELECT COALESCE(SUM(1 + s.guests), 0)::int FROM public.activity_signups s WHERE s.post_id = a.id) AS joined_people,
               (SELECT count(*)::int FROM public.activity_signups s WHERE s.post_id = a.id) AS signup_count
          FROM public.activity_posts a
          LEFT JOIN public.players pl ON pl.id = a.player_id
         ORDER BY a.created_at DESC
      `);
      const now = Date.now();
      const posts = r.rows.map((p) => {
        let expired = false;
        if (p.meet_at && p.duration_min) {
          expired = new Date(p.meet_at).getTime() + p.duration_min * 60000 < now;
        } else if (p.meet_at) {
          expired = new Date(p.meet_at).getTime() < now;
        }
        return { ...p, expired };
      });
      return res.status(200).json({ ok: true, posts });
    }

    /* ---------------- 修改 ---------------- */
    if (req.method === 'PUT') {
      const body = req.body || {};
      const id = String(body.id || '');
      if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: '缺少有效的 id' });

      const sets = [];
      const vals = [];

      // 文本字段：合规初筛 + 截断
      for (const [k, max] of Object.entries(TEXT_FIELDS)) {
        if (body[k] === undefined) continue;
        const v = clip(body[k], max);
        if (v) {
          const hit = checkText(v);
          if (!hit.ok) {
            return res.status(400).json({ ok: false, error: `「${k === 'title' ? '标题' : k === 'note' ? '备注' : k === 'location' ? '地点' : k}」里检测到不合适的内容（${hit.category}），请修改后再保存` });
          }
        }
        vals.push(v);
        sets.push(`${k} = $${vals.length}`);
      }
      INT_FIELDS.forEach((k) => {
        if (body[k] === undefined) return;
        const v = body[k] === '' || body[k] === null ? null : Number(body[k]);
        vals.push(Number.isFinite(v) ? Math.round(v) : null);
        sets.push(`${k} = $${vals.length}`);
      });
      // 集合时间：传 ISO 串或 null（清空）
      if (body.meet_at !== undefined) {
        const v = body.meet_at ? new Date(body.meet_at) : null;
        if (body.meet_at && isNaN(v.getTime())) {
          return res.status(400).json({ ok: false, error: '集合时间格式不正确' });
        }
        vals.push(v);
        sets.push(`meet_at = $${vals.length}`);
      }

      if (sets.length === 0) return res.status(400).json({ ok: false, error: '没有要更新的字段' });

      vals.push(id);
      const up = await client.query(
        `UPDATE public.activity_posts SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id`,
        vals
      );
      if (up.rowCount === 0) return res.status(404).json({ ok: false, error: '活动不存在' });
      return res.status(200).json({ ok: true });
    }

    /* ---------------- 删除 ---------------- */
    if (req.method === 'DELETE') {
      const id = String((req.body || {}).id || '');
      if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, error: '缺少有效的 id' });
      await client.query('DELETE FROM public.activity_signups WHERE post_id = $1', [id]);
      const del = await client.query('DELETE FROM public.activity_posts WHERE id = $1 RETURNING id', [id]);
      if (del.rowCount === 0) return res.status(404).json({ ok: false, error: '活动不存在' });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('后台活动管理失败:', error);
    return res.status(500).json({ ok: false, error: '操作失败：' + error.message });
  } finally {
    client.release();
  }
}
