/**
 * 一次性迁移：把「历届战绩」的 7 届数据写入系统。
 *
 * 数据来源：Excel「历届战绩-珍藏版」横向表 → 解析成 final-plan.json（7 届 / 56 队 / 280 人）
 *
 * 关键设计：
 *   1. 幂等 —— 赛事按名称、队伍按 (tournament_id, name)、队员按 (team_id, player_id) 判重，
 *      重复执行不会产生重复数据，可以放心重跑。
 *   2. 事务 —— 全部包在一个 BEGIN/COMMIT 里，任何一步抛错整体回滚。
 *   3. 干跑 —— 默认只统计不写库，加 --commit 才真正提交。
 *   4. 选手匹配宽松 —— 忽略大小写/空格/括号/标点，昵称 + 群昵称 + steam名 三字段都参与。
 *      匹配不上的新建 players 记录（只有昵称），后续由管理员在赛事管理页补 SteamID。
 *
 * 用法（在服务器项目目录下）：
 *   DATABASE_URL=$(grep '^DATABASE_URL=' .env.local | cut -d= -f2-) \
 *     node scripts/migrate-history.js final-plan.json            # 干跑
 *   ... node scripts/migrate-history.js final-plan.json --commit # 真写
 */

const fs = require('fs');
const { Client } = require('pg');

const planPath = process.argv[2] || './final-plan.json';
const COMMIT = process.argv.includes('--commit');

