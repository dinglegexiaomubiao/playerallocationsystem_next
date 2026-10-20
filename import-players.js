const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { requireDatabaseUrl } = require('./scripts/env');

// 连接串从 .env.local / 环境变量读取。此处曾硬编码过 Neon 密码并进入 git 历史，
// 已轮换；不要为了图方便改回明文字符串。
const CONNECTION_STRING = requireDatabaseUrl();
const TOURNAMENT_NAME = '测试';
const DATA_FILE = path.join(__dirname, '测试的数据.json');

const DRY_RUN = !process.argv.includes('--commit');

async function main() {
  const entries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const client = new Client({ connectionString: CONNECTION_STRING, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // 1. 定位赛季
    const tourRes = await client.query(
      'SELECT id, name FROM public.tournaments WHERE name = $1',
      [TOURNAMENT_NAME]
    );
    if (tourRes.rows.length !== 1) {
      throw new Error(`未找到唯一赛季「${TOURNAMENT_NAME}」，匹配到 ${tourRes.rows.length} 条`);
    }
    const tournament = tourRes.rows[0];
    console.log(`赛季: ${tournament.name} (id=${tournament.id})${DRY_RUN ? '  [DRY-RUN 预览]' : '  [写入]'}`);

    // 2. 载入现有选手，按 game_id 建索引
    const playersRes = await client.query('SELECT id, nickname, game_id, group_nickname FROM public.players');
    const byGameId = new Map();
    for (const row of playersRes.rows) {
      if (row.game_id != null && row.game_id !== '') {
        byGameId.set(String(row.game_id), row);
      }
    }

    // 3. 载入该赛季已有的参赛关联
    const partRes = await client.query(
      'SELECT player_id FROM public.player_tournament_participations WHERE tournament_id = $1',
      [tournament.id]
    );
    const linkedIds = new Set(partRes.rows.map(r => String(r.player_id)));

    const now = new Date().toISOString();
    const results = { created: [], linked: [], updatedGroupNick: [], alreadyLinked: [] };

    await client.query('BEGIN');
    for (const entry of entries) {
      const steamId = String(entry.steam_id);
      const groupNick = (entry.group_nickname || '').trim();
      const existing = byGameId.get(steamId);

      let playerId;
      if (existing) {
        playerId = String(existing.id);
        // 已有选手：若群昵称为空则补上
        if (!existing.group_nickname && groupNick) {
          results.updatedGroupNick.push({ steamId, groupNick, playerId });
          if (!DRY_RUN) {
            await client.query(
              'UPDATE public.players SET group_nickname = $1, updated_at = $2 WHERE id = $3',
              [groupNick, now, playerId]
            );
          }
        }
      } else {
        // 新选手：id 直接使用 steam_id（9位数字，与现有时间戳id不冲突），昵称回退为群昵称
        playerId = steamId;
        results.created.push({ steamId, groupNick });
        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO public.players (id, nickname, game_id, group_nickname, score, win_rate, championships, created_at, updated_at)
             VALUES ($1::bigint, $2, $3::int, $4, $5, $6, $7, $8, $9)`,
            [steamId, groupNick, steamId, groupNick, 0, 0, 0, now, now]
          );
        }
      }

      // 关联到赛季
      if (!linkedIds.has(playerId)) {
        results.linked.push({ steamId, playerId });
        linkedIds.add(playerId);
        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO public.player_tournament_participations (player_id, tournament_id, created_at)
             VALUES ($1::bigint, $2, $3)`,
            [playerId, tournament.id, now]
          );
        }
      } else {
        results.alreadyLinked.push({ steamId, playerId });
      }
    }
    await client.query('COMMIT');

    console.log(`\n共 ${entries.length} 条`);
    console.log(`- 新建选手: ${results.created.length}`);
    results.created.forEach(r => console.log(`    + ${r.groupNick || '(空昵称)'}  steam=${r.steamId}`));
    console.log(`- 补群昵称(已有选手): ${results.updatedGroupNick.length}`);
    results.updatedGroupNick.forEach(r => console.log(`    ~ ${r.groupNick}  steam=${r.steamId}`));
    console.log(`- 新增赛季关联: ${results.linked.length}`);
    console.log(`- 已存在关联(跳过): ${results.alreadyLinked.length}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('导入失败:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
