#!/usr/bin/env node
/**
 * 联赛数据补录（自动发现 + 写入）
 * ============================================================
 * 为什么不按 match_id 手输：历史赛季没人记得 ID。改成反查——
 * 用队内选手的 SteamID（players.game_id = Dota account_id）去拉每人的
 * 对局列表，谁和谁在同一场里出现，就聚类出一场社区内战。
 *
 * 识别链路：
 *   1. 取该赛事所有队籍选手的 game_id
 *   2. 逐人拉 /api/players/{account_id}/matches
 *   3. 按 match_id 聚合，统计「我们的人」在两边各几个
 *   4. 只留 game_mode = 2（队长模式）且我方人数 >= N 的局
 *      —— 内战按 CM 打，这条能把路人局噪声砍掉九成
 *   5. 抓对局详情，用队籍名单投票认队（单侧命中 >= 3 判定为该队）
 *   6. 按 CST 日期分轮次：周五=淘汰赛，周六=半决赛/决赛，其余=小组赛
 *
 * 用法（必须在能同时访问数据库和 api.opendota.com 的机器上跑）：
 *   # 只扫描出报告，不写库
 *   node scripts/backfill-league.js --tournament 5
 *   # 写入
 *   node scripts/backfill-league.js --tournament 5 --commit
 *   # 扫全部赛季，输出候选报告
 *   node scripts/backfill-league.js --discover
 *
 * 参数：
 *   --tournament <id>   指定赛事
 *   --discover          扫描所有赛事并输出报告（不写库）
 *   --commit            真正写库（默认干跑）
 *   --limit <n>         每人拉多少条对局，默认 500
 *   --min-hits <n>      一局里至少几个自己人，默认 6
 *   --any-mode          不限制队长模式（会引入大量路人局，不建议）
 *   --refresh           忽略本地缓存，重新拉取
 *   --series-gap <min>  同一 BO 系列内两局的最大间隔分钟，默认 180
 *   --window <a,b>      手动指定时间窗口（YYYY-MM-DD,YYYY-MM-DD）。
 *                       历史赛季没有起止日期时用这个，否则脚本只报告不写库
 *                       —— 不然 7 个老赛季会抢同一批对局。
 *   --scan              不限赛事，把全库有 SteamID 的选手扫一遍，
 *                       按日期列出所有「我方 >= N 人」的对局。用来找老赛季落在哪几天。
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const COMMIT = flag('--commit');
const DISCOVER = flag('--discover');
const SCAN = flag('--scan');
const REFRESH = flag('--refresh');
const ANY_MODE = flag('--any-mode');
const TID = Number(opt('--tournament', 0)) || 0;
const LIMIT = Number(opt('--limit', 500));
const MIN_HITS = Number(opt('--min-hits', 6));
const SERIES_GAP = Number(opt('--series-gap', 180));
const WINDOW_ARG = opt('--window', '');
const CST_OFFSET = 8 * 3600;
const CACHE = path.join(process.cwd(), '.cache', 'opendota');

if (!TID && !DISCOVER && !SCAN) {
  console.error('用法: node scripts/backfill-league.js --tournament <id> [--commit] | --discover | --scan');
  process.exit(1);
}

/* ---------- 小工具 ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

/** 时间戳（秒）→ CST 的年月日/星期/时分 */
function cst(ts) {
  const d = new Date((ts + CST_OFFSET) * 1000);
  return {
    key: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    weekday: d.getUTCDay(), // 0=周日 … 5=周五 6=周六
  };
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 一局的人头比分。
 * 返回 [null, null] 表示这局 OpenDota 没解析过：
 * 只有基本对局信息（谁打了、谁赢、时长），没有逐人数据。
 * 老比赛的回放早过期了，请求解析也救不回来，所以宁可不写，别写 0:0。
 */
function scorePair(d) {
  const ps = d.players || [];
  const sum = (isR) =>
    ps.filter((p) => !!p.isRadiant === isR).reduce((s, p) => s + (Number(p.kills) || 0), 0);
  const r = Number(d.radiant_score) || sum(true);
  const dr = Number(d.dire_score) || sum(false);
  if (r === 0 && dr === 0) return [null, null];
  return [r, dr];
}

const isParsed = (d) => {
  const [a, b] = scorePair(d);
  return a !== null || b !== null;
};

/** 数据库里 date/timestamp 字段 → YYYY-MM-DD */
function dayKeyOf(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function fetchJson(url, cacheFile) {
  if (!REFRESH && cacheFile && fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      /* 缓存坏了就重拉 */
    }
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(35000) });
      if (r.status === 429) throw new Error('限流 429');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (cacheFile) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(d), 'utf8');
      }
      return d;
    } catch (e) {
      if (attempt === 4) throw e;
      const wait = 1500 * attempt;
      process.stdout.write(`   重试(${attempt}) ${e.message} ${wait}ms\r`);
      await sleep(wait);
    }
  }
}

