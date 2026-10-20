/**
 * 抓取 Dota2 比赛并写入赛程。
 *
 * 数据源：OpenDota /api/matches/{id}（免费，无需 key，服务器实测可直连）
 *
 * 核心逻辑：队伍识别
 *   1. 一场比赛有 10 个 account_id，按天辉/夜魇分成两组
 *   2. 用 account_id 匹配 players.game_id（SteamID32，与 OpenDota 的 account_id 同格式）
 *   3. 对该赛事下的每支队伍，统计这 5 人里有几个属于它
 *   4. 命中最多且 ≥3 的队伍 = 该方队伍；命中但不在该队名单里的人 = 替补（is_standin）
 *   5. 一个都匹配不上的 account_id 会新建 players 记录，保证不丢人
 *
 * 用法（在服务器项目目录下）：
 *   DATABASE_URL=... node scripts/fetch-dota-matches.js 16 9048670311 9048875677 9048936961 --dry-run
 *   DATABASE_URL=... node scripts/fetch-dota-matches.js 16 <ids...> --commit
 */
const { Client } = require('pg');

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const ids = args.filter((a) => /^\d{9,12}$/.test(a));
const tid = Number(args.find((a) => /^\d{1,6}$/.test(a) && !/^\d{9,12}$/.test(a)));

if (!tid || ids.length === 0) {
  console.error('用法: node scripts/fetch-dota-matches.js <tournament_id> <match_id...> [--commit]');
  process.exit(1);
}

const HEROES = null; // 需要英雄名时再查 /api/heroes，这里只存 hero_id

