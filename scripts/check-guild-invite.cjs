/**
 * 帮派邀请的端到端自检（两个真实账号，走 HTTP）。
 *
 * 为什么单独一个脚本：邀请是整个帮派功能里状态最多的一环 ——
 * pending / accepted / rejected / cancelled，加上「一人一帮」和「满员」两种拦截。
 * 这些分支用单账号点不出来，必须一个当帮主发、一个当被邀请人收。
 *
 * ⚠ 会写数据库。两道护栏：只允许打本地（远端要 ALLOW_REMOTE=1），
 *   清理只删测试账号相关的帮派。
 *
 * 用法：
 *   BASE=http://127.0.0.1:3006 node scripts/check-guild-invite.cjs
 *   A_NAME=dom B_NAME=04 node scripts/check-guild-invite.cjs
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
for (const l of envFile.split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE) && process.env.ALLOW_REMOTE !== '1') {
  console.error('✗ 这个脚本会写数据库，只允许打本地。远端请显式加 ALLOW_REMOTE=1。');
  process.exit(1);
}

const SECRET = crypto
  .createHash('sha256')
  .update(String(env.AUTH_SECRET || env.DATABASE_URL || 'dota2-community-local-dev'))
  .digest();
const sign = (name) => {
  const p = Buffer.from(JSON.stringify({ n: name, t: Date.now() })).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
};

const A_NAME = process.env.A_NAME || 'dom';
const B_NAME = process.env.B_NAME || '04';

let pass = 0;
let fail = 0;
const ok = (c, label, detail = '') => {
  if (c) {
    pass++;
    console.log('  ok   ' + label + (detail ? '  (' + detail + ')' : ''));
  } else {
    fail++;
    console.log('  FAIL ' + label + (detail ? '  (' + detail + ')' : ''));
  }
};

const call = async (who, method, p, body) => {
  const r = await fetch(BASE + p, {
    method,
    headers: {
      cookie: 'dd_session=' + sign(who),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
};

const pool = new Pool({ connectionString: env.DATABASE_URL });
const pid = async (a) => {
  const r = await pool.query('SELECT player_id FROM public.play_score WHERE name=$1', [a]);
  return r.rows[0] ? Number(r.rows[0].player_id) : null;
};

(async () => {
  const [aId, bId] = await Promise.all([pid(A_NAME), pid(B_NAME)]);
  if (!aId || !bId) throw new Error('测试账号未绑定选手');

  const clean = () =>
    pool.query(
      `DELETE FROM public.guilds
        WHERE leader_player_id = ANY($1::bigint[])
           OR id IN (SELECT guild_id FROM public.guild_members WHERE player_id = ANY($1::bigint[]))`,
      [[aId, bId]]
    );

  await clean();
  console.log(`A=${A_NAME}(${aId}) 帮主  B=${B_NAME}(${bId}) 被邀请人\n`);

  // 准备：A 建帮
  let r = await call(A_NAME, 'POST', '/api/guild', { name: '邀请测试帮', colorKey: 'plum' });
  ok(r.status === 201, 'A 建帮');
  const gid = r.d.id;

  // ---- 1. 发邀请 ----
  r = await call(A_NAME, 'POST', '/api/guild/invites', { playerId: bId, message: '一起打天梯啊，缺个四号位' });
  ok(r.status === 201 && r.d.success, 'A 邀请 B', 'invite=' + r.d.id);
  const inviteId = r.d.id;

  r = await call(A_NAME, 'POST', '/api/guild/invites', { playerId: bId, message: '再来一次' });
  ok(r.status === 400 && /已经邀请过/.test(r.d.error), '重复邀请被拒', r.d.error);

  r = await call(A_NAME, 'POST', '/api/guild/invites', { playerId: aId });
  ok(r.status === 400 && /不能邀请自己/.test(r.d.error), '不能邀请自己', r.d.error);

  r = await call(A_NAME, 'POST', '/api/guild/invites', { playerId: 999999999 });
  ok(r.status === 404, '邀请不存在的群友 → 404', String(r.status));

  // 邀请语要过审核
  r = await call(A_NAME, 'POST', '/api/guild/invites', { playerId: bId, message: '加微信详聊' });
  ok(r.status === 400 && /引流|微信/.test(r.d.error), '邀请语违禁词被拦', r.d.error);

  // ---- 2. 被邀请人视角 ----
  r = await call(B_NAME, 'GET', '/api/guild/invites');
  ok(r.status === 200 && r.d.invites.length === 1, 'B 收到 1 条邀请', String(r.d.invites.length));
  const inv = r.d.invites[0];
  ok(inv.guild.name === '邀请测试帮', '邀请里带帮派名', inv.guild.name);
  ok(inv.inviterName === 'dom', '邀请里带帮主昵称', inv.inviterName);
  ok(/四号位/.test(inv.message), '邀请里带邀请语', inv.message);
  ok(inv.guild.colorKey === 'plum', '邀请里带配色', inv.guild.colorKey);

  // B 此时还没进帮
  r = await call(B_NAME, 'GET', '/api/guild');
  ok(r.d.guild === null, 'B 还没加入帮派');
  ok(r.d.pendingInvites === 1, 'B 的 pendingInvites=1', String(r.d.pendingInvites));

  // ---- 3. 同意 ----
  r = await call(B_NAME, 'POST', '/api/guild/invites/' + inviteId, { action: 'accept' });
  ok(r.status === 200 && r.d.joined === true, 'B 同意加入', r.d.guildName);

  r = await call(B_NAME, 'GET', '/api/guild');
  ok(r.d.guild && r.d.guild.name === '邀请测试帮', 'B 已在帮里');
  ok(r.d.guild.isLeader === false, 'B 是成员不是帮主');
  ok(r.d.myInvites.length === 0, '同意后邀请列表清空');

  r = await call(A_NAME, 'GET', '/api/guild');
  ok(r.d.guild.memberCount === 2, 'A 那边成员数变 2', String(r.d.guild.memberCount));

  // 卡片数据也跟着变（缓存已清）
  const pl = await (await fetch(BASE + '/api/players')).json();
  const rowB = (pl.players || []).find((p) => String(p.id) === String(bId));
  ok(rowB && rowB.guild && rowB.guild.name === '邀请测试帮', '/api/players 里 B 带上帮派');

  // 重复处理同一条邀请
  r = await call(B_NAME, 'POST', '/api/guild/invites/' + inviteId, { action: 'accept' });
  ok(r.status === 400 && /已经处理过/.test(r.d.error), '同一条邀请不能再处理', r.d.error);

  // ---- 4. 成员不能发邀请 ----
  r = await call(B_NAME, 'POST', '/api/guild/invites', { playerId: aId });
  ok(r.status === 403 && /只有帮主/.test(r.d.error), '成员不能发邀请', r.d.error);

  // ---- 5. 拒绝 ----
  await call(A_NAME, 'DELETE', '/api/guild/members/' + bId); // 先移除，腾出位置
  r = await call(A_NAME, 'POST', '/api/guild/invites', { playerId: bId, message: '第二次邀请' });
  ok(r.status === 201, '再次邀请 B');
  const inv2 = r.d.id;

  r = await call(B_NAME, 'POST', '/api/guild/invites/' + inv2, { action: 'reject' });
  ok(r.status === 200 && r.d.joined === false, 'B 拒绝');
  r = await call(B_NAME, 'GET', '/api/guild/invites');
  ok(r.d.invites.length === 0, '拒绝后邀请不再出现');

  // 拒绝后可以再邀请（旧记录不挡）
  r = await call(A_NAME, 'POST', '/api/guild/invites', { playerId: bId, message: '第三次' });
  ok(r.status === 201, '拒绝过之后还能再邀请');

  // ---- 6. 撤回 ----
  const inv3 = r.d.id;
  r = await call(A_NAME, 'DELETE', '/api/guild/invites/' + inv3);
  ok(r.status === 200, '帮主撤回邀请');
  r = await call(B_NAME, 'GET', '/api/guild/invites');
  ok(r.d.invites.length === 0, '撤回后 B 看不到');

  r = await call(A_NAME, 'DELETE', '/api/guild/invites/' + inv3);
  ok(r.status === 404, '重复撤回 → 404', String(r.status));

  // ---- 7. 已在帮派的人不能被邀请 ----
  await pool.query("INSERT INTO public.guild_members (guild_id, player_id, role) VALUES ($1,$2,'member')", [gid, bId]);
  r = await call(A_NAME, 'POST', '/api/guild/invites', { playerId: bId });
  ok(r.status === 400 && /已经加入帮派/.test(r.d.error), '已在帮的人不能被邀请', r.d.error);
  await pool.query('DELETE FROM public.guild_members WHERE guild_id=$1 AND player_id=$2', [gid, bId]);

  // ---- 8. 满员拦截（塞到 10 人）----
  const fill = await pool.query(
    `SELECT id FROM public.players WHERE id NOT IN (SELECT player_id FROM public.guild_members)
      AND id <> $1 ORDER BY score DESC NULLS LAST LIMIT 9`,
    [bId]
  );
  for (const x of fill.rows) {
    await pool.query("INSERT INTO public.guild_members (guild_id, player_id, role) VALUES ($1,$2,'member')", [gid, x.id]);
  }
  r = await call(A_NAME, 'GET', '/api/guild');
  const nowCount = r.d.guild.memberCount;
  ok(nowCount === 10, '帮派已满 10 人', String(nowCount));

  r = await call(A_NAME, 'POST', '/api/guild/invites', { playerId: bId });
  ok(r.status === 400 && /满员/.test(r.d.error), '满员时不能发邀请', r.d.error);

  // 满员时如果有旧邀请，同意也要被拒
  await pool.query('DELETE FROM public.guild_members WHERE guild_id=$1 AND player_id <> $2', [gid, aId]);
  r = await call(A_NAME, 'POST', '/api/guild/invites', { playerId: bId, message: '占位' });
  const invFull = r.d.id;
  const refill = await pool.query(
    `SELECT id FROM public.players WHERE id NOT IN (SELECT player_id FROM public.guild_members)
      AND id <> $1 ORDER BY score DESC NULLS LAST LIMIT 9`,
    [bId]
  );
  for (const x of refill.rows) {
    await pool.query("INSERT INTO public.guild_members (guild_id, player_id, role) VALUES ($1,$2,'member')", [gid, x.id]);
  }
  r = await call(B_NAME, 'POST', '/api/guild/invites/' + invFull, { action: 'accept' });
  ok(r.status === 400 && /满员/.test(r.d.error), '满员后同意被拒', r.d.error);

  // ---- 9. 清理 ----
  await clean();
  const left = await pool.query(
    'SELECT (SELECT count(*) FROM public.guilds WHERE leader_player_id = ANY($1::bigint[]))::int g',
    [[aId, bId]]
  );
  ok(left.rows[0].g === 0, '测试数据已清理');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})()
  .catch(async (e) => {
    console.error('ERR', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
