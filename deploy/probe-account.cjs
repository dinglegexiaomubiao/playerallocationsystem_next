#!/usr/bin/env node
/**
 * 临时探针账号（dev only）：验证登录与写操作时用，用完必须 down 掉。
 *
 * 为什么要它：线上真实账号的密码不能拿来当测试夹具，而这些写操作又必须
 * 「有真实密码 + 已绑定选手行」才走得通（帮派是挂在 players 上的）。
 *
 * 两种夹具：
 *   _mp_probe     单账号，player_id = NULL —— 验证登录、以及「没绑选手」的分支
 *   _mp_ga/_mp_gb 成对账号，各绑一个临时选手行（9900000000000000xx）
 *                 —— 验证帮派链路（建帮 → 邀请 → 接受 → 踢人 → 转让 → 退出 → 解散）
 *
 * 临时选手行的 id 写死成 18 位（真实雪花号是 17 位 179…），一眼能区分；
 * down 时按 id 精确删除，不会误伤真实群友。
 *
 * 用法（在服务器上、source 过 .env.local 后）：
 *   node _probe-account.cjs up <password>            建单账号
 *   node _probe-account.cjs up-pair <pwdA> <pwdB>    建成对账号 + 临时选手行
 *   node _probe-account.cjs down                     删掉以上所有，含帮派残留
 *   node _probe-account.cjs list                     看还剩哪些
 */
const crypto = require('crypto');
const { Pool } = require('pg');

const SINGLE = { name: '_mp_probe', player: null, nick: null };
const PAIR = [
  { name: '_mp_ga', player: '990000000000000001', nick: '_mp_guild_a' },
  { name: '_mp_gb', player: '990000000000000002', nick: '_mp_guild_b' },
];
const ALL = [SINGLE].concat(PAIR);
const PLAYER_IDS = PAIR.map((x) => x.player);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'on' ? { rejectUnauthorized: false } : false,
});

/** 与 lib/password.js 同格式：`<salt>:<sha256(salt + password)>` */
function hashPasswordWithSalt(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

/** 临时选手行：只填确实存在的列（列漂移见记忆，别假设线上有全部列） */
async function ensurePlayer(p) {
  const cols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='players'"
  );
  const has = (n) => cols.rows.some((r) => r.column_name === n);
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  await pool.query('DELETE FROM public.players WHERE id = $1', [p.player]);
  const fields = ['id', 'nickname'];
  const values = [p.player, p.nick];
  if (has('group_nickname')) {
    fields.push('group_nickname');
    values.push(p.nick);
  }
  // created_at / updated_at 是 varchar 且只到天（见记忆），写字符串最安全
  if (has('created_at')) {
    fields.push('created_at');
    values.push(day);
  }
  if (has('updated_at')) {
    fields.push('updated_at');
    values.push(day);
  }
  const ph = fields.map((_, i) => '$' + (i + 1)).join(', ');
  await pool.query(`INSERT INTO public.players (${fields.join(', ')}) VALUES (${ph})`, values);
}

async function ensureAccount(name, password, playerId) {
  await pool.query('DELETE FROM public.play_score WHERE name = $1', [name]);
  await pool.query(
    'INSERT INTO public.play_score (name, count, password, player_id) VALUES ($1, 0, $2, $3)',
    [name, hashPasswordWithSalt(password), playerId]
  );
}

/**
 * 清场：先把引用临时选手行的帮派数据删干净，再删账号、最后删选手行。
 * 顺序错了会被唯一索引/引用挡住，留下删不掉的孤儿帮派。
 */