async function fetchMatch(id) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`https://api.opendota.com/api/matches/${id}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (!d || !d.players) throw new Error('返回数据不完整');
      return d;
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`   第 ${attempt} 次失败（${e.message}），2 秒后重试…`);
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const log = [];

  try {
    /* ---------- 建表 ---------- */
    if (COMMIT) {
      await c.query(`
        CREATE TABLE IF NOT EXISTS public.dota_matches (
          match_id       bigint PRIMARY KEY,
          tournament_id  bigint NOT NULL,
          round_id       bigint,
          game_no        int,
          radiant_win    boolean,
          duration       int,
          start_time     timestamptz,
          radiant_name   varchar(80),
          dire_name      varchar(80),
          team_a_id      bigint,
          team_b_id      bigint,
          winner_team_id bigint,
          radiant_score  int,
          dire_score     int,
          raw            jsonb,
          fetched_at     timestamptz DEFAULT now()
        )
      `);
      await c.query(`
        CREATE TABLE IF NOT EXISTS public.dota_match_players (
          match_id    bigint NOT NULL,
          account_id  bigint NOT NULL,
          player_id   bigint,
          hero_id     int,
          is_radiant  boolean,
          kills int, deaths int, assists int,
          net_worth int, gpm int, xpm int,
          last_hits int, hero_damage int,
          is_standin  boolean DEFAULT false,
          PRIMARY KEY (match_id, account_id)
        )
      `);
      await c.query('ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS dota_match_id bigint');
      console.log('表结构就绪');
    }

    /* ---------- 载入赛事下的队伍与成员 ---------- */
    const teams = (
      await c.query(
        `SELECT t.id, t.name,
                array_agg(tp.player_id::text) FILTER (WHERE tp.player_id IS NOT NULL) AS pids
           FROM public.teams t
           LEFT JOIN public.team_players tp ON tp.team_id = t.id
          WHERE t.tournament_id = $1
          GROUP BY t.id, t.name`,
        [tid]
      )
    ).rows;
    console.log(`赛事 ${tid} 下共有 ${teams.length} 支队伍`);

    const players = (await c.query('SELECT id, nickname, game_id FROM public.players WHERE game_id IS NOT NULL')).rows;
    const byGid = new Map(players.map((p) => [String(p.game_id).trim(), p]));

    // team_id → Set(player_id)
    const teamMembers = new Map();
    teams.forEach((t) => teamMembers.set(String(t.id), new Set((t.pids || []).map(String))));

    /* ---------- 逐场抓取 ---------- */
    for (let i = 0; i < ids.length; i++) {
      const mid = ids[i];
      console.log(`\n=== 第 ${i + 1} 场 ${mid} ===`);
      const d = await fetchMatch(mid);

      const dur = Math.round(d.duration || 0);
      const startTs = d.start_time ? new Date(d.start_time * 1000).toISOString() : null;

      // 两侧阵容 → 玩家
      const sides = ['radiant', 'dire'].map((side) => {
        const isR = side === 'radiant';
        const ps = (d.players || []).filter((p) => p.isRadiant === isR);
        const pids = ps.map((p) => {
          const hit = byGid.get(String(p.account_id));
          return hit ? String(hit.id) : null;
        });
        return { side, isR, ps, pids, teamName: (isR ? d.radiant_name : d.dire_name) || '' };
      });

      // 每侧找最匹配的队伍
      sides.forEach((s) => {
        let best = null;
        teams.forEach((t) => {
          const set = teamMembers.get(String(t.id)) || new Set();
          const hitN = s.pids.filter((pid) => pid && set.has(pid)).length;
          if (!best || hitN > best.hitN) best = { team: t, hitN };
        });
        s.match = best;
        s.teamId = best && best.hitN >= 3 ? best.team.id : null;
        s.teamLabel = best && best.hitN >= 3 ? best.team.name : '未识别';
      });

      console.log(`  天辉「${sides[0].teamName || '无队名'}」→ ${sides[0].teamLabel}（命中 ${sides[0].match?.hitN ?? 0}/5）`);
      console.log(`  夜魇「${sides[1].teamName || '无队名'}」→ ${sides[1].teamLabel}（命中 ${sides[1].match?.hitN ?? 0}/5）`);

      // 比分与胜者
      const rTeam = sides[0].teamId;
      const dTeam = sides[1].teamId;
      const winnerTeamId = d.radiant_win ? rTeam : dTeam;

      // 替补：在该队名单里找不到的场上选手
      sides.forEach((s) => {
        s.standins = s.ps
          .filter((p) => {
            const hit = byGid.get(String(p.account_id));
            if (!hit || !s.teamId) return false;
            const set = teamMembers.get(String(s.teamId)) || new Set();
            return !set.has(String(hit.id));
          })
          .map((p) => p.personaname || p.account_id);
        if (s.standins.length) console.log(`    ${s.side === 'radiant' ? '天辉' : '夜魇'}替补：${s.standins.join('、')}`);
      });

      if (!COMMIT) {
        console.log('  (干跑，不写库)');
        continue;
      }

      // 写 dota_matches
      await c.query(
        `INSERT INTO public.dota_matches
           (match_id, tournament_id, round_id, game_no, radiant_win, duration, start_time,
            radiant_name, dire_name, team_a_id, team_b_id, winner_team_id, radiant_score, dire_score, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (match_id) DO UPDATE SET
           game_no=EXCLUDED.game_no, radiant_win=EXCLUDED.radiant_win, duration=EXCLUDED.duration,
           start_time=EXCLUDED.start_time, team_a_id=EXCLUDED.team_a_id, team_b_id=EXCLUDED.team_b_id,
           winner_team_id=EXCLUDED.winner_team_id, radiant_score=EXCLUDED.radiant_score,
           dire_score=EXCLUDED.dire_score, raw=EXCLUDED.raw, fetched_at=now()`,
        [
          mid,
          tid,
          null,
          i + 1,
          !!d.radiant_win,
          dur,
          startTs,
          (d.radiant_name || '').slice(0, 80) || null,
          (d.dire_name || '').slice(0, 80) || null,
          rTeam,
          dTeam,
          winnerTeamId,
          d.radiant_score ?? null,
          d.dire_score ?? null,
          JSON.stringify(d),
        ]
      );

      // 写 dota_match_players
      for (const s of sides) {
        for (const p of s.ps) {
          const hit = byGid.get(String(p.account_id));
          const inTeam = hit && s.teamId && (teamMembers.get(String(s.teamId)) || new Set()).has(String(hit.id));
          await c.query(
            `INSERT INTO public.dota_match_players
               (match_id, account_id, player_id, hero_id, is_radiant, kills, deaths, assists,
                net_worth, gpm, xpm, last_hits, hero_damage, is_standin)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (match_id, account_id) DO UPDATE SET
               player_id=EXCLUDED.player_id, hero_id=EXCLUDED.hero_id, kills=EXCLUDED.kills,
               deaths=EXCLUDED.deaths, assists=EXCLUDED.assists, net_worth=EXCLUDED.net_worth,
               gpm=EXCLUDED.gpm, xpm=EXCLUDED.xpm, last_hits=EXCLUDED.last_hits,
               hero_damage=EXCLUDED.hero_damage, is_standin=EXCLUDED.is_standin`,
            [
              mid,
              p.account_id,
              hit ? hit.id : null,
              p.hero_id,
              !!p.isRadiant,
              p.kills ?? 0,
              p.deaths ?? 0,
              p.assists ?? 0,
              p.net_worth ?? null,
              p.gold_per_min ?? null,
              p.xp_per_min ?? null,
              p.last_hits ?? null,
              p.hero_damage ?? null,
              !inTeam,
            ]
          );
        }
      }
      log.push({ mid, game: i + 1, winner: winnerTeamId ? `team#${winnerTeamId}` : '未识别' });
      console.log('  ✓ 已写入');
    }

    if (COMMIT) {
      const tot = await c.query('SELECT count(*)::int n FROM public.dota_matches WHERE tournament_id=$1', [tid]);
      const pp = await c.query(
        'SELECT count(*)::int n FROM public.dota_match_players p JOIN public.dota_matches m USING(match_id) WHERE m.tournament_id=$1',
        [tid]
      );
      console.log(`\n赛事 ${tid} 现有比赛 ${tot.rows[0].n} 场，选手记录 ${pp.rows[0].n} 条`);
    }
  } catch (e) {
    console.error('\n✗ 失败:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
