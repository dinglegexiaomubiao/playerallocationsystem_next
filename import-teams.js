const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { requireDatabaseUrl } = require('./scripts/env');

// 连接串从 .env.local / 环境变量读取，不写死在代码里（历史泄漏点，勿回退）
const CONNECTION_STRING = requireDatabaseUrl();
const TOURNAMENT_NAME = '测试';
const DATA_FILE = path.join(__dirname, '测试的数据.json');
const DRY_RUN = !process.argv.includes('--commit');

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const teams = data.teams;
  const client = new Client({ connectionString: CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // 赛季
    const tourRes = await client.query('SELECT id FROM public.tournaments WHERE name = $1', [TOURNAMENT_NAME]);
    if (tourRes.rows.length !== 1) throw new Error(`赛季「${TOURNAMENT_NAME}」匹配到 ${tourRes.rows.length} 条`);
    const tournamentId = tourRes.rows[0].id;

    // 现有空队伍（按 id 排序）
    const teamsRes = await client.query('SELECT id, name FROM public.teams WHERE tournament_id = $1 ORDER BY id', [tournamentId]);
    const existingTeams = teamsRes.rows;
    if (existingTeams.length !== teams.length) {
      throw new Error(`现有队伍数 ${existingTeams.length} 与 JSON 队伍数 ${teams.length} 不一致`);
    }

    // 选手表按 game_id 索引（id 用字符串，bigint 可能超 2^53）
    const playersRes = await client.query('SELECT id, game_id FROM public.players');
    const byGameId = new Map();
    for (const p of playersRes.rows) {
      if (p.game_id != null && p.game_id !== '') byGameId.set(String(p.game_id), p);
    }

    // steam_id -> 昵称
    const nickBySteam = new Map();
    for (const t of teams) for (const p of t.players) {
      if (!nickBySteam.has(String(p.steam_id))) nickBySteam.set(String(p.steam_id), p.nickname);
    }

    const now = new Date().toISOString();
    const report = { deletedOrphans: 0, createdPlayers: [], linkedParticipations: [], renamedTeams: [], teamPlayersAdded: [] };

    await client.query('BEGIN');

    // 0) 清理孤儿参赛记录（之前 Number 精度丢失导致的错误 player_id）
    const orphanRes = await client.query(
      `SELECT ptp.player_id FROM public.player_tournament_participations ptp
       WHERE ptp.tournament_id = $1
         AND NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = ptp.player_id)`,
      [tournamentId]
    );
    report.deletedOrphans = orphanRes.rows.length;
    if (!DRY_RUN) {
      await client.query(
        `DELETE FROM public.player_tournament_participations
         WHERE tournament_id = $1
           AND NOT EXISTS (SELECT 1 FROM public.players p WHERE p.id = player_tournament_participations.player_id)`,
        [tournamentId]
      );
    }

    // 1) 参赛关联（全程字符串 id + ::bigint 显式转换）
    const partRes = await client.query('SELECT player_id FROM public.player_tournament_participations WHERE tournament_id = $1', [tournamentId]);
    const linkedIds = new Set(partRes.rows.map(r => String(r.player_id)));

    const playerIdBySteam = new Map();
    for (const [steamId, nick] of nickBySteam) {
      let row = byGameId.get(steamId);
      if (!row) {
        report.createdPlayers.push({ steamId, nick });
        if (!DRY_RUN) {
          const ins = await client.query(
            `INSERT INTO public.players (id, nickname, game_id, group_nickname, score, win_rate, championships, created_at, updated_at)
             VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [steamId, nick, Number(steamId), nick, 0, 0, 0, now, now]
          );
          row = { id: String(ins.rows[0].id) };
        } else {
          row = { id: steamId };
        }
      }
      const pid = String(row.id);
      playerIdBySteam.set(steamId, pid);
      if (!linkedIds.has(pid)) {
        report.linkedParticipations.push({ steamId, nick, pid });
        linkedIds.add(pid);
        if (!DRY_RUN) {
          await client.query(
            'INSERT INTO public.player_tournament_participations (player_id, tournament_id, created_at) VALUES ($1::bigint, $2, $3)',
            [pid, tournamentId, now]
          );
        }
      }
    }

    // 2) 队伍：重命名 + 填充队员
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      const dbTeam = existingTeams[i];
      const newName = String(i + 1);
      report.renamedTeams.push({ id: dbTeam.id, old: dbTeam.name, new: newName });
      if (!DRY_RUN) {
        await client.query('UPDATE public.teams SET name = $1, updated_at = $2 WHERE id = $3', [newName, now, dbTeam.id]);
      }
      for (const p of team.players) {
        const pid = playerIdBySteam.get(String(p.steam_id));
        const exists = await client.query(
          'SELECT 1 FROM public.team_players WHERE team_id = $1 AND player_id = $2::bigint AND tournament_id = $3',
          [dbTeam.id, pid, tournamentId]
        );
        if (exists.rows.length === 0) {
          report.teamPlayersAdded.push({ teamId: dbTeam.id, teamName: newName, nick: p.nickname, steamId: p.steam_id });
          if (!DRY_RUN) {
            await client.query(
              'INSERT INTO public.team_players (team_id, player_id, tournament_id, created_at) VALUES ($1, $2::bigint, $3, $4)',
              [dbTeam.id, pid, tournamentId, now]
            );
          }
        }
      }
    }

    await client.query('COMMIT');

    console.log(`赛季: ${TOURNAMENT_NAME} (id=${tournamentId})${DRY_RUN ? '  [DRY-RUN 预览]' : '  [写入]'}`);
    console.log(`- 清理孤儿参赛记录: ${report.deletedOrphans}`);
    console.log(`- 新建选手: ${report.createdPlayers.length}`);
    report.createdPlayers.forEach(r => console.log(`    + ${r.nick}  steam=${r.steamId}`));
    console.log(`- 补赛季关联: ${report.linkedParticipations.length}`);
    report.linkedParticipations.forEach(r => console.log(`    ~ ${r.nick}  steam=${r.steamId}  player_id=${r.pid}`));
    console.log(`- 重命名队伍: ${report.renamedTeams.length}`);
    report.renamedTeams.forEach(r => console.log(`    id=${r.id}: 「${r.old}」 -> 「${r.new}」`));
    console.log(`- 加入队伍关系: ${report.teamPlayersAdded.length}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('导入失败:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