const norm = (s) =>
  String(s || '')
    .replace(/[（(][^）)]*[)）]/g, '')
    .replace(/[\s.,·・_\-'"`、]/g, '')
    .toLowerCase();

async function main() {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('缺少 DATABASE_URL');
    process.exit(1);
  }

  const c = new Client({ connectionString: url });
  await c.connect();

  const stat = {
    tournamentsNew: 0,
    tournamentsExist: 0,
    teamsNew: 0,
    teamsExist: 0,
    ranksSet: 0,
    playersMatched: 0,
    playersNew: 0,
    membershipsNew: 0,
    membershipsExist: 0,
    signupsNew: 0,
    error: null,
  };

  try {
    // ---------- 载入现有选手建索引 ----------
    const prows = (await c.query('SELECT id, nickname, group_nickname, steam_name FROM public.players')).rows;
    const pidx = new Map();
    prows.forEach((p) => {
      [p.nickname, p.group_nickname, p.steam_name].forEach((v) => {
        const k = norm(v);
        if (k && !pidx.has(k)) pidx.set(k, p);
      });
    });

    const newPlayerIds = new Set();
    let idSeq = 0;
    const nextId = () => String(Date.now()) + String(idSeq++).padStart(4, '0');

    await c.query('BEGIN');

    for (const ed of plan) {
      // ---------- 赛事 ----------
      const found = await c.query('SELECT id, name FROM public.tournaments WHERE name = $1', [ed.edition]);
      let tid;
      if (found.rows.length > 0) {
        tid = found.rows[0].id;
        stat.tournamentsExist += 1;
        console.log(`[赛事] ${ed.edition} 已存在(id=${tid})，跳过创建`);
      } else {
        if (COMMIT) {
          const ins = await c.query(
            `INSERT INTO public.tournaments (name, status, created_at)
             VALUES ($1, 'finished', CURRENT_TIMESTAMP) RETURNING id`,
            [ed.edition]
          );
          tid = ins.rows[0].id;
        } else {
          tid = `NEW:${ed.edition}`;
        }
        stat.tournamentsNew += 1;
        console.log(`[赛事] ${ed.edition} → 新建`);
      }

      // ---------- 队伍 ----------
      // 干跑时 tid 是占位字符串，不能拿去查库（bigint 转换会报错）。
      // 新赛事的队伍必然不存在，直接按新建处理即可。
      const isNewTournament = typeof tid === 'string';

      for (const team of ed.teams) {
        let teamId;
        const tf = isNewTournament
          ? { rows: [] }
          : await c.query('SELECT id, rank FROM public.teams WHERE tournament_id = $1 AND name = $2', [
              tid,
              team.name,
            ]);
        if (tf.rows.length > 0) {
          teamId = tf.rows[0].id;
          stat.teamsExist += 1;
          if (team.rank !== null && tf.rows[0].rank !== team.rank) {
            if (COMMIT) {
              await c.query('UPDATE public.teams SET rank = $2 WHERE id = $1', [teamId, team.rank]);
            }
            stat.ranksSet += 1;
          }
        } else {
          if (COMMIT) {
            const ins = await c.query(
              `INSERT INTO public.teams (name, tournament_id, rank, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $4) RETURNING id`,
              [team.name, tid, team.rank, new Date().toISOString()]
            );
            teamId = ins.rows[0].id;
          } else {
            teamId = `NEW:${ed.edition}/${team.name}`;
          }
          stat.teamsNew += 1;
          if (team.rank !== null) stat.ranksSet += 1;
        }

        // ---------- 队员 ----------
        for (const name of team.members) {
          const k = norm(name);
          let pid;
          const hit = pidx.get(k);

          if (hit) {
            pid = hit.id;
            stat.playersMatched += 1;
          } else {
            if (COMMIT) {
              pid = nextId();
              await c.query(
                `INSERT INTO public.players (id, nickname, game_id, group_nickname, score, created_at, updated_at)
                 VALUES ($1, $2, NULL, NULL, 0, $3, $3)`,
                [pid, name, new Date().toISOString()]
              );
            } else {
              pid = `NEW:${name}`;
            }
            // 同一批次内同名只建一次
            pidx.set(k, { id: pid, nickname: name });
            newPlayerIds.add(pid);
            stat.playersNew += 1;
          }

          // team_players（干跑时 teamId 是占位字符串，跳过查库）
          const ex =
            typeof teamId === 'string'
              ? { rows: [] }
              : await c.query('SELECT id FROM public.team_players WHERE team_id = $1 AND player_id = $2', [
                  teamId,
                  pid,
                ]);
          if (ex.rows.length > 0) {
            stat.membershipsExist += 1;
          } else {
            if (COMMIT) {
              await c.query(
                `INSERT INTO public.team_players (team_id, player_id, tournament_id, created_at)
                 VALUES ($1, $2, $3, $4)`,
                [teamId, pid, tid, new Date().toISOString()]
              );
            }
            stat.membershipsNew += 1;
          }

          // 报名快照（赛事详情的「报名选手」用它）
          if (COMMIT) {
            await c.query(
              `INSERT INTO public.tournament_players
                 (player_id, tournament_id, score, positions, region, signup_status, is_captain, signed_at)
               VALUES ($1, $2, 0, NULL, NULL, 'approved', false, CURRENT_TIMESTAMP)
               ON CONFLICT (player_id, tournament_id) DO NOTHING`,
              [pid, tid]
            );
          }
          stat.signupsNew += 1;

          // 参赛记录（getAllPlayers 按赛事过滤用它）
          if (COMMIT) {
            const p = await c.query(
              'SELECT 1 FROM public.player_tournament_participations WHERE player_id = $1 AND tournament_id = $2',
              [pid, tid]
            );
            if (p.rows.length === 0) {
              await c.query(
                `INSERT INTO public.player_tournament_participations (player_id, tournament_id, created_at)
                 VALUES ($1, $2, $3)`,
                [pid, tid, new Date().toISOString()]
              );
            }
          }
        }
      }
      console.log(
        `        ${ed.teams.length} 队 / ${ed.teams.reduce((a, t) => a + t.members.length, 0)} 人 处理完成`
      );
    }

    if (COMMIT) {
      await c.query('COMMIT');
      console.log('\n✓ 已提交');
    } else {
      await c.query('ROLLBACK');
      console.log('\n(干跑模式，已回滚，未写入任何数据)');
    }
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {}
    stat.error = e.message;
    console.error('\n✗ 失败并回滚:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }

  console.log('\n================ 统计 ================');
  console.log('  赛事  新建', stat.tournamentsNew, '| 已存在', stat.tournamentsExist);
  console.log('  队伍  新建', stat.teamsNew, '| 已存在', stat.teamsExist, '| 设置名次', stat.ranksSet);
  console.log('  选手  匹配到现有', stat.playersMatched, '| 新建', stat.playersNew);
  console.log('  队籍  新增', stat.membershipsNew, '| 已存在', stat.membershipsExist);
  console.log('  报名快照 处理', stat.signupsNew);
  if (stat.error) console.log('  错误:', stat.error);
}

main();
