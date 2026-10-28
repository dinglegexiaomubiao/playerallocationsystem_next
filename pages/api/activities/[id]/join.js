// 活动报名：POST 报名（含携伴人数）/ DELETE 取消报名
import { pool, ensureActivityTables } from '../../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../../lib/auth';
import { notifySignupToOwner } from '../../../../lib/mp-notify.mjs';

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};
const clip = (v, n) =>
  v === null || v === undefined ? null : String(v).trim().slice(0, n) || null;

export default async function handler(req, res) {
  try {
    await ensureActivityTables();
  } catch (e) {
    console.error('活动表初始化失败:', e);
    return res.status(500).json({ success: false, error: '数据库未就绪' });
  }

  if (denyIfNotLoggedIn(req, res, '报名需要先登录')) return;
  const session = getSession(req);

  const postId = String(req.query.id || '');
  if (!/^\d+$/.test(postId)) {
    return res.status(400).json({ success: false, error: '活动不存在' });
  }

  const client = await pool.connect();
  try {
    const post = await client.query(
      `SELECT id, player_id, account_name, title, type, status, region, location, meet_at
         FROM public.activity_posts WHERE id = $1`,
      [postId]
    );
    if (post.rows.length === 0) {
      return res.status(404).json({ success: false, error: '活动不存在或已被删除' });
    }
    const p = post.rows[0];

    // 报名人自己的选手资料（可能还没绑定，活动不要求绑定）
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
        return res.status(409).json({ success: false, error: '这个活动已停止招募' });
      }
      if (myPlayerId && String(p.player_id) === myPlayerId) {
        return res.status(400).json({ success: false, error: '这是你自己发起的活动' });
      }

      const exists = await client.query(
        'SELECT id FROM public.activity_signups WHERE post_id = $1 AND account_name = $2',
        [postId, session.name]
      );
      if (exists.rows.length > 0) {
        return res.status(409).json({ success: false, error: '你已经报过名了' });
      }

      const b = req.body || {};
      // 携伴人数：自己至少 1 人，最多带 20 人（避免有人填个 999 把名额吃光）
      const guests = num(b.guests) || 0;
      if (guests > 20) {
        return res.status(400).json({ success: false, error: '携伴人数最多 20 人' });
      }

      const inserted = await client.query(
        `INSERT INTO public.activity_signups
           (post_id, player_id, account_name, nickname, guests, note)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`,
        [postId, myPlayerId, session.name, myNickname, guests, clip(b.note, 200)]
      );

      // 通知发起人。和开黑报名同一套：站内信必写，订阅消息有额度才发，
      // 不 await —— 报名响应速度不该被微信接口拖住。
      // place 是模板必填项，线下活动优先用具体集合地点，退而用地区。
      notifySignupToOwner({
        kind: 'activity',
        postId,
        ownerAccount: p.account_name,
        postTitle: p.title || p.type + ' 活动',
        joinerName: myNickname,
        joinerAccount: session.name,
        place: p.location || p.region || '群内',
        meetAt: p.meet_at || null,
        extra: guests ? '带 ' + guests + ' 人' : '',
      }).catch((e) => console.error('活动报名通知发起人失败:', e && e.message));

      return res.status(200).json({ success: true, id: String(inserted.rows[0].id) });
    }

    // ---------- 取消报名 ----------
    if (req.method === 'DELETE') {
      const del = await client.query(
        'DELETE FROM public.activity_signups WHERE post_id = $1 AND account_name = $2',
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
    console.error('活动报名错误:', error);
    return res.status(500).json({ success: false, error: '服务器内部错误' });
  } finally {
    client.release();
  }
}
