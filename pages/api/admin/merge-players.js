/**
 * 重复群友的识别与合并（管理员专用）。
 *
 * 背景：群友既有「Excel 导入」生成的记录，也有「报名 / 赛程补录」时自动建的记录，
 * 同一个人很容易留下两条：一条有 SteamID、一条只有昵称（或 SteamID 差一位）。
 * 站内之前没有任何合并能力，只能眼看两个「CatU」各在各的队里。
 *
 * GET  列出疑似重复的分组（同昵称 / 同群昵称 / 昵称=对方群昵称 / 同 SteamID），
 *      每组带画像：SteamID、分数、位置、报名次数、入队次数、比赛场次、登录账号。
 * POST 合并：{ keepId, dropId, gameIdFrom? }
 *      keep 留下，drop 的所有引用改指 keep，然后删掉 drop。
 *
 * 安全约定：
 *   - keepId / dropId 一律按**字符串**处理。players.id 是 bigint，历史导入的 id
 *     形如 17830494047652325，已超过 JS 安全整数范围，用 Number 会静默丢精度。
 *   - 两边都有登录账号（play_score）时拒绝合并：登录凭据不能猜，交人工处理。
 *   - 两边 SteamID 不同且都非空时，必须显式传 gameIdFrom（'keep' | 'drop'），
 *     绝不静默丢弃其中一个。
 *   - 全程单事务，任何一步失败整体回滚。
 */
import { denyIfNotAdmin } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { ensureIdentityTables, syncPrimary } from '../../../lib/player-identity';
import listCache from '../../../lib/list-cache';

// 这些表直接把 player_id 改指 keep；有唯一约束的另外处理去重
const SIMPLE_TABLES = ['dota_match_players', 'party_posts', 'party_signups'];

// 「空的」判定：贴边的空串、0 分都算没填，合并时用另一边的值补
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

const pickFilled = (keepVal, dropVal) => (isBlank(keepVal) ? dropVal : keepVal);
const pickScore = (keepVal, dropVal) => {
  const k = Number(keepVal);
  const d = Number(dropVal);
  if (!Number.isFinite(k) || k <= 0) return Number.isFinite(d) && d > 0 ? d : keepVal;
  return keepVal;
};

