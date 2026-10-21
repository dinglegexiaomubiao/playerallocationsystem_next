/**
 * 未登记的参赛账号。
 *
 * 背景：补录比赛时，有些 account_id 打了比赛却没绑定群友 ——
 * 可能是替补、小号，或者单纯没登记过。它们会在赛程里显示成裸账号 + "?" 头像。
 *
 * GET  列出这些账号（场次 / 出现在哪些赛事 / Steam 昵称），标出缺什么
 * POST 补录：
 *        { accountId, playerId }  绑定到已有群友
 *        { accountId, nickname }  新建群友并绑定
 *
 * 只管理员可访问。
 */
import { getSession, isAdminName } from '../../../lib/auth';
import { pool } from '../../../lib/db';

/* Steam 昵称走进程内缓存：后台一进去就拉 5 次 OpenDota 太慢，
   而这些名字几乎不变。进程重启后重新拉，可接受。 */
const nameCache = new Map(); // accountId -> { name, at }
const NAME_TTL = 24 * 60 * 60 * 1000;

async function fetchSteamName(accountId) {
  const hit = nameCache.get(String(accountId));
  if (hit && Date.now() - hit.at < NAME_TTL) return hit.name;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 6000);
    const r = await fetch(`https://api.opendota.com/api/players/${accountId}`, {
      signal: ac.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const d = await r.json();
    const name = d?.profile?.personaname || null;
    if (name) nameCache.set(String(accountId), { name, at: Date.now() });
    return name;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: '请先登录' });
  if (!isAdminName(session.name)) return res.status(403).json({ ok: false, error: '仅管理员可操作' });

  if (req.method === 'GET') {
    const client = await pool.connect();
    try {
      const rows = await client.query(
        `SELECT mp.account_id,
                count(*)::int AS games,
                array_agg(DISTINCT t.name) AS tournaments,
                count(*) FILTER (WHERE mp.is_standin)::int AS standin_games,
                -- 有些人早就绑了 SteamID，只是历史比赛明细漏回填。
                -- 这种不是「未登记」，只需要补关联，不该出现在补录分支里。
                (SELECT json_build_object('id', p.id::text, 'nickname', p.nickname)
                   FROM public.players p
                  WHERE p.game_id = mp.account_id
                  LIMIT 1) AS owner
           FROM public.dota_match_players mp
           JOIN public.matches m ON m.dota_match_id = mp.match_id
           JOIN public.tournaments t ON t.id = m.tournament_id
          WHERE mp.player_id IS NULL
          GROUP BY mp.account_id
          ORDER BY count(*) DESC, mp.account_id`
      );

      // 并发拉昵称，失败不阻塞
      const list = await Promise.all(
        rows.rows.map(async (r) => ({
          account_id: String(r.account_id),
          games: r.games,
          tournaments: r.tournaments || [],
          standin_games: r.standin_games,
          owner: r.owner || null,
          persona_name: await fetchSteamName(r.account_id),
        }))
      );

      // 可绑定的群友名单（供前端下拉）
      const players = await client.query(
        `SELECT id, nickname, group_nickname, game_id
           FROM public.players
          ORDER BY nickname`
      );

      return res.status(200).json({
        ok: true,
        accounts: list,
        players: players.rows.map((p) => ({
          id: String(p.id),
          nickname: p.nickname,
          group_nickname: p.group_nickname,
          game_id: p.game_id ? String(p.game_id) : null,
        })),
      });
    } catch (e) {
      console.error('未登记账号查询失败:', e);
      return res.status(500).json({ ok: false, error: '查询失败' });
    } finally {
      client.release();
    }
  }

  if (req.method === 'POST') {
    const { accountId, playerId, nickname } = req.body || {};
    const acc = String(accountId || '').trim();
    if (!acc) return res.status(400).json({ ok: false, error: '缺少 accountId' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 一号只能绑一个人：先查占用
      const taken = await client.query('SELECT id, nickname, game_id FROM public.players WHERE game_id = $1', [acc]);
      if (taken.rowCount > 0) {
        const owner = taken.rows[0];
        // 传的就是这个号本人 → 说明只是明细漏关联，走回填而不是拒绝
        const isSame = playerId && String(playerId) === String(owner.id);
        if (!isSame) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            ok: false,
            error: `该 Steam 账号已被「${owner.nickname}」绑定。如需修改，请尽快联系 dom 处理。`,
          });
        }
      }

      let targetId = playerId ? String(playerId) : null;

      if (!targetId) {
        // 新建群友：昵称必填，否则页面上还是认不出人
        const nick = String(nickname || '').trim();
        if (!nick) {
          await client.query('ROLLBACK');
          return res.status(400).json({ ok: false, error: '新建群友需要填写昵称' });
        }
        const ins = await client.query(
          `INSERT INTO public.players (nickname, game_id, created_at, updated_at)
           VALUES ($1, $2, $3, $3)
           RETURNING id`,
          [nick, acc, new Date().toISOString()]
        );
        targetId = String(ins.rows[0].id);
      } else {
        // 绑定到已有群友：目标不能再有别的 SteamID，否则等于静默覆盖
        const cur = await client.query('SELECT game_id FROM public.players WHERE id = $1', [targetId]);
        if (cur.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ ok: false, error: '群友不存在' });
        }
        if (cur.rows[0].game_id) {
          // 同一个账号 → 只是回填明细，放行；不同账号才拒绝
          if (String(cur.rows[0].game_id) !== acc) {
            await client.query('ROLLBACK');
            return res.status(409).json({
              ok: false,
              error: '该群友已绑定其它 Steam 账号，多账号绑定请等「常用号」功能上线',
            });
          }
        } else {
          await client.query(
            'UPDATE public.players SET game_id = $1, updated_at = $2 WHERE id = $3',
            [acc, new Date().toISOString(), targetId]
          );
        }
      }

      // 把已抓到的比赛明细回填 player_id，赛程里的裸账号立刻变成昵称
      const backfilled = await client.query(
        `UPDATE public.dota_match_players
            SET player_id = $1
          WHERE account_id = $2 AND player_id IS NULL`,
        [targetId, acc]
      );

      // 顺带补进该赛事的报名名单，避免「打了比赛但报名表里没有」
      const tours = await client.query(
        `SELECT DISTINCT m.tournament_id
           FROM public.dota_match_players mp
           JOIN public.matches m ON m.dota_match_id = mp.match_id
          WHERE mp.account_id = $1`,
        [acc]
      );
      for (const t of tours.rows) {
        await client.query(
          `INSERT INTO public.tournament_players (player_id, tournament_id, signup_status, signed_at)
           SELECT $1, $2, 'approved', CURRENT_TIMESTAMP
            WHERE NOT EXISTS (
              SELECT 1 FROM public.tournament_players WHERE player_id = $1 AND tournament_id = $2
            )`,
          [targetId, t.tournament_id]
        );
      }

      await client.query('COMMIT');
      return res.status(200).json({
        ok: true,
        playerId: targetId,
        backfilled: backfilled.rowCount,
        tournaments: tours.rows.length,
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('补录账号失败:', e);
      return res.status(500).json({ ok: false, error: '补录失败：' + e.message });
    } finally {
      client.release();
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ ok: false, error: `方法 ${req.method} 不被允许` });
}
