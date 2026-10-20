// 开黑报名：POST 报名 / DELETE 取消报名
import { pool, ensurePartyTables } from '../../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../../lib/auth';
import { tierOf } from '../../../../lib/tier.mjs';

const toList = (v) =>
  Array.isArray(v)
    ? v.map((s) => String(s).trim()).filter(Boolean)
    : String(v || '')
        .split(/[，,、\/;；|]/)
        .map((s) => s.trim())
        .filter(Boolean);

const clip = (v, n) => (v === null || v === undefined ? null : String(v).trim().slice(0, n) || null);
const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

export default async function handler(req, res) {
  try {
    await ensurePartyTables();
  } catch (e) {
    console.error('开黑表初始化失败:', e);
    return res.status(500).json({ success: false, error: '数据库未就绪' });
  }

  if (denyIfNotLoggedIn(req, res, '报名需要先登录')) return;
  const session = getSession(req);

  const postId = String(req.query.id || '');
  if (!/^\d+$/.test(postId)) {
    return res.status(400).json({ success: false, error: '卡片不存在' });
  }

  const client = await pool.connect();
  try {
    const post = await client.query(
      'SELECT id, player_id, status FROM public.party_posts WHERE id = $1',
      [postId]
    );
    if (post.rows.length === 0) {
      return res.status(404).json({ success: false, error: '卡片不存在或已被删除' });
    }
    const p = post.rows[0];

    // 报名人自己的选手资料（可能还没绑定）
    const acct = await client.query(
      `SELECT ps.player_id, pl.nickname, pl.group_nickname
         FROM public.play_score ps
         LEFT JOIN public.players pl ON pl.id = ps.player_id
        WHERE ps.name = $1`,
      [session.name]
    );
    const myPlayerId = acct.rows[0]?.player_id ? String(acct.rows[0].player_id) : null;
    const myNickname =
      acct.rows[0]?.nickname || acct.rows[0]?.group_nickname || session.name;

    // ---------- 报名 ----------
    if (req.method === 'POST') {
      if (p.status !== 'open') {
        return res.status(409).json({ success: false, error: '这张卡片已停止招募' });
      }
      if (myPlayerId && String(p.player_id) === myPlayerId) {
        return res.status(400).json({ success: false, error: '这是你自己发起的开黑' });
      }

      const exists = await client.query(
        'SELECT id FROM public.party_signups WHERE post_id = $1 AND account_name = $2',
        [postId, session.name]
      );
      if (exists.rows.length > 0) {
        return res.status(409).json({ success: false, error: '你已经报过名了' });
      }

      const b = req.body || {};
      const score = num(b.score);
      const rank = clip(b.rank, 30) || (score !== null ? tierOf(score).label : null);

      const inserted = await client.query(
        `INSERT INTO public.party_signups
           (post_id, player_id, account_name, nickname, score, rank, positions, eta, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id`,
        [
          postId,
          myPlayerId,
          session.name,
          myNickname,
          score,
          rank,
          toList(b.positions).join(','),
          clip(b.eta, 120),
          clip(b.note, 200),
        ]
      );
      return res.status(200).json({ success: true, id: String(inserted.rows[0].id) });
    }

    // ---------- 取消报名 ----------
    if (req.method === 'DELETE') {
      const del = await client.query(
        'DELETE FROM public.party_signups WHERE post_id = $1 AND account_name = $2',
        [postId, session.name]
      );
      if (del.rowCount === 0) {
        return res.status(404).json({ success: false, error: '没有找到你的报名记录' });
      }
      return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', ['POST', 'DELETE']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  } catch (error) {
    if (error && error.code === '23505') {
      return res.status(409).json({ success: false, error: '你已经报过名了' });
    }
    console.error('开黑报名错误:', error);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  } finally {
    client.release();
  }
}