async function loadGroups(client) {
  // 四类匹配信号，最后并成一组组
  const [sameNick, sameGroup, crossed, sameSteam] = await Promise.all([
    client.query(
      `SELECT array_agg(id::text ORDER BY id) AS ids, '昵称相同' AS reason
         FROM public.players
        WHERE coalesce(btrim(nickname), '') <> ''
          AND length(nickname) <= 50
        GROUP BY lower(regexp_replace(btrim(nickname), '\\s+', '', 'g'))
       HAVING count(*) > 1`
    ),
    client.query(
      `SELECT array_agg(id::text ORDER BY id) AS ids, '群昵称相同' AS reason
         FROM public.players
        WHERE coalesce(btrim(group_nickname), '') <> ''
        GROUP BY lower(regexp_replace(btrim(group_nickname), '\\s+', '', 'g'))
       HAVING count(*) > 1`
    ),
    client.query(
      `SELECT array_agg(DISTINCT a.id::text || ',' || b.id::text) AS pairs
         FROM public.players a
         JOIN public.players b
           ON lower(regexp_replace(btrim(a.nickname), '\\s+', '', 'g'))
            = lower(regexp_replace(btrim(b.group_nickname), '\\s+', '', 'g'))
        WHERE a.id <> b.id AND coalesce(btrim(a.nickname), '') <> ''`
    ),
    client.query(
      `SELECT array_agg(id::text ORDER BY id) AS ids, 'SteamID 相同' AS reason
         FROM public.players
        WHERE game_id IS NOT NULL AND btrim(game_id::text) <> ''
        GROUP BY game_id
       HAVING count(*) > 1`
    ),
  ]);

  // 并查集：把「有重叠的候选组」并成一组，避免同一个重复出现在多组里
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let p = parent.get(x);
    while (p !== parent.get(p)) p = parent.get(p);
    parent.set(x, p);
    return p;
  };
  const union = (a, b) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };

  const reasons = new Map(); // root → Set(reason)
  const addSet = (ids, reason) => {
    if (!ids || ids.length < 2) return;
    const head = ids[0];
    ids.forEach((id) => {
      union(id, head);
      if (!reasons.has(id)) reasons.set(id, new Set());
      reasons.get(id).add(reason);
    });
  };

  sameNick.rows.forEach((r) => addSet(r.ids, '昵称相同'));
  sameGroup.rows.forEach((r) => addSet(r.ids, '群昵称相同'));
  sameSteam.rows.forEach((r) => addSet(r.ids, 'SteamID 相同'));

  // 交叉匹配（A.nickname = B.group_nickname）单拎出来：这个信号很弱，
  // 「老刘」这种群里同时是别人的昵称也常见，只作为**建议**不自动成组。
  const crossIds = new Set();
  (crossed.rows[0]?.pairs || []).forEach((p) => String(p).split(',').forEach((id) => crossIds.add(id)));

  const byRoot = new Map();
  parent.forEach((_, id) => {
    const root = find(id);
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(id);
  });

  const groups = [...byRoot.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => {
      const rs = new Set();
      ids.forEach((id) => (reasons.get(id) || []).forEach((r) => rs.add(r)));
      if ([...ids].some((id) => crossIds.has(id))) rs.add('昵称与群昵称交叉命中');
      return { ids, reason: [...rs].join(' / ') };
    });

  if (groups.length === 0) return [];

  // 一次把所有涉及的选手画像查出来，避免按组循环查库
  const allIds = groups.flatMap((g) => g.ids);
  const profile = await client.query(
    `SELECT p.id::text AS id, p.nickname, p.group_nickname, p.game_id::text AS game_id,
            p.score, p.positions, p.region, p.created_at,
            (SELECT count(*)::int FROM public.tournament_players tp WHERE tp.player_id = p.id) AS signups,
            (SELECT count(*)::int FROM public.team_players tp WHERE tp.player_id = p.id) AS teams,
            (SELECT count(*)::int FROM public.dota_match_players mp WHERE mp.player_id = p.id) AS matches,
            (SELECT coalesce(string_agg(s.name, '、'), '') FROM public.play_score s WHERE s.player_id = p.id) AS accounts,
            -- 出现在哪些赛事：报名 / 入队 / 比赛明细三处一并算。
            -- 只给「关联 N」计数时，两条同名记录看起来一模一样，管理员没法判断该不该合；
            -- 列出赛事名（并附每届的报名/入队/场次）才能点进去核对。
            (SELECT coalesce(
                      json_agg(
                        json_build_object(
                          'id', x.tid::text,
                          'name', x.name,
                          'signups', x.signups,
                          'teams', x.teams,
                          'games', x.games
                        ) ORDER BY x.tid DESC
                      ), '[]'::json)
               FROM (
                 SELECT t.id AS tid, t.name,
                        count(DISTINCT tp.player_id)::int AS signups,
                        count(DISTINCT tpl.player_id)::int AS teams,
                        -- 数 m 而不是 mp：mp 那一侧没按赛事过滤，只有 m 命中才算这届的场次
                        count(DISTINCT m.dota_match_id)::int AS games
                   FROM public.tournaments t
                   LEFT JOIN public.tournament_players tp
                          ON tp.tournament_id = t.id AND tp.player_id = p.id
                   LEFT JOIN public.team_players tpl
                          ON tpl.tournament_id = t.id AND tpl.player_id = p.id
                   LEFT JOIN public.dota_match_players mp ON mp.player_id = p.id
                   LEFT JOIN public.matches m
                          ON m.dota_match_id = mp.match_id AND m.tournament_id = t.id
                  WHERE t.id IN (
                          SELECT tp2.tournament_id FROM public.tournament_players tp2
                           WHERE tp2.player_id = p.id
                          UNION
                          SELECT tpl2.tournament_id FROM public.team_players tpl2
                           WHERE tpl2.player_id = p.id AND tpl2.tournament_id IS NOT NULL
                          UNION
                          SELECT m2.tournament_id FROM public.dota_match_players mp2
                            JOIN public.matches m2 ON m2.dota_match_id = mp2.match_id
                           WHERE mp2.player_id = p.id
                          UNION
                          SELECT ptp.tournament_id FROM public.player_tournament_participations ptp
                           WHERE ptp.player_id = p.id
                        )
                  GROUP BY t.id, t.name
               ) x) AS tournaments
       FROM public.players p
      WHERE p.id = ANY($1::bigint[])`,
    [allIds]
  );
  const byId = new Map(profile.rows.map((r) => [String(r.id), r]));

  return groups
    .map((g) => ({
      reason: g.reason,
      members: g.ids
        .map((id) => byId.get(String(id)))
        .filter(Boolean)
        .map((r) => ({
          id: String(r.id),
          nickname: r.nickname || '',
          groupNickname: r.group_nickname || '',
          gameId: r.game_id || null,
          score: Number(r.score || 0),
          positions: r.positions || '',
          region: r.region || '',
          createdAt: r.created_at || '',
          signups: r.signups,
          teams: r.teams,
          matches: r.matches,
          accounts: r.accounts ? String(r.accounts).split('、') : [],
          tournaments: Array.isArray(r.tournaments) ? r.tournaments : [],
        })),
    }))
    .filter((g) => g.members.length > 1);
}

