/**
 * 对局战绩管理（管理员）。
 *
 * `dota_matches` / `dota_match_players` 是群里最「硬」的数据源：
 * 群友详情页的出战记录（首发/替补、KDA、英雄）、赛事页每场对局明细全读它，
 * 而这些行只由两个 CLI 脚本写入（scripts/fetch-dota-matches.js、backfill-league.js）。
 * 于是「这局认错人了」「这场根本不该算」「这人其实是替补」这类问题，
 * 以前只能 SSH 上服务器改库。
 *
 * 这个接口把三件最高频的修补搬进后台：
 *   1. **绑定**：account_id → player_id（Steam 号和人对不上，或绑错了人）
 *   2. **替补标记**：is_standin（临时来顶一场的，不该算队籍）
 *   3. **删掉整局**：数据源那边多抓了一场 / 抓串了
 *
 * ⚠ 不碰 `matches`（赛程对阵）：名次与比分是另一套表，删这里的行不影响名次。
 *   页面文案必须写清这一点，否则管理员不敢动。
 */
import { pool } from '../../../lib/db';
import { denyIfNotAdmin } from '../../../lib/auth';

const ok = (res, data) => res.status(200).json({ success: true, ...data });
const bad = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });

export default async function handler(req, res) {
  if (denyIfNotAdmin(req, res)) return;

  try {
    if (req.method === 'GET') {
      const tournamentId = req.query.tournament_id ? String(req.query.tournament_id) : '';
      const onlyUnbound = req.query.unbound === '1';
      const q = String(req.query.q || '').trim();

      const params = [];
      const where = [];
      if (tournamentId) {
        params.push(tournamentId);
        where.push(`dm.tournament_id = $${params.length}`);
      }

      // 赛事下拉：只列真的有对局数据的，避免一屏空选项
      const tours = await pool.query(`
        SELECT t.id, t.name, count(*)::int AS games
          FROM public.dota_matches dm
          JOIN public.tournaments t ON t.id = dm.tournament_id
         GROUP BY t.id, t.name
         ORDER BY max(dm.start_time) DESC NULLS LAST
      `);

      const sql = `
        SELECT dm.match_id, dm.tournament_id, dm.game_no, dm.start_time,
               dm.radiant_win, dm.duration, dm.radiant_score, dm.dire_score,
               dm.radiant_name, dm.dire_name,
               t.name AS tournament_name,
               ta.name AS team_a_name, tb.name AS team_b_name,
               r.name AS round_name
          FROM public.dota_matches dm
          LEFT JOIN public.tournaments t ON t.id = dm.tournament_id
          LEFT JOIN public.teams ta ON ta.id = dm.team_a_id
          LEFT JOIN public.teams tb ON tb.id = dm.team_b_id
          LEFT JOIN public.tournament_rounds r ON r.id = dm.round_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY dm.start_time DESC NULLS LAST, dm.match_id DESC
      `;
      const games = await pool.query(sql, params);
      const ids = games.rows.map((g) => String(g.match_id));

      let rows = [];
      if (ids.length) {
        const p = await pool.query(
          `SELECT dmp.match_id, dmp.account_id, dmp.player_id, dmp.hero_id, dmp.is_radiant,
                  dmp.is_standin, dmp.kills, dmp.deaths, dmp.assists,
                  pl.nickname, pl.region
             FROM public.dota_match_players dmp
             LEFT JOIN public.players pl ON pl.id = dmp.player_id
            WHERE dmp.match_id = ANY($1::bigint[])
            ORDER BY dmp.is_radiant DESC, dmp.kills DESC NULLS LAST`,
          [ids]
        );
        rows = p.rows;
      }

      const kw = q.toLowerCase();
      const matchedByKw = (pl) =>
        !kw ||
        String(pl.account_id || '').includes(kw) ||
        String(pl.nickname || '').toLowerCase().includes(kw) ||
        String(pl.hero_id || '') === kw;

      const list = games.rows
        .map((g) => {
          const players = rows
            .filter((p) => String(p.match_id) === String(g.match_id))
            .filter(matchedByKw)
            .map((p) => ({
              accountId: String(p.account_id),
              playerId: p.player_id ? String(p.player_id) : null,
              nickname: p.nickname || null,
              region: p.region || '',
              heroId: p.hero_id,
              isRadiant: !!p.is_radiant,
              isStandin: !!p.is_standin,
              kda: [p.kills, p.deaths, p.assists],
            }));
          return {
            matchId: String(g.match_id),
            tournamentId: String(g.tournament_id),
            tournamentName: g.tournament_name || '',
            roundName: g.round_name || '',
            gameNo: g.game_no,
            startTime: g.start_time,
            radiantWin: g.radiant_win,
            duration: g.duration,
            score: [g.radiant_score, g.dire_score],
            radiantName: g.radiant_name || g.team_a_name || '天辉',
            direName: g.dire_name || g.team_b_name || '夜魇',
            players,
          };
        })
        // 「只看没绑定的」时，把没有未绑定选手的局整场去掉（否则一屏都是全绑好的局）
        .filter((g) => !onlyUnbound || g.players.some((p) => !p.playerId));

      const unboundTotal = rows.filter((p) => !p.player_id).length;

      res.setHeader('Cache-Control', 'no-store');
      return ok(res, {
        games: list,
        tournaments: tours.rows.map((t) => ({ id: String(t.id), name: t.name, games: t.games })),
        unboundTotal,
        gamesTotal: games.rowCount,
      });
    }

    if (req.method === 'POST') {
      const { action, matchId, accountId, playerId } = req.body || {};
      if (!matchId || !accountId) return bad(res, '缺少 matchId / accountId');

      if (action === 'bind') {
        if (!playerId) return bad(res, '没选要绑给谁');
        const has = await pool.query('SELECT 1 FROM public.players WHERE id = $1', [playerId]);
        if (has.rowCount === 0) return bad(res, '这位群友不存在', 404);
        const upd = await pool.query(
          'UPDATE public.dota_match_players SET player_id = $3 WHERE match_id = $1 AND account_id = $2',
          [matchId, accountId, playerId]
        );
        if (upd.rowCount === 0) return bad(res, '这局里没有这个 Steam 号', 404);
        return ok(res, { matchId, accountId, playerId: String(playerId) });
      }

      if (action === 'unbind') {
        const upd = await pool.query(
          'UPDATE public.dota_match_players SET player_id = NULL WHERE match_id = $1 AND account_id = $2',
          [matchId, accountId]
        );
        if (upd.rowCount === 0) return bad(res, '这局里没有这个 Steam 号', 404);
        return ok(res, { matchId, accountId });
      }

      if (action === 'standin') {
        const upd = await pool.query(
          `UPDATE public.dota_match_players
              SET is_standin = NOT COALESCE(is_standin, false)
            WHERE match_id = $1 AND account_id = $2
            RETURNING is_standin`,
          [matchId, accountId]
        );
        if (upd.rowCount === 0) return bad(res, '这局里没有这个 Steam 号', 404);
        return ok(res, { matchId, accountId, isStandin: upd.rows[0].is_standin });
      }

      return bad(res, '不认识的操作：' + action);
    }

    if (req.method === 'DELETE') {
      const matchId = String(req.query.match_id || (req.body && req.body.matchId) || '');
      if (!matchId) return bad(res, '缺少 match_id');
      await pool.query('BEGIN');
      try {
        const del = await pool.query('DELETE FROM public.dota_matches WHERE match_id = $1 RETURNING match_id', [
          matchId,
        ]);
        if (del.rowCount === 0) {
          await pool.query('ROLLBACK');
          return bad(res, '这局不存在，可能已经删过了', 404);
        }
        await pool.query('DELETE FROM public.dota_match_players WHERE match_id = $1', [matchId]);
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }
      return ok(res, { matchId });
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    return res.status(405).json({ success: false, error: '不支持的请求方法' });
  } catch (e) {
    console.error('战绩管理接口出错:', e);
    return bad(res, e.message || '服务器出错了', 500);
  }
}
