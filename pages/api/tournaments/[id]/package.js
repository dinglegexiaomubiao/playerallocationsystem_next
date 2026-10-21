// 单赛事整包导入（管理员）
//
// 一次请求搬运一个赛事的全部内容：赛事信息 / 报名名单 / 队伍与成员 / 赛程对阵。
//
// 三个关键约定：
//   1. 合并语义 —— 同名的更新、没有的新增，库里多出来的保持不动。导入永远不会删数据。
//   2. 空格不清空 —— 表格里留空的格子表示「这次不动这一项」，SQL 统一用 COALESCE(新值, 旧值)。
//      想真的清空请去后台表单操作，别指望导入干这事。
//   3. 单行失败不连坐 —— 每行包一个 SAVEPOINT，出错只回滚这一行并记进 errors，
//      其余合法数据照常提交。所以整包导入要么「大部分成功」，要么「整体失败（事务级错误）」。
//
// 为什么不用现有的 /api/teams、/api/team-players 逐个调：
//   - team_players / matches 都没有唯一约束，逐个调要额外查一遍存在性，20 个队员就是 40 次往返；
//   - PUT /api/teams 的 updateTeam 只认 name 一个字段，拿它改 captain 会把队名写成 null；
//   - 跨表要保持一致（队伍建了、队员没建成就很难看），必须同事务。
import { pool } from '../../../../lib/db';
import { ensureIdentityTables } from '../../../../lib/player-identity';
import { denyIfNotAdmin } from '../../../../lib/auth';

const MAX_ROWS = 500;

// 默认 bodyParser 上限 1MB，整包几百行带中文容易顶到，放宽一点
export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

