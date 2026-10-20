/**
 * Steam 头像批量同步：/api/avatars/sync
 *
 * 为什么要单独做批量接口，而不是在列表接口里顺手抓：
 * OpenDota 免费额度约 60 次/分钟，68 个选手一次性抓完必然触发限流，
 * 而列表接口又必须快。所以拆成「批量预热 + 列表只读缓存」两件事。
 *
 * GET  → 只读统计，不触发任何外网请求
 * POST → 抓一批（默认 12 个）并落库，前端循环调用直到 done
 *
 * 缓存口径：players.avatar_url + avatar_synced_at（7 天视为新鲜）。
 * 想强制重抓全部就传 { force: true }。
 */
import { pool, ensureAvatarColumns } from '../../../lib/db';
import { denyIfNotAdmin } from '../../../lib/auth';
import { fetchPlayerProfile, normalizeAccountId } from '../../../lib/steam';
import listCache from '../../../lib/list-cache';

const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
// 批量路径显式限速：约 55 次/分钟，留在 OpenDota 免费额度内
const DELAY_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SELECT_PENDING = `
  SELECT id, nickname, game_id
    FROM public.players
   WHERE game_id IS NOT NULL
     AND ($1::boolean OR avatar_synced_at IS NULL OR avatar_synced_at < NOW() - ($2::int * INTERVAL '1 millisecond'))
   ORDER BY avatar_synced_at NULLS FIRST, id
   LIMIT $3
`;

export default async function handler(req, res) {
  try {
    await ensureAvatarColumns();

    if (req.method === 'GET') {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE avatar_url IS NOT NULL)::int AS synced,
          COUNT(*) FILTER (WHERE avatar_url IS NULL)::int AS missing,
          COUNT(*) FILTER (
            WHERE avatar_url IS NOT NULL AND avatar_synced_at > NOW() - ($1::int * INTERVAL '1 millisecond')
          )::int AS fresh,
          MAX(avatar_synced_at) AS last_synced_at
        FROM public.players
      `, [FRESH_MS]);
      const s = rows[0] || {};
      return res.status(200).json({
        success: true,
        total: s.total || 0,
        synced: s.synced || 0,
        missing: s.missing || 0,
        fresh: s.fresh || 0,
        stale: (s.synced || 0) - (s.fresh || 0),
        pending: (s.total || 0) - (s.fresh || 0),
        last_synced_at: s.last_synced_at || null,
      });
    }

    if (req.method === 'POST') {
      if (denyIfNotAdmin(req, res)) return;

      const limit = Math.min(Math.max(parseInt(req.body && req.body.limit, 10) || 12, 1), 30);
      const force = Boolean(req.body && req.body.force);

      const { rows: targets } = await pool.query(SELECT_PENDING, [force, FRESH_MS, limit]);
      if (!targets.length) {
        return res.status(200).json({ success: true, updated: 0, failed: 0, remaining: 0, done: true });
      }

      let updated = 0;
      let failed = 0;
      const failures = [];

      // 串行 + 间隔，别把额度打穿
      for (let i = 0; i < targets.length; i += 1) {
        const p = targets[i];
        const acc = normalizeAccountId(p.game_id);
        if (!acc) {
          failed += 1;
          failures.push({ id: String(p.id), nickname: p.nickname, reason: 'game_id 非法' });
          continue;
        }
        const profile = await fetchPlayerProfile(acc);
        if (profile) {
          await pool.query(
            `UPDATE public.players
                SET avatar_url = $1, steam_name = $2, avatar_synced_at = NOW()
              WHERE id = $3`,
            [profile.avatarfull, profile.personaname, p.id]
          );
          updated += 1;
        } else {
          failed += 1;
          // 抓不到也盖个时间戳，避免下一轮立刻又撞同一个失败者
          await pool.query(
            'UPDATE public.players SET avatar_synced_at = NOW() WHERE id = $1',
            [p.id]
          );
          failures.push({ id: String(p.id), nickname: p.nickname, reason: '未取到公开资料' });
        }
        if (i < targets.length - 1) await sleep(DELAY_MS);
      }

      const { rows: left } = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM public.players
          WHERE game_id IS NOT NULL
            AND ($1::boolean OR avatar_synced_at IS NULL OR avatar_synced_at < NOW() - ($2::int * INTERVAL '1 millisecond'))`,
        [force, FRESH_MS]
      );
      const remaining = (left[0] && left[0].n) || 0;

      // 列表缓存里存的是旧的 avatar 字段（null），不清掉用户要等 45s 才能看到头像
      if (updated > 0) listCache.clear('playersList');

      return res.status(200).json({
        success: true,
        updated,
        failed,
        remaining,
        done: remaining === 0,
        failures: failures.slice(0, 10),
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (error) {
    console.error('[avatars/sync] 失败:', error.message);
    return res.status(500).json({ success: false, error: '同步头像失败' });
  }
}
