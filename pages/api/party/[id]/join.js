// 开黑报名：POST 报名 / DELETE 取消报名
import { pool, ensurePartyTables } from '../../../../lib/db';
import { getSession, denyIfNotLoggedIn } from '../../../../lib/auth';
import { tierOf } from '../../../../lib/tier.mjs';
import { notifySignupToOwner } from '../../../../lib/mp-notify.mjs';

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
      `SELECT id, player_id, account_name, title, status, start_at, duration_min, voice_app
         FROM public.party_posts WHERE id = $1`,
      [postId]
    );
    if (post.rows.length === 0) {
      return res.status(404).json({ success: false, error: '卡片不存在或已被删除' });
    }
    const p = post.rows[0];

    // 过期判定跟列表接口 shapePost 同一套口径（开始时间 + 持续时长）。
    // 没人手动关的卡片 status 会一直是 'open'，光看 status 会放行「给上周的局报名」。
    const startAt = p.start_at ? new Date(p.start_at) : null;
    const durationMin =
      p.duration_min === null || p.duration_min === undefined ? null : Number(p.duration_min);
    const expired = !!(
      startAt &&
      !isNaN(startAt.getTime()) &&
      durationMin &&
      startAt.getTime() + durationMin * 60000 < Date.now()
    );

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
      // 开局时间已过：再报名没有意义，而且会导致「已报名列表里有个人根本赶不上」
      if (expired) {
        return res
          .status(409)
          .json({ success: false, error: '这张卡片的开局时间已经过了，报名已关闭' });
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

      // 通知发起人：站内信 + （有额度且配好了的话）订阅消息。
      // **故意不 await**：微信接口慢的时候能让报名卡住一两秒，而报名成功与否
      // 不该取决于通知发没发出去。函数内部自己 try/catch，不会漏成未捕获异常。
      // place 是订阅模板的必填字段：开黑没有实体地点，写「线上」+ 语音软件。
      notifySignupToOwner({
        kind: 'party',
        postId,
        ownerAccount: p.account_name,
        postTitle: p.title || session.name + ' 的开黑',
        joinerName: myNickname,
        joinerAccount: session.name,
        place: p.voice_app ? '线上·' + p.voice_app : '线上',
        meetAt: p.start_at || null,
        extra: [rank, b.eta ? '预计 ' + clip(b.eta, 40) : ''].filter(Boolean).join(' / '),
      }).catch((e) => console.error('报名通知发起人失败:', e && e.message));

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