const clip = (v, n) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, n) : null;
};
const key = (s) => String(s || '').trim().toLowerCase();
const intOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ success: false, error: '缺少赛季ID' });

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: `方法 ${req.method} 不被允许` });
  }

  if (denyIfNotAdmin(req, res, '仅管理员可导入赛事数据')) return;

  const body = req.body || {};
  const info = body.info && typeof body.info === 'object' ? body.info : null;
  const signupRows = Array.isArray(body.signups) ? body.signups.slice(0, MAX_ROWS) : [];
  const teamRows = Array.isArray(body.teams) ? body.teams.slice(0, MAX_ROWS) : [];
  const matchRows = Array.isArray(body.matches) ? body.matches.slice(0, MAX_ROWS) : [];

  if (!info && signupRows.length + teamRows.length + matchRows.length === 0) {
    return res.status(400).json({ success: false, error: '文件里没有可导入的数据' });
  }

  const client = await pool.connect();
  const errors = [];
  const summary = {
    info: 0,
    signups: { added: 0, updated: 0 },
    teams: { added: 0, updated: 0, members: 0 },
    matches: { added: 0, updated: 0 },
    rounds: 0,
  };

  try {
    const found = await client.query('SELECT id, name FROM public.tournaments WHERE id = $1', [id]);
    if (found.rows.length === 0) {
      return res.status(404).json({ success: false, error: '赛季不存在' });
    }

    await client.query('BEGIN');

    /* ---------- 预载索引：66 个选手、几十支队伍，一次读进内存比逐行查快得多 ---------- */
    // 匹配键取「全部 SteamID（主号+副号）」和「全部群昵称」，否则表里写副号/备用昵称就认不出人
    const players = await client.query(
      'SELECT id, nickname, group_nickname, game_id FROM public.players'
    );
    const byId = new Map(players.rows.map((p) => [String(p.id), p]));
    const byGameId = new Map();
    // 群昵称允许不同人重名 → 值可能是数组，命中多条时按歧义处理，不瞎猜
    const byName = new Map();

    await ensureIdentityTables(client);
    const steamRows = await client.query(
      'SELECT account_id::text AS account, player_id::text AS pid FROM public.player_steam_accounts'
    );
    steamRows.rows.forEach((r) => {
      const p = byId.get(String(r.pid));
      if (p && r.account) byGameId.set(String(r.account).trim(), p);
    });
    const nickRows = await client.query(
      'SELECT nickname, player_id::text AS pid FROM public.player_group_nicknames'
    );
    nickRows.rows.forEach((r) => {
      const p = byId.get(String(r.pid));
      if (!p || !r.nickname) return;
      const k = key(r.nickname);
      if (!byName.has(k)) byName.set(k, []);
      if (!byName.get(k).some((x) => String(x.id) === String(p.id))) byName.get(k).push(p);
    });
    // 正式昵称优先级最高：单值覆盖（同名以 players.nickname 为准）
    players.rows.forEach((p) => {
      if (p.nickname) byName.set(key(p.nickname), [p]);
    });

    // 导入过程中攒下的歧义，最后一次性返回给管理员
    const ambiguous = new Map(); // 名字 → Set(候选人昵称)

    const teamRes = await client.query(
      'SELECT id, name, captain_id, rank FROM public.teams WHERE tournament_id = $1',
      [id]
    );
    const teamsByKey = new Map();
    teamRes.rows.forEach((t) => teamsByKey.set(key(t.name), t));

    const roundRes = await client.query(
      'SELECT id, name FROM public.tournament_rounds WHERE tournament_id = $1 ORDER BY order_no ASC, id ASC',
      [id]
    );
    const roundsByKey = new Map();
    roundRes.rows.forEach((r) => roundsByKey.set(key(r.name), r));
    let roundOrder = roundRes.rows.length;

    const resolvePlayer = (row) => {
      const gid = String(row.game_id || '').trim();
      if (gid && /^\d{1,20}$/.test(gid)) {
        const hit = byGameId.get(gid);
        if (hit) return hit;
      }
      const nm = String(row.nickname || '').trim();
      if (nm) {
        const hits = byName.get(key(nm)) || [];
        if (hits.length === 1) return hits[0];
        if (hits.length > 1) {
          // 重名：不猜，记下来让管理员自己认
          const k = key(nm);
          if (!ambiguous.has(nm)) ambiguous.set(nm, new Set());
          hits.forEach((h) => ambiguous.get(nm).add(h.nickname));
          return null;
        }
      }
      return null;
    };

    /* ---------- 1. 赛事信息 ---------- */
    if (info) {
      const map = {
        name: 'name',
        status: 'status',
        start_date: 'start_date',
        end_date: 'end_date',
        sponsor_info: 'sponsor_info',
        champion_prize: 'champion_prize',
        runner_up_prize: 'runner_up_prize',
      };
      const sets = [];
      const vals = [];
      Object.entries(map).forEach(([k, col]) => {
        const v = info[k];
        if (v === null || v === undefined || String(v).trim() === '') return;
        vals.push(String(v).trim());
        sets.push(`${col} = $${vals.length}`);
      });
      if (sets.length > 0) {
        vals.push(id);
        await client.query(`UPDATE public.tournaments SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
        summary.info = sets.length;
      }
    }

    /* ---------- 2. 报名名单 ---------- */
    for (const row of signupRows) {
      await client.query('SAVEPOINT row');
      try {
        const p = resolvePlayer(row);
        if (!p) throw new Error('players 里找不到这个选手（steamID 与昵称都不匹配）');

        const r = await client.query(
          `INSERT INTO public.tournament_players
             (player_id, tournament_id, score, positions, region, signup_status, is_captain, signed_at)
           VALUES ($1,$2,$3,$4,$5,'approved',$6,CURRENT_TIMESTAMP)
           ON CONFLICT (player_id, tournament_id) DO UPDATE
             SET score     = COALESCE(EXCLUDED.score, public.tournament_players.score),
                 positions = COALESCE(EXCLUDED.positions, public.tournament_players.positions),
                 region    = COALESCE(EXCLUDED.region, public.tournament_players.region),
                 is_captain = CASE WHEN $6 THEN true ELSE public.tournament_players.is_captain END
           RETURNING (xmax = 0) AS inserted`,
          [p.id, id, intOrNull(row.score), clip(row.positions, 500), clip(row.region, 80), !!row.is_captain]
        );
        if (r.rows[0].inserted) summary.signups.added += 1;
        else summary.signups.updated += 1;

        await client.query('RELEASE SAVEPOINT row');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT row');
        errors.push({
          sheet: '报名名单',
          excelRow: row.excelRow || null,
          name: row.nickname || row.game_id || '',
          error: e.message || '导入失败',
        });
      }
    }

    /* ---------- 3. 队伍与成员 ---------- */
    // 一行一人，先按队名归组；同一支队的名次取第一个非空值
    const groups = [];
    const groupIdx = new Map();
    for (const row of teamRows) {
      const k = key(row.team_name);
      if (!groupIdx.has(k)) {
        const g = { name: String(row.team_name).trim(), rank: null, members: [] };
        groupIdx.set(k, g);
        groups.push(g);
      }
      const g = groupIdx.get(k);
      if (g.rank === null && row.rank !== null && row.rank !== undefined) g.rank = intOrNull(row.rank);
      if (String(row.nickname || '').trim() || String(row.game_id || '').trim()) {
        g.members.push(row);
      }
    }

    const captainHint = new Map(); // teamKey → player_id（表格里标了「是队长」的人）

    for (const g of groups) {
      await client.query('SAVEPOINT team');
      try {
        const k = key(g.name);
        let team = teamsByKey.get(k);
        if (!team) {
          const ins = await client.query(
            `INSERT INTO public.teams (name, tournament_id, created_at, updated_at)
             VALUES ($1, $2, $3, $3)
             RETURNING id, name, captain_id, rank`,
            [g.name, id, new Date().toISOString()]
          );
          team = ins.rows[0];
          teamsByKey.set(k, team);
          summary.teams.added += 1;
        } else {
          summary.teams.updated += 1;
        }

        if (g.rank !== null) {
          await client.query('UPDATE public.teams SET rank = $2 WHERE id = $1', [team.id, g.rank]);
        }

        for (const m of g.members) {
          const p = resolvePlayer(m);
          if (!p) {
            errors.push({
              sheet: '队伍与成员',
              excelRow: m.excelRow || null,
              name: m.nickname || m.game_id || '',
              error: `队伍「${g.name}」里这个队员在 players 中找不到`,
            });
            continue;
          }
          const exist = await client.query(
            'SELECT id FROM public.team_players WHERE team_id = $1 AND player_id = $2',
            [team.id, p.id]
          );
          if (exist.rows.length > 0) {
            // 已有关系：只补位置，不重复插入
            if (m.position) {
              await client.query('UPDATE public.team_players SET position = $2 WHERE id = $1', [
                exist.rows[0].id,
                clip(m.position, 40),
              ]);
            }
          } else {
            await client.query(
              `INSERT INTO public.team_players (team_id, player_id, tournament_id, position, created_at)
               VALUES ($1,$2,$3,$4,$5)`,
              [team.id, p.id, id, clip(m.position, 40), new Date().toISOString()]
            );
            summary.teams.members += 1;
          }
          if (m.is_captain) captainHint.set(k, p.id);
        }

        await client.query('RELEASE SAVEPOINT team');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT team');
        errors.push({ sheet: '队伍与成员', excelRow: null, name: g.name, error: e.message || '导入失败' });
      }
    }

    // 队长：只在不覆盖已有队长的情况下补上，避免导入把人工指定的队长冲掉
    for (const [k, pid] of captainHint) {
      const team = teamsByKey.get(k);
      if (team && !team.captain_id) {
        await client.query('UPDATE public.teams SET captain_id = $2 WHERE id = $1', [team.id, pid]);
      }
    }

    /* ---------- 4. 赛程对阵 ---------- */
    const orderRes = await client.query(
      'SELECT COALESCE(MAX(order_no), 0) AS n FROM public.matches WHERE tournament_id = $1',
      [id]
    );
    let matchOrder = Number(orderRes.rows[0].n) || 0;

    for (const row of matchRows) {
      await client.query('SAVEPOINT match');
      try {
        const a = teamsByKey.get(key(row.team_a_name));
        const b = teamsByKey.get(key(row.team_b_name));
        if (!a) throw new Error(`找不到队伍「${row.team_a_name}」，请先在队伍表里建好`);
        if (!b) throw new Error(`找不到队伍「${row.team_b_name}」，请先在队伍表里建好`);

        let roundId = null;
        const rn = String(row.round_name || '').trim();
        if (rn) {
          const hit = roundsByKey.get(key(rn));
          if (hit) roundId = hit.id;
          else {
            roundOrder += 1;
            const ins = await client.query(
              `INSERT INTO public.tournament_rounds (tournament_id, name, order_no, created_at)
               VALUES ($1,$2,$3,CURRENT_TIMESTAMP) RETURNING id, name`,
              [id, rn, roundOrder]
            );
            roundId = ins.rows[0].id;
            roundsByKey.set(key(rn), ins.rows[0]);
            summary.rounds += 1;
          }
        }

        // 胜者：优先按表格里的队名，没填就用比分推
        let winnerId = null;
        if (row.winner_name) {
          const w = teamsByKey.get(key(row.winner_name));
          if (w) winnerId = w.id;
        } else if (row.team_a_score !== null && row.team_b_score !== null) {
          if (row.team_a_score > row.team_b_score) winnerId = a.id;
          else if (row.team_b_score > row.team_a_score) winnerId = b.id;
        }

        // 已存在同一轮次、同一对阵（两边顺序都算）就更新，否则新建
        // $2 显式 ::int —— 传 null 时 PG 推不出参数类型，COALESCE 会直接报错
        const exist = await client.query(
          `SELECT id FROM public.matches
            WHERE tournament_id = $1
              AND COALESCE(round_id, 0) = COALESCE($2::int, 0)
              AND ((team_a_id = $3 AND team_b_id = $4) OR (team_a_id = $4 AND team_b_id = $3))
            LIMIT 1`,
          [id, roundId, a.id, b.id]
        );

        if (exist.rows.length > 0) {
          await client.query(
            `UPDATE public.matches
                SET team_a_score = COALESCE($2, team_a_score),
                    team_b_score = COALESCE($3, team_b_score),
                    winner_team_id = COALESCE($4, winner_team_id),
                    status = CASE WHEN $4 IS NOT NULL THEN 'finished' ELSE status END,
                    note = COALESCE($5, note)
              WHERE id = $1`,
            [exist.rows[0].id, row.team_a_score, row.team_b_score, winnerId, clip(row.note, 200)]
          );
          summary.matches.updated += 1;
        } else {
          matchOrder += 1;
          await client.query(
            `INSERT INTO public.matches
               (tournament_id, round_id, team_a_id, team_b_id, team_a_score, team_b_score,
                winner_team_id, status, order_no, note, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CURRENT_TIMESTAMP)
             RETURNING id`,
            [
              id,
              roundId,
              a.id,
              b.id,
              row.team_a_score,
              row.team_b_score,
              winnerId,
              winnerId ? 'finished' : 'scheduled',
              matchOrder,
              clip(row.note, 200),
            ]
          );
          summary.matches.added += 1;
        }

        await client.query('RELEASE SAVEPOINT match');
      } catch (e) {
        await client.query('ROLLBACK TO SAVEPOINT match');
        errors.push({
          sheet: '赛程对阵',
          excelRow: row.excelRow || null,
          name: `${row.team_a_name || '?'} vs ${row.team_b_name || '?'}`,
          error: e.message || '导入失败',
        });
      }
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      summary,
      errors: errors.slice(0, 200),
      errorCount: errors.length,
      // 群昵称重名导致认不出人的，单独列出来 —— 这类不是「失败」，是「需要人工确认」
      ambiguous: [...ambiguous.entries()].map(([name, candidates]) => ({
        name,
        candidates: [...candidates],
      })),
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (e2) {
      /* 事务可能已经结束，忽略 */
    }
    console.error('赛事整包导入失败:', e);
    return res.status(500).json({ success: false, error: '导入失败：' + (e.message || '数据库错误') });
  } finally {
    client.release();
  }
}
