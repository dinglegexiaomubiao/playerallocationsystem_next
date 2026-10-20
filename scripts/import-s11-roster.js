/**
 * 导入第十一届：报名名单（51 人）+ 组队情况（8 支拍卖队）
 *
 * 匹配优先级（避免重复建人）：
 *   1. 按 SteamID 命中 → 更新昵称/段位/分数/位置
 *   2. 按群ID或昵称命中且 game_id 为空 → 补上 SteamID（历史迁移留下的同名空记录）
 *   3. 都没有 → 新建
 *
 * 队伍名统一用队长名（拍卖制，队长即队伍标识）。
 * 队长本人也算队员，一起写入 team_players。
 *
 * 用法：
 *   DATABASE_URL=... node scripts/import-s11-roster.js            # 干跑
 *   DATABASE_URL=... node scripts/import-s11-roster.js --commit   # 写入
 */
const { Client } = require('pg');

const COMMIT = process.argv.includes('--commit');

const POS_CN = { 1: '优势路', 2: '中单', 3: '劣势路', 4: '半辅助', 5: '纯辅助' };
// "2143" → "中单,优势路,半辅助,劣势路"（保留优先级顺序）
const posText = (s) =>
  String(s || '')
    .split('')
    .map((c) => POS_CN[c])
    .filter(Boolean)
    .join(',');

const num = (v) => {
  if (v === null || v === undefined || v === '' || v === '没出分呢' || v === '未校准') return null;
  const n = Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};

// 报名名单：[群ID, SteamID, 段位, 当前分, 最高分, 位置]
const ROSTER = [
  ['Spirit_Moon', 294993528, '超凡', 5069, 6000, '2143'],
  ['无相', 136088690, '冠绝', null, 8533, '4'],
  ['清寒', 146510503, '中军', 2300, 2350, '5'],
  ['水豚噜噜', 900466924, '冠绝', 6200, 7000, '12345'],
  ['will', 196068698, '冠绝', 5900, 7000, '1'],
  ['stout', 140976240, '超凡', 4700, 4700, '34'],
  ['x蛆', 1221403033, '统帅', 2800, 2800, '134'],
  ['www', 183746899, '冠绝守门员', 5700, 5900, '3'],
  ['光', 151285393, '冠绝', 7300, 10000, '1'],
  ['EK', 136611464, '万古（真实传奇）', 4447, 4500, '45321'],
  ['阿芙乐尔', 123054869, '万古', 4000, 4400, '12345'],
  ['思', 149901486, '传奇', 3300, 3300, '345'],
  ['端午', null, '传奇', 3500, 3600, '1345'],
  ['慎独', 117116280, '万古', 4400, 5500, '31245'],
  ['MJ', 168615012, '传奇', 3200, 3200, '23451'],
  ['一轮游三次的🐷', 181393151, '未校准', null, 99999, '3'],
  ['一闪', 172175073, '冠绝', 7000, 9000, '15'],
  ['听书人', 115360218, '冠绝', 6800, 8500, '12'],
  ['Destiny', 86788193, '超凡', 5000, 6000, '12345'],
  ['Austin', 191760627, '传奇', 3500, null, '431'],
  ['刘海柱', 160800934, '万古', 4600, 4800, '3451'],
  ['K饭', 239205414, '传奇', 3400, 3500, '45'],
  ['上心', 173388025, '冠绝', 7000, null, ''],
  ['小谢🦀', 138966644, '传奇', 3894, 3894, '2'],
  ['dom', 362233986, '万古（真实传奇）', 4000, 4000, '53'],
  ['阿边边边边你', 103091764, '超凡', 5200, 7000, '12345'],
  ['砂锅大拳头', 113999819, '冠绝', 5600, 5800, '345'],
  ['pjc', 146348911, '万古', 3800, 3800, '54'],
  ['小白龙', 121401659, '超凡', 5000, 5600, '45231'],
  ['漆黑之牙', 146389394, '超凡', 5000, 5000, '346'],
  ['大白', 355534294, '超凡', 5200, 5500, '32'],
  ['团藏', 113529567, '超凡', 5000, 6000, '345'],
  ['阿吉', 168908562, '万古', 4200, 4700, '123'],
  ['怪鼠叔', 1617200313, '传奇3', 3300, 3400, '541'],
  ['walker', 174245541, '万古', null, null, '12345'],
  ['andrew', 1015357029, '传奇', 3300, 3500, '2'],
  ['百京泰迪熊', 141869520, '冠绝', 5000, 5000, '45'],
  ['ym', 138637714, '超凡', 4700, null, ''],
  ['Jason家俊', 247760044, '传奇', 3200, 4500, '12345'],
  ['巨蛋哥', 149455318, '中军', 1800, 2500, '45'],
  ['alpha', 145194345, '冠绝', 8100, 8100, '213'],
  ['WolF', 154113052, '传奇', 3300, 3700, '3425'],
  ['习惯随遇而安', 1259235211, '传奇', 3400, 3600, '451'],
  ['Yolo', 114678450, '未校准', 4000, 8000, '21'],
  ['余生', 86877807, '传奇', 3200, 3200, '123'],
  ['CatU', 360305590, '超凡', 5000, 5000, '235'],
  ['Sugoii', 196892319, '超凡', 4800, 5000, '13'],
  ['Ame.1', 225835718, '万古', 3800, 4200, '152'],
  ['汉间', 685603472, '万古', 2800, 4200, '21'],
  ['啊新', 202055420, '万古', 4500, 7000, '12'],
  ['笔笔', 1708918627, '冠绝', 6900, 6900, '45'],
];