const playerMatches = (acc) =>
  fetchJson(
    `https://api.opendota.com/api/players/${acc}/matches?limit=${LIMIT}`,
    path.join(CACHE, 'players', `${acc}.json`)
  );
const matchDetail = (id) =>
  fetchJson(
    `https://api.opendota.com/api/matches/${id}`,
    path.join(CACHE, 'matches', `${id}.json`)
  );

/* ---------- 数据装载 ---------- */
async function loadTournament(c, tid) {
  const t = (await c.query('SELECT * FROM public.tournaments WHERE id = $1', [tid])).rows[0];
  if (!t) throw new Error(`赛事 ${tid} 不存在`);

  const rows = (
    await c.query(
      `SELECT tp.team_id, tp.player_id, tp.position,
              p.nickname, p.group_nickname, p.game_id
         FROM public.team_players tp
         JOIN public.players p ON p.id = tp.player_id
        WHERE tp.tournament_id = $1`,
      [tid]
    )
  ).rows;

  const teams = (await c.query('SELECT id, name, rank FROM public.teams WHERE tournament_id = $1', [tid])).rows;

  const roster = rows.map((r) => ({
    teamId: String(r.team_id),
    playerId: String(r.player_id),
    name: r.group_nickname || r.nickname || String(r.player_id),
    gid: String(r.game_id || '').trim(),
  }));

  return { tournament: t, teams, roster };
}

/* ---------- 核心：聚类 ---------- */
/**
 * @param roster 队籍名单
 * @returns {Map<string, {id, start, mode, ours: Array<{acc,slot,win,hero,player}>}>}
 */
async function discoverMatches(roster, onProgress) {
  const withGid = roster.filter((r) => /^\d{5,12}$/.test(r.gid));
  const byAcc = new Map();
  withGid.forEach((r) => {
    if (!byAcc.has(r.gid)) byAcc.set(r.gid, []);
    byAcc.get(r.gid).push(r);
  });

  const accs = [...byAcc.keys()];
  const pool = new Map();

  for (let i = 0; i < accs.length; i++) {
    const acc = accs[i];
    onProgress && onProgress(i + 1, accs.length);
    let list = [];
    try {
      list = await playerMatches(acc);
    } catch (e) {
      continue;
    }
    if (!Array.isArray(list)) continue;

    for (const m of list) {
      if (!ANY_MODE && m.game_mode !== 2) continue; // 只要队长模式
      const k = String(m.match_id);
      if (!pool.has(k)) {
        pool.set(k, { id: k, start: m.start_time, mode: m.game_mode, ours: [] });
      }
      pool.get(k).ours.push({
        acc,
        slot: m.player_slot,
        win: !!m.radiant_win,
        hero: m.hero_id,
      });
    }
    await sleep(120); // 温和一点，别把免费额度打满
  }

  return { pool, withGid, total: accs.length };
}