export default async function handler(req, res) {
  if (denyIfNotAdmin(req, res, '仅管理员可合并群友')) return;

  const client = await pool.connect();
  try {
    // ---------- 列出疑似重复 ----------
    if (req.method === 'GET') {
      const groups = await loadGroups(client);
      return res.status(200).json({ ok: true, groups });
    }

    // ---------- 合并 ----------
    if (req.method === 'POST') {
      const keepId = String(req.body?.keepId ?? '').trim();
      const dropId = String(req.body?.dropId ?? '').trim();
      const gameIdFrom = req.body?.gameIdFrom ? String(req.body.gameIdFrom) : null;

      // 只允许纯数字，挡住注入与 NaN；abort 用 400
      if (!/^\d+$/.test(keepId) || !/^\d+$/.test(dropId)) {
        return res.status(400).json({ ok: false, error: '缺少有效的 keepId / dropId' });
      }
      if (keepId === dropId) {
        return res.status(400).json({ ok: false, error: '保留方与并入方不能是同一个人' });
      }
      if (gameIdFrom && !['keep', 'drop'].includes(gameIdFrom)) {
        return res.status(400).json({ ok: false, error: 'gameIdFrom 只能是 keep 或 drop' });
      }

      await client.query('BEGIN');

      // 用 SELECT * 而不是逐列列举：players 表存在历史漂移
      // （db.js 里建了 recent_win_rate / most_played_heroes，线上老库并没有），
      // 写死列名会在这种库上直接 500。下面只对「实际存在的列」做合并。
      const rows = await client.query('SELECT * FROM public.players WHERE id = ANY($1::bigint[])', [
        [keepId, dropId],
      ]);
      const keep = rows.rows.find((r) => String(r.id) === keepId);
      const drop = rows.rows.find((r) => String(r.id) === dropId);
      if (!keep || !drop) {
        await client.query('ROLLBACK');
        return res.status(404).json({ ok: false, error: '要合并的群友不存在（可能已被删除）' });
      }

      // ---------- 冲突 1：登录账号 ----------
      const acc = await client.query(
        `SELECT player_id::text AS pid, name FROM public.play_score WHERE player_id = ANY($1::bigint[])`,
        [[keepId, dropId]]
      );
      const keepAcc = acc.rows.filter((r) => String(r.pid) === keepId);
      const dropAcc = acc.rows.filter((r) => String(r.pid) === dropId);
      if (keepAcc.length > 0 && dropAcc.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          ok: false,
          code: 'ACCOUNT_CONFLICT',
          error:
            `两边都有登录账号（保留方：${keepAcc.map((r) => r.name).join('、')}；` +
            `并入方：${dropAcc.map((r) => r.name).join('、')}），` +
            '合并会丢一个登录身份，需要人工先在「账号绑定」里处理。',
        });
      }

      // ---------- 冲突 2：SteamID ----------
      const keepGid = isBlank(keep.game_id) ? null : String(keep.game_id);
      const dropGid = isBlank(drop.game_id) ? null : String(drop.game_id);
      let mergedGid = keepGid || dropGid;
      if (keepGid && dropGid && keepGid !== dropGid) {
        if (!gameIdFrom) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            ok: false,
            code: 'GAME_ID_CONFLICT',
            error:
              `两人的 SteamID 不同（保留方 ${keepGid}，并入方 ${dropGid}）。` +
              '请明确保留哪一个再合并，避免静默丢号。',
            keepGameId: keepGid,
            dropGameId: dropGid,
          });
        }
        mergedGid = gameIdFrom === 'keep' ? keepGid : dropGid;
      }

      // ---------- 1. 合并档案字段：保留方的空值用并入方的补 ----------
      // 只写「这一行真实存在的列」，缺列的库（如没有 most_played_heroes）自动跳过
      const merged = {};
      const assign = (key, val) => {
        if (key in keep) merged[key] = val;
      };

      assign('game_id', mergedGid); // bigint 列，传字符串让 PG 自己转，避免大数丢精度
      assign('group_nickname', pickFilled(keep.group_nickname, drop.group_nickname));
      assign('score', pickScore(keep.score, drop.score));
      assign('peak_score', pickScore(keep.peak_score, drop.peak_score));
      assign('positions', pickFilled(keep.positions, drop.positions));
      assign('heroes', pickFilled(keep.heroes, drop.heroes));
      assign('region', pickFilled(keep.region, drop.region));
      assign('self_intro', pickFilled(keep.self_intro, drop.self_intro));
      assign('enemies', pickFilled(keep.enemies, drop.enemies));
      assign('synergy_players', pickFilled(keep.synergy_players, drop.synergy_players));
      assign('win_rate', pickScore(keep.win_rate, drop.win_rate));
      assign('championships', pickScore(keep.championships, drop.championships));
      assign('avatar_url', pickFilled(keep.avatar_url, drop.avatar_url));
      assign('steam_name', pickFilled(keep.steam_name, drop.steam_name));

      // jsonb 列：一边有一边没有就取有的，都有则保留保留方的
      for (const key of ['most_played_heroes', 'highest_win_rate_heroes']) {
        const val = keep[key] || drop[key];
        if (key in keep) merged[key] = val == null ? null : JSON.stringify(val);
      }

      // 注册时间取更早的那个，避免合并后「新人」把老成员挤到列表末尾
      if (keep.created_at && drop.created_at) {
        assign('created_at', String(keep.created_at) <= String(drop.created_at) ? keep.created_at : drop.created_at);
      }
      assign('updated_at', new Date().toISOString());

      const setKeys = Object.keys(merged);
      if (setKeys.length > 0) {
        const setClause = setKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        await client.query(`UPDATE public.players SET ${setClause} WHERE id = $${setKeys.length + 1}`, [
          ...setKeys.map((k) => merged[k]),
          keepId,
        ]);
      }

      // ---------- 2. team_players：同一支队里两边都在 → 去掉并入方那条 ----------
      const delTeam = await client.query(
        `DELETE FROM public.team_players d
          WHERE d.player_id = $2
            AND EXISTS (SELECT 1 FROM public.team_players k
                         WHERE k.player_id = $1 AND k.team_id = d.team_id
                           AND k.tournament_id IS NOT DISTINCT FROM d.tournament_id)`,
        [keepId, dropId]
      );
      const teamMoved = await client.query(
        'UPDATE public.team_players SET player_id = $1 WHERE player_id = $2',
        [keepId, dropId]
      );

      // ---------- 3. tournament_players：UNIQUE(player_id, tournament_id) ----------
      // 先把并入方的快照值非空项补进保留方，再删重复行，最后搬剩下的
      await client.query(
        `UPDATE public.tournament_players k SET
           score = COALESCE(NULLIF(k.score, 0), d.score),
           positions = COALESCE(NULLIF(btrim(k.positions), ''), d.positions),
           region = COALESCE(NULLIF(btrim(k.region), ''), d.region),
           heroes = COALESCE(NULLIF(btrim(k.heroes), ''), d.heroes),
           self_intro = COALESCE(NULLIF(btrim(k.self_intro), ''), d.self_intro),
           enemies = COALESCE(NULLIF(btrim(k.enemies), ''), d.enemies),
           is_captain = (k.is_captain OR d.is_captain)
          FROM public.tournament_players d
         WHERE k.player_id = $1 AND d.player_id = $2
           AND k.tournament_id = d.tournament_id`,
        [keepId, dropId]
      );
      const delSignup = await client.query(
        `DELETE FROM public.tournament_players d
          WHERE d.player_id = $2
            AND EXISTS (SELECT 1 FROM public.tournament_players k
                         WHERE k.player_id = $1 AND k.tournament_id = d.tournament_id)`,
        [keepId, dropId]
      );
      const signupMoved = await client.query(
        'UPDATE public.tournament_players SET player_id = $1 WHERE player_id = $2',
        [keepId, dropId]
      );

      // ---------- 4. 参赛记录：没有唯一约束，先按赛事去重再搬 ----------
      await client.query(
        `UPDATE public.player_tournament_participations k SET
           final_rank = COALESCE(k.final_rank, d.final_rank),
           team_id = COALESCE(k.team_id, d.team_id)
          FROM public.player_tournament_participations d
         WHERE k.player_id = $1 AND d.player_id = $2
           AND k.tournament_id = d.tournament_id`,
        [keepId, dropId]
      );
      const delPart = await client.query(
        `DELETE FROM public.player_tournament_participations d
          WHERE d.player_id = $2
            AND EXISTS (SELECT 1 FROM public.player_tournament_participations k
                         WHERE k.player_id = $1 AND k.tournament_id = d.tournament_id)`,
        [keepId, dropId]
      );
      const partMoved = await client.query(
        'UPDATE public.player_tournament_participations SET player_id = $1 WHERE player_id = $2',
        [keepId, dropId]
      );

      // ---------- 5. 没有唯一约束的引用：直接改 ----------
      const moved = {};
      for (const table of SIMPLE_TABLES) {
        try {
          const r = await client.query(`UPDATE public.${table} SET player_id = $1 WHERE player_id = $2`, [
            keepId,
            dropId,
          ]);
          moved[table] = r.rowCount;
        } catch (e) {
          // 老库可能没有这张表，不该让整次合并失败
          if (!/does not exist/i.test(e.message)) throw e;
          moved[table] = 0;
        }
      }

      // ---------- 6. 队长：指向并入方的要改成保留方 ----------
      const cap = await client.query('UPDATE public.teams SET captain_id = $1 WHERE captain_id = $2', [
        keepId,
        dropId,
      ]);

      // ---------- 7. 登录账号（只可能一边有，上面已拦） ----------
      const accMoved = await client.query('UPDATE public.play_score SET player_id = $1 WHERE player_id = $2', [
        keepId,
        dropId,
      ]);

      // ---------- 8. 身份子表：SteamID 与群昵称一起搬 ----------
      await ensureIdentityTables(client);

      // 先把并入方的主号标记清掉，否则搬过去会和保留方的主号撞唯一索引
      await client.query('UPDATE public.player_steam_accounts SET is_primary = false WHERE player_id = $1', [dropId]);
      await client.query('UPDATE public.player_group_nicknames SET is_primary = false WHERE player_id = $1', [dropId]);

      // SteamID：account_id 全局唯一，保留方已有的同号直接丢弃，其余改指
      const steamMoved = await client.query(
        `UPDATE public.player_steam_accounts s SET player_id = $1
          WHERE s.player_id = $2
            AND NOT EXISTS (SELECT 1 FROM public.player_steam_accounts k
                             WHERE k.player_id = $1 AND k.account_id = s.account_id)`,
        [keepId, dropId]
      );
      await client.query('DELETE FROM public.player_steam_accounts WHERE player_id = $1', [dropId]);

      // 群昵称：同一个人不能登记同一条（归一化后比较），重复的丢掉
      const nickMoved = await client.query(
        `UPDATE public.player_group_nicknames n SET player_id = $1
          WHERE n.player_id = $2
            AND NOT EXISTS (SELECT 1 FROM public.player_group_nicknames k
                             WHERE k.player_id = $1
                               AND lower(regexp_replace(btrim(k.nickname), '\\s+', '', 'g'))
                                 = lower(regexp_replace(btrim(n.nickname), '\\s+', '', 'g')))`,
        [keepId, dropId]
      );
      await client.query('DELETE FROM public.player_group_nicknames WHERE player_id = $1', [dropId]);

      // 保留方如果一条主号都没有（并入方也没主号），把第一条提上来
      await client.query(
        `UPDATE public.player_steam_accounts SET is_primary = true
          WHERE id = (SELECT id FROM public.player_steam_accounts WHERE player_id = $1 ORDER BY id LIMIT 1)
            AND NOT EXISTS (SELECT 1 FROM public.player_steam_accounts WHERE player_id = $1 AND is_primary)`,
        [keepId]
      );
      await client.query(
        `UPDATE public.player_group_nicknames SET is_primary = true
          WHERE id = (SELECT id FROM public.player_group_nicknames WHERE player_id = $1 ORDER BY id LIMIT 1)
            AND NOT EXISTS (SELECT 1 FROM public.player_group_nicknames WHERE player_id = $1 AND is_primary)`,
        [keepId]
      );
      await syncPrimary(client, keepId);

      // ---------- 9. 删掉并入方 ----------
      await client.query('DELETE FROM public.players WHERE id = $1', [dropId]);

      await client.query('COMMIT');
      listCache.clear('playersList');

      return res.status(200).json({
        ok: true,
        left: { id: keepId, nickname: keep.nickname },
        removed: { id: dropId, nickname: drop.nickname },
        moved: {
          入队: teamMoved.rowCount,
          报名: signupMoved.rowCount,
          参赛记录: partMoved.rowCount,
          比赛明细: moved.dota_match_players || 0,
          开黑帖: moved.party_posts || 0,
          开黑报名: moved.party_signups || 0,
          队长身份: cap.rowCount,
          登录账号: accMoved.rowCount,
          SteamID: steamMoved.rowCount,
          群昵称: nickMoved.rowCount,
        },
        // 去重删掉的行数，让管理员知道「少了几条」不是丢数据
        deduped: {
          重复入队: delTeam.rowCount,
          重复报名: delSignup.rowCount,
          重复参赛记录: delPart.rowCount,
        },
        gameId: mergedGid,
      });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ ok: false, error: `方法 ${req.method} 不被允许` });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('合并群友失败:', e);
    return res.status(500).json({ ok: false, error: '合并失败：' + e.message });
  } finally {
    client.release();
  }
}