// 组队情况：队长 = 队伍名，picks = 4 名队员（含拍卖价）
// 别名：报名名单里查不到的名字，映射到已存在的人；null 表示无 SteamID 的占位队长
const ALIAS = {
  ek: 'EK',
  '怪蜀黍': '怪鼠叔',
  '小谢': '小谢🦀',
  '团藏': '团藏',
  'vk': '团藏', // 队长 vk 的报名名是「团藏」，SteamID 113529567
  '月月': 'Spirit_Moon', // 队长月月的报名名是「Spirit_Moon」，SteamID 294993528
};

const TEAMS = [
  { captain: '听书人', budget: 175, picks: [['一闪', 160], ['思', 5], ['Jason家俊', 5], ['巨蛋哥', 5]], left: 0 },
  { captain: '水豚噜噜', budget: 185, picks: [['烟火声', 130], ['大白', 45], ['MJ', 5], ['andrew', 5]], left: 0 },
  { captain: '边', budget: 190, picks: [['stout', 42], ['ym', 60], ['刘海柱', 51], ['X', 37]], left: 0 },
  { captain: '月月', budget: 200, picks: [['砂锅大拳头', 86], ['Destiny', 47], ['漆黑之牙', 59], ['pjc', 8]], left: 0 },
  { captain: 'vk', budget: 220, picks: [['will', 117], ['ek', 20], ['阿吉', 50], ['dom', 33]], left: 0 },
  { captain: '老刘', budget: 230, picks: [['无相', 111], ['百京泰迪熊', 65], ['端午', 10], ['小谢', 25]], left: 19 },
  { captain: '许老板', budget: 245, picks: [['上心', 130], ['www', 84], ['K饭', 6], ['怪蜀黍', 25]], left: 0 },
  { captain: '丁丁', budget: 255, picks: [['光', 120], ['小白龙', 85], ['walker', 35], ['清寒', 15]], left: 0 },
];

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const stat = { updated: 0, linked: 0, created: 0, teamsNew: 0, teamsExist: 0, membersNew: 0, membersExist: 0 };
  let idSeq = 0;
  const nextId = () => String(Date.now()) + String(idSeq++).padStart(4, '0');

  try {
    await c.query('BEGIN');

    // 1. 补两个字段（段位、历史最高分）
    if (COMMIT) {
      await c.query('ALTER TABLE public.players ADD COLUMN IF NOT EXISTS rank_tier varchar(30)');
      await c.query('ALTER TABLE public.players ADD COLUMN IF NOT EXISTS peak_score int');
    }

    // 2. 载入现有选手
    const rows = (await c.query('SELECT id, nickname, group_nickname, game_id FROM public.players')).rows;
    const byGid = new Map();
    const byName = new Map();
    rows.forEach((p) => {
      if (p.game_id) byGid.set(String(p.game_id).trim(), p);
      [p.nickname, p.group_nickname].forEach((v) => {
        const k = String(v || '').trim().toLowerCase();
        if (k && !byName.has(k)) byName.set(k, p);
      });
    });

    // 3. 处理报名名单
    const rosterById = new Map(); // 报名名单里的中文名 → player 行
    for (const [gname, gid, rank, score, peak, pos] of ROSTER) {
      const gidStr = gid == null ? '' : String(gid);
      let target = gidStr ? byGid.get(gidStr) : null;
      let mode = '';

      if (target) {
        mode = 'update';
        stat.updated += 1;
      } else {
        // 按群ID/昵称找同名但没 SteamID 的历史记录
        // 注意：这里不能加 `&& gidStr` 条件。占位选手（报名名单里没有的人）没有 SteamID，
        // 若要求有 SteamID 才复用，重跑时会重复创建同名记录。
        const byN = byName.get(String(gname).trim().toLowerCase());
        if (byN && !byN.game_id) {
          target = byN;
          mode = 'link';
          stat.linked += 1;
        } else {
          mode = 'create';
          stat.created += 1;
        }
      }

      if (COMMIT) {
        if (mode === 'update') {
          await c.query(
            `UPDATE public.players
                SET group_nickname = $2, rank_tier = $3, score = COALESCE($4, score),
                    peak_score = COALESCE($5, peak_score), positions = COALESCE(NULLIF($6,''), positions),
                    updated_at = $7
              WHERE id = $1`,
            [target.id, gname, rank, num(score), num(peak), posText(pos), new Date().toISOString()]
          );
        } else if (mode === 'link') {
          // game_id 是 bigint 列，不能和空字符串做 COALESCE，所以按有无 SteamID 分开写
          if (gidStr) {
            await c.query(
              `UPDATE public.players
                  SET game_id = $2::bigint, group_nickname = $3, rank_tier = $4,
                      score = COALESCE($5, score), peak_score = COALESCE($6, peak_score),
                      positions = COALESCE(NULLIF($7,''), positions), updated_at = $8
                WHERE id = $1`,
              [target.id, gidStr, gname, rank, num(score), num(peak), posText(pos), new Date().toISOString()]
            );
          } else {
            await c.query(
              `UPDATE public.players
                  SET group_nickname = $2, rank_tier = $3,
                      score = COALESCE($4, score), peak_score = COALESCE($5, peak_score),
                      positions = COALESCE(NULLIF($6,''), positions), updated_at = $7
                WHERE id = $1`,
              [target.id, gname, rank, num(score), num(peak), posText(pos), new Date().toISOString()]
            );
          }
        } else {
          const id = nextId();
          await c.query(
            `INSERT INTO public.players
               (id, nickname, group_nickname, game_id, rank_tier, score, peak_score, positions, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
            [id, gname, gname, gidStr || null, rank, num(score) || 0, num(peak), posText(pos), new Date().toISOString()]
          );
          target = { id, nickname: gname, group_nickname: gname, game_id: gidStr };
        }
      } else {
        target = target || { id: `NEW:${gname}`, nickname: gname, group_nickname: gname, game_id: gidStr };
      }
      rosterById.set(String(gname).trim().toLowerCase(), target);
    }

    // 4. 建队伍
    const TOURNAMENT_NAME = '第十一届LaRoja 超级联赛';
    const t = await c.query('SELECT id FROM public.tournaments WHERE name = $1', [TOURNAMENT_NAME]);
    if (t.rows.length === 0) throw new Error('找不到赛事：' + TOURNAMENT_NAME);
    const tid = t.rows[0].id;
    console.log('赛事 ID:', tid);

    for (const team of TEAMS) {
      const teamName = team.captain; // 队伍名 = 队长名
      const ex = await c.query('SELECT id FROM public.teams WHERE tournament_id = $1 AND name = $2', [tid, teamName]);
      let teamId;
      if (ex.rows.length > 0) {
        teamId = ex.rows[0].id;
        stat.teamsExist += 1;
        console.log(`[队伍] ${teamName} 已存在(${teamId})`);
      } else {
        if (COMMIT) {
          const ins = await c.query(
            `INSERT INTO public.teams (name, tournament_id, created_at, updated_at)
             VALUES ($1,$2,$3,$3) RETURNING id`,
            [teamName, tid, new Date().toISOString()]
          );
          teamId = ins.rows[0].id;
        } else {
          teamId = `NEW:${teamName}`;
        }
        stat.teamsNew += 1;
        console.log(`[队伍] ${teamName} → 新建`);
      }

      // 队长 + 4 队员
      const all = [team.captain, ...team.picks.map((p) => p[0])];
      let captainPid = null;
      for (let i = 0; i < all.length; i++) {
        const rawName = all[i];
        const lookup = ALIAS[String(rawName).trim().toLowerCase()] || rawName;
        let p = rosterById.get(String(lookup).trim().toLowerCase());

        if (!p) {
          // 报名名单里没有这个人（队长或占位队员），建一个只有名字的占位记录
          if (COMMIT) {
            const id = nextId();
            await c.query(
              `INSERT INTO public.players (id, nickname, group_nickname, created_at, updated_at)
               VALUES ($1,$2,$2,$3,$3)`,
              [id, rawName, new Date().toISOString()]
            );
            p = { id, nickname: rawName };
          } else {
            p = { id: `NEW:${rawName}`, nickname: rawName };
          }
          console.log(`     占位选手「${rawName}」（报名名单里没有，待补 SteamID）`);
        }
        if (i === 0) captainPid = p.id;

        const isPlaceholderTeam = typeof teamId === 'string' && teamId.startsWith('NEW:');
        const me =
          isPlaceholderTeam
            ? { rows: [] }
            : await c.query('SELECT id FROM public.team_players WHERE team_id = $1 AND player_id = $2', [
                teamId,
                p.id,
              ]);
        if (me.rows.length > 0) {
          stat.membersExist += 1;
        } else {
          if (COMMIT) {
            await c.query(
              `INSERT INTO public.team_players (team_id, player_id, tournament_id, created_at)
               VALUES ($1,$2,$3,$4)`,
              [teamId, p.id, tid, new Date().toISOString()]
            );
          }
          stat.membersNew += 1;
        }
      }

      // 队长
      if (COMMIT && captainPid && !(typeof teamId === 'string' && teamId.startsWith('NEW:'))) {
        await c.query('UPDATE public.teams SET captain_id = $2 WHERE id = $1 AND captain_id IS NULL', [
          teamId,
          captainPid,
        ]);
      }
    }

    // 5. 写入报名快照（赛事详情页的「报名名单」读的是 tournament_players）
    //    报名名单里的人全部登记，包括没被选进队伍的落选者
    let signupCount = 0;
    for (const p of rosterById.values()) {
      if (typeof p.id === 'string' && p.id.startsWith('NEW:')) continue; // 干跑占位
      if (COMMIT) {
        await c.query(
          `INSERT INTO public.tournament_players
             (player_id, tournament_id, score, positions, region, signup_status, is_captain, signed_at)
           VALUES ($1, $2, 0, NULL, NULL, 'approved', false, CURRENT_TIMESTAMP)
           ON CONFLICT (player_id, tournament_id) DO NOTHING`,
          [p.id, tid]
        );
      }
      signupCount += 1;
    }
    console.log(`报名快照：${signupCount} 人`);

    if (COMMIT) {
      await c.query('COMMIT');
      console.log('\n✓ 已提交');
    } else {
      await c.query('ROLLBACK');
      console.log('\n(干跑模式，已回滚)');
    }
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {}
    console.error('\n✗ 失败:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }

  console.log('\n================ 统计 ================');
  console.log('  选手  更新', stat.updated, '| 补 SteamID', stat.linked, '| 新建', stat.created);
  console.log('  队伍  新建', stat.teamsNew, '| 已存在', stat.teamsExist);
  console.log('  队籍  新增', stat.membersNew, '| 已存在', stat.membersExist);
}

main();