async function purge() {
  const ids = PLAYER_IDS;
  /**
   * 每条语句的参数下标必须从 $1 连续开始 —— PG 对「没被引用的参数」无法推断类型，
   * 会直接报 could not determine data type of parameter $1（踩过一次）。
   * bigint 列一律显式 ::bigint，因为传过去的是 JS 字符串。
   */
  const big = (from, n) => Array.from({ length: n }, (_, i) => '$' + (from + i) + '::bigint').join(', ');
  const plain = (from, n) => Array.from({ length: n }, (_, i) => '$' + (from + i)).join(', ');

  const guilds = await pool.query(
    `SELECT id FROM public.guilds WHERE leader_player_id IN (${big(1, ids.length)})`,
    ids
  );
  const guildIds = guilds.rows.map((r) => String(r.id));

  if (guildIds.length) {
    const byGuild = big(1, guildIds.length);
    const byPlayer = big(guildIds.length + 1, ids.length);
    const args = guildIds.concat(ids);
    await pool.query(
      `DELETE FROM public.guild_invites
        WHERE guild_id IN (${byGuild}) OR player_id IN (${byPlayer}) OR inviter_player_id IN (${byPlayer})`,
      args
    );
    await pool.query(
      `DELETE FROM public.guild_members WHERE guild_id IN (${byGuild}) OR player_id IN (${byPlayer})`,
      args
    );
    await pool.query(`DELETE FROM public.guilds WHERE id IN (${byGuild})`, guildIds);
  } else {
    const byPlayer = big(1, ids.length);
    await pool.query(
      `DELETE FROM public.guild_invites WHERE player_id IN (${byPlayer}) OR inviter_player_id IN (${byPlayer})`,
      ids
    );
    await pool.query(`DELETE FROM public.guild_members WHERE player_id IN (${byPlayer})`, ids);
  }

  const names = ALL.map((x) => x.name);
  const acc = await pool.query(
    `DELETE FROM public.play_score WHERE name IN (${plain(1, names.length)})`,
    names
  );
  const pl = await pool.query(`DELETE FROM public.players WHERE id IN (${big(1, ids.length)})`, ids);
  return { guilds: guildIds.length, accounts: acc.rowCount, players: pl.rowCount };
}

(async () => {
  const cmd = process.argv[2] || '';
  try {
    if (cmd === 'up') {
      const pwd = process.argv[3];
      if (!pwd || pwd.length < 6) throw new Error('需要密码（至少 6 位）');
      await ensureAccount(SINGLE.name, pwd, null);
      const r = await pool.query(
        'SELECT name, player_id, must_change_password FROM public.play_score WHERE name = $1',
        [SINGLE.name]
      );
      console.log('已建立单账号:', JSON.stringify(r.rows[0]));
    } else if (cmd === 'up-pair') {
      const pwA = process.argv[3];
      const pwB = process.argv[4];
      if (!pwA || !pwB || pwA.length < 6 || pwB.length < 6) {
        throw new Error('需要两个密码（各至少 6 位）');
      }
      await purge();
      await ensurePlayer(PAIR[0]);
      await ensurePlayer(PAIR[1]);
      await ensureAccount(PAIR[0].name, pwA, PAIR[0].player);
      await ensureAccount(PAIR[1].name, pwB, PAIR[1].player);
      const r = await pool.query(
        'SELECT name, player_id FROM public.play_score WHERE name = ANY($1::varchar[]) ORDER BY name',
        [PAIR.map((x) => x.name)]
      );
      console.log('已成对建立:', JSON.stringify(r.rows));
    } else if (cmd === 'down') {
      const out = await purge();
      console.log('已清理:', JSON.stringify(out));
    } else if (cmd === 'list') {
      const r = await pool.query(
        "SELECT name, player_id FROM public.play_score WHERE name LIKE '\\_%' ORDER BY name"
      );
      console.log('下划线开头的账号:', JSON.stringify(r.rows));
      const p = await pool.query(
        'SELECT id::text, nickname FROM public.players WHERE id = ANY($1::bigint[])',
        [PLAYER_IDS]
      );
      console.log('临时选手行:', JSON.stringify(p.rows));
    } else {
      console.log('用法: up <pwd> | up-pair <pwdA> <pwdB> | down | list');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error('失败:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