/* ---------- 候选过滤 ---------- */
function filterCandidates(pool, win) {
  const out = [];
  for (const m of pool.values()) {
    const radiant = m.ours.filter((p) => p.slot < 128).length;
    const dire = m.ours.filter((p) => p.slot >= 128).length;
    const total = radiant + dire;
    if (total < MIN_HITS) continue;
    if (radiant < 2 || dire < 2) continue;
    if (win && (cst(m.start).key < win.from || cst(m.start).key > win.to)) continue;
    out.push({ ...m, radiant, dire, total, day: cst(m.start).key, weekday: cst(m.start).weekday });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/* ---------- 认队 ---------- */
function pickTeam(sidePlayers, rosterByPid, teamMembers, teamName) {
  const pidCount = new Map();
  for (const p of sidePlayers) {
    for (const r of rosterByPid.get(p.acc) || []) {
      pidCount.set(r.playerId, r.teamId);
    }
  }
  const score = new Map();
  for (const [pid, teamId] of pidCount) {
    if (!teamMembers.has(teamId)) continue;
    if (!teamMembers.get(teamId).has(pid)) continue;
    score.set(teamId, (score.get(teamId) || 0) + 1);
  }
  let bestId = null;
  let bestN = 0;
  for (const [teamId, n] of score) {
    if (n > bestN) {
      bestN = n;
      bestId = teamId;
    }
  }
  return bestN >= 3 ? { teamId: bestId, hitN: bestN, name: teamName.get(bestId) } : { teamId: null, hitN: bestN };
}

/* ---------- 轮次规划 ---------- */
/**
 * 把同一天的候选局按「对手组合 + 时间间隔」切成系列赛。
 * order_no 必须是「系列赛内第几局」，不是「当天第几局」——
 * 一天打 6 组 BO2 时按日累加会写出「第 11 局」这种不存在的局号。
 */
function groupSeries(list, detailByMId) {
  const series = [];
  for (const c of list) {
    const d = detailByMId.get(c.id);
    const pair =
      d && d.teamAId && d.teamBId
        ? [String(d.teamAId), String(d.teamBId)].sort().join('-')
        : `unknown-${c.id}`;
    let s = series.find((x) => x.pair === pair && c.start - x.lastStart <= SERIES_GAP * 60);
    if (!s) {
      s = { pair, items: [], lastStart: 0 };
      series.push(s);
    }
    s.items.push(c);
    s.lastStart = c.start;
  }
  series.sort((a, b) => a.items[0].start - b.items[0].start);
  return series;
}

/**
 * 轮次规划：
 *   周五 = 淘汰赛
 *   周六 = 半决赛 + 决赛（同一天多组对抗时，最后一组算决赛）
 *   其余 = 小组赛
 */
function planRounds(cands, detailByMId) {
  const byDay = new Map();
  for (const c of cands) {
    if (!byDay.has(c.day)) byDay.set(c.day, []);
    byDay.get(c.day).push(c);
  }

  const plan = new Map(); // match_id → { roundName, orderNo }
  const rounds = []; // 有序轮次名

  for (const day of [...byDay.keys()].sort()) {
    const list = byDay.get(day).sort((a, b) => a.start - b.start);
    const weekday = list[0].weekday;
    const series = groupSeries(list, detailByMId);

    series.forEach((s, idx) => {
      let name;
      if (weekday === 6) name = idx === series.length - 1 ? '决赛' : '半决赛';
      else if (weekday === 5) name = '淘汰赛';
      else name = '小组赛';

      if (!rounds.includes(name)) rounds.push(name);
      s.items.forEach((c, gi) => plan.set(c.id, { roundName: name, orderNo: gi + 1 }));
    });
  }

  return { plan, rounds };
}

/* ---------- 主流程 ---------- */
async function run() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  try {
    /* ---------- 全局扫描：找老赛季落在哪几天 ---------- */
    if (SCAN) {
      const rows = (
        await c.query(
          `SELECT DISTINCT p.id, p.game_id, COALESCE(p.group_nickname, p.nickname) AS name
             FROM public.team_players tp
             JOIN public.players p ON p.id = tp.player_id
            WHERE COALESCE(TRIM(p.game_id::text), '') <> ''`
        )
      ).rows;

      console.log(`全局扫描：库里有 SteamID 的选手 ${rows.length} 人`);
      const roster = rows.map((r) => ({
        playerId: String(r.id),
        name: r.name,
        gid: String(r.game_id).trim(),
        teamId: null,
      }));

      const { pool, total } = await discoverMatches(roster, (i, n) => {
        if (i % 10 === 0 || i === n) process.stdout.write(`  拉取选手对局 ${i}/${n}\r`);
      });
      process.stdout.write(' '.repeat(44) + '\r');
      const cands = filterCandidates(pool, null);
      console.log(`  选手 ${total} 人，CM 候选局 ${pool.size} 场，命中 >= ${MIN_HITS} 人的 ${cands.length} 场\n`);

      const byDay = new Map();
      cands.forEach((x) => {
        if (!byDay.has(x.day)) byDay.set(x.day, []);
        byDay.get(x.day).push(x);
      });

      const days = [...byDay.keys()].sort();
      let curMonth = '';
      for (const day of days) {
        const arr = byDay.get(day).sort((a, b) => a.start - b.start);
        const month = day.slice(0, 7);
        if (month !== curMonth) {
          console.log(`\n── ${month} ──`);
          curMonth = month;
        }
        const wd = WEEKDAY_CN[arr[0].weekday];
        const span = `${cst(arr[0].start).hm}–${cst(arr[arr.length - 1].start).hm}`;
        const mark = arr[0].weekday === 5 || arr[0].weekday === 6 ? ' ★' : '';
        console.log(`  ${day} ${wd}  ${String(arr.length).padStart(2)} 场  ${span}${mark}`);
      }

      const weekendDays = days.filter((d) => {
        const arr = byDay.get(d);
        return arr[0].weekday === 5 || arr[0].weekday === 6;
      });
      console.log(`\n共 ${days.length} 天有对局，其中周五/周六 ${weekendDays.length} 天：`);
      console.log('  ' + weekendDays.join('  '));
      console.log('\n把某个周末的日期范围传给 --window 即可写库，例如：');
      if (weekendDays.length) {
        console.log(`  node scripts/backfill-league.js --tournament 23 --window ${weekendDays[0]},${weekendDays[0]} --commit`);
      }
      return;
    }

    const tids = DISCOVER
      ? (await c.query('SELECT id FROM public.tournaments ORDER BY id')).rows.map((r) => Number(r.id))
      : [TID];

    for (const tid of tids) {
      console.log(`\n${'='.repeat(62)}`);
      const { tournament, teams, roster } = await loadTournament(c, tid);
      const withGid = roster.filter((r) => /^\d{5,12}$/.test(r.gid));
      const missing = roster.length - withGid.length;

      console.log(`赛事 ${tid} · ${tournament.name}`);
      console.log(
        `  队籍 ${roster.length} 人，有 SteamID ${withGid.length} 人` +
          (missing ? `，缺 ${missing} 人（这些人参与的对局认不出来）` : '')
      );

      if (withGid.length < 5) {
        console.log('  ✗ 有 SteamID 的人太少，跳过');
        continue;
      }

      const win = WINDOW_ARG
        ? {
            from: WINDOW_ARG.split(',')[0].trim(),
            to: (WINDOW_ARG.split(',')[1] || WINDOW_ARG.split(',')[0]).trim(),
          }
        : tournament.start_date
        ? {
            from: dayKeyOf(tournament.start_date),
            to: dayKeyOf(tournament.end_date || tournament.start_date),
          }
        : null;
      console.log(
        win
          ? `  时间窗口 ${win.from} ~ ${win.to}（CST）${WINDOW_ARG ? ' [手动指定]' : ''}`
          : '  无时间窗口：只做候选聚类报告，不写库（用 --window 指定）'
      );

      // 1) 拉对局并聚类
      const { pool, total } = await discoverMatches(roster, (i, n) => {
        // 别每个都刷屏，每 10 个报一次
        if (i % 10 === 0 || i === n) process.stdout.write(`  拉取选手对局 ${i}/${n}\r`);
      });
      process.stdout.write(' '.repeat(44) + '\r');
      console.log(`  共拉取 ${total} 位选手的对局，聚类出 ${pool.size} 场 CM 候选局`);

      // 2) 过滤
      const cands = filterCandidates(pool, win);
      console.log(`  满足「我方 >= ${MIN_HITS} 人且两边都有人」的：${cands.length} 场`);

      // 没有时间窗口时只报告：7 个老赛季共用同一批选手，
      // 不按日期切会给同一个赛季重复写同一批对局
      if (!win && cands.length > 0) {
        const byDayC = new Map();
        cands.forEach((x) => {
          if (!byDayC.has(x.day)) byDayC.set(x.day, []);
          byDayC.get(x.day).push(x);
        });
        console.log('\n  候选按日期分布（请用 --window 指定其中一段再写库）：');
        for (const day of [...byDayC.keys()].sort()) {
          const arr = byDayC.get(day);
          const wd = WEEKDAY_CN[arr[0].weekday];
          console.log(
            `    ${day} ${wd}  ${arr.length} 场  ${cst(arr[0].start).hm}–${cst(arr[arr.length - 1].start).hm}`
          );
        }
        console.log('\n  （未写库。示例：--window ' + [...byDayC.keys()].sort()[0] + ',' + [...byDayC.keys()].sort().slice(-1)[0] + ' --commit）');
        continue;
      }

      if (cands.length === 0) continue;

      // 3) 抓详情并认队
      const rosterByPid = new Map();
      for (const r of roster) {
        if (!rosterByPid.has(r.gid)) rosterByPid.set(r.gid, []);
        rosterByPid.get(r.gid).push(r);
      }
      const teamMembers = new Map(teams.map((t) => [String(t.id), new Set()]));
      roster.forEach((r) => teamMembers.get(r.teamId)?.add(r.playerId));
      const teamName = new Map(teams.map((t) => [String(t.id), t.name]));

      const detailByMId = new Map();
      for (const cand of cands) {
        const d = await matchDetail(cand.id);
        const sideOf = (isR) =>
          cand.ours
            .filter((p) => (p.slot < 128) === isR)
            .map((p) => ({ acc: p.acc }));
        const A = pickTeam(sideOf(true), rosterByPid, teamMembers, teamName);
        const B = pickTeam(sideOf(false), rosterByPid, teamMembers, teamName);
        detailByMId.set(cand.id, {
          raw: d,
          teamAId: A.teamId,
          teamBId: B.teamId,
          teamAName: A.name,
          teamBName: B.name,
          hitA: A.hitN,
          hitB: B.hitN,
        });
        await sleep(150);
      }

      // 4) 轮次规划
      const { plan, rounds } = planRounds(cands, detailByMId);

      // 5) 报告
      console.log(`\n  识别结果（轮次：${rounds.join(' → ') || '无'}）`);
      let ok = 0;
      let unknown = 0;
      let unparsed = 0;
      for (const cand of cands) {
        const d = detailByMId.get(cand.id);
        const t = cst(cand.start);
        const p = plan.get(cand.id) || {};
        const okTeam = d.teamAId && d.teamBId;
        if (okTeam) ok++;
        else unknown++;
        const aName = d.teamAName || `未识别(${d.hitA})`;
        const bName = d.teamBName || `未识别(${d.hitB})`;
        const [ra, rb] = scorePair(d.raw);
        const parsed = ra !== null;
        if (!parsed) unparsed++;
        const scoreText = parsed ? `${ra}:${rb}` : '未解析';
        console.log(
          `  ${t.key} ${WEEKDAY_CN[t.weekday]} ${t.hm}  ` +
            `${aName} ${scoreText} ${bName}  ` +
            `[${p.roundName || '?'} 第${p.orderNo || '?'}局] ${cand.id}`
        );
      }
      console.log(`  可识别对阵 ${ok} 场，未识别 ${unknown} 场，其中未解析 ${unparsed} 场`);

      // 6) 写库
      if (!COMMIT) {
        console.log('\n  （干跑，不写库。加 --commit 执行写入）');
        continue;
      }

      // 轮次
      const roundIdByName = new Map();
      const existRounds = (
        await c.query('SELECT id, name FROM public.tournament_rounds WHERE tournament_id = $1', [tid])
      ).rows;
      existRounds.forEach((r) => roundIdByName.set(r.name, r.id));
      for (let i = 0; i < rounds.length; i++) {
        const name = rounds[i];
        if (roundIdByName.has(name)) continue;
        const r = await c.query(
          `INSERT INTO public.tournament_rounds (tournament_id, name, order_no, created_at)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [tid, name, i + 1, new Date().toISOString()]
        );
        roundIdByName.set(name, r.rows[0].id);
      }

      let inserted = 0;
      let skipped = 0;
      await c.query('BEGIN');
      for (const cand of cands) {
        const d = detailByMId.get(cand.id);
        if (!d.teamAId || !d.teamBId) {
          skipped++;
          continue;
        }
        const exists = await c.query(
          'SELECT id FROM public.matches WHERE tournament_id = $1 AND dota_match_id = $2',
          [tid, cand.id]
        );
        if (exists.rowCount > 0) {
          skipped++;
          continue;
        }
        const p = plan.get(cand.id) || {};
        const roundId = roundIdByName.get(p.roundName) || null;
        const startIso = new Date(cand.start * 1000).toISOString();
        const winner = d.raw.radiant_win ? d.teamAId : d.teamBId;
        const [ra, rb] = scorePair(d.raw);
        const aLabel = teamName.get(String(d.teamAId)) || 'A';
        const bLabel = teamName.get(String(d.teamBId)) || 'B';

        // 赛事级明细
        await c.query(
          `INSERT INTO public.dota_matches
             (match_id, tournament_id, round_id, game_no, radiant_win, duration, start_time,
              radiant_name, dire_name, team_a_id, team_b_id, winner_team_id,
              radiant_score, dire_score, raw)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (match_id) DO UPDATE SET
             round_id=EXCLUDED.round_id, game_no=EXCLUDED.game_no,
             team_a_id=EXCLUDED.team_a_id, team_b_id=EXCLUDED.team_b_id,
             winner_team_id=EXCLUDED.winner_team_id, raw=EXCLUDED.raw, fetched_at=now()`,
          [
            cand.id,
            tid,
            roundId,
            p.orderNo || null,
            !!d.raw.radiant_win,
            Math.round(d.raw.duration || 0),
            startIso,
            (d.raw.radiant_name || '').slice(0, 80) || null,
            (d.raw.dire_name || '').slice(0, 80) || null,
            d.teamAId,
            d.teamBId,
            winner,
            d.raw.radiant_score ?? null,
            d.raw.dire_score ?? null,
            JSON.stringify(d.raw),
          ]
        );

        // 选手明细
        const parsed = isParsed(d.raw);
        for (const pl of d.raw.players || []) {
          const hit = rosterByPid.get(String(pl.account_id));
          const pid = hit ? hit[0].playerId : null;
          const isR = !!pl.isRadiant;
          const teamId = isR ? d.teamAId : d.teamBId;
          const inTeam = pid && teamMembers.get(String(teamId))?.has(pid);
          await c.query(
            `INSERT INTO public.dota_match_players
               (match_id, account_id, player_id, hero_id, is_radiant,
                kills, deaths, assists, net_worth, gpm, xpm, last_hits, hero_damage, is_standin)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (match_id, account_id) DO UPDATE SET
               player_id=EXCLUDED.player_id, hero_id=EXCLUDED.hero_id,
               kills=EXCLUDED.kills, deaths=EXCLUDED.deaths, assists=EXCLUDED.assists,
               net_worth=EXCLUDED.net_worth, gpm=EXCLUDED.gpm, xpm=EXCLUDED.xpm,
               last_hits=EXCLUDED.last_hits, hero_damage=EXCLUDED.hero_damage,
               is_standin=EXCLUDED.is_standin`,
            [
              cand.id,
              pl.account_id,
              pid,
              pl.hero_id,
              isR,
              // 未解析的局逐人数据全是 0，写成 null 让前端显示「—」，别假装 0/0/0
              parsed ? pl.kills ?? 0 : null,
              parsed ? pl.deaths ?? 0 : null,
              parsed ? pl.assists ?? 0 : null,
              parsed ? pl.net_worth ?? null : null,
              parsed ? pl.gold_per_min ?? null : null,
              parsed ? pl.xp_per_min ?? null : null,
              parsed ? pl.last_hits ?? null : null,
              parsed ? pl.hero_damage ?? null : null,
              !inTeam,
            ]
          );
        }

        // 赛程表一行 = 一局
        await c.query(
          `INSERT INTO public.matches
             (tournament_id, round_id, team_a_id, team_b_id, team_a_score, team_b_score,
              winner_team_id, status, order_no, note, dota_match_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'finished',$8,$9,$10,$11)`,
          [
            tid,
            roundId,
            d.teamAId,
            d.teamBId,
            ra,
            rb,
            winner,
            p.orderNo || 1,
            `${p.roundName || '对阵'}第${p.orderNo || 1}局 · ${aLabel} vs ${bLabel} · match ${cand.id}`,
            cand.id,
            new Date().toISOString(),
          ]
        );
        inserted++;
      }

      // 顺手补赛事起止日期（历史赛季原本是空的）。
      // 用 LEAST/GREATEST 而不是 COALESCE：分几次补录时窗口会扩大，
      // 第二次跑（比如先补周五再补周六）得能把 end_date 往后推。
      const days = cands.map((x) => x.day).sort();
      if (days.length > 0) {
        await c.query(
          `UPDATE public.tournaments
              SET start_date = LEAST(COALESCE(start_date, $2::date), $2::date),
                  end_date   = GREATEST(COALESCE(end_date, $3::date), $3::date)
            WHERE id = $1`,
          [tid, days[0], days[days.length - 1]]
        );
      }
      await c.query('COMMIT');
      console.log(`\n  ✓ 写入 ${inserted} 局，跳过 ${skipped} 局（已存在或认不出队）`);
      console.log(`  ✓ 赛事日期：${days[0] || '—'} ~ ${days[days.length - 1] || '—'}`);
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
}

run();
