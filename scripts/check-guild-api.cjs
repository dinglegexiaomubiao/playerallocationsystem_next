/**
 * 帮派接口的端到端自检（走真实 HTTP，两个账号互相验证互斥与权限）。
 *
 * 为什么必须有两个账号：这个功能的一半规则是「互斥」和「权限」——
 * 重名要拒、重色要拒、一人不能进两个帮、成员不能改帮派。
 * 单账号怎么点都测不出来，只能两个会话对着干。
 *
 * ⚠ 这个脚本会写数据库（造帮派、加成员、解散）。两道护栏：
 *   1. 只允许打本地地址，除非显式 ALLOW_REMOTE=1
 *   2. 清理时只删测试账号当帮主或当成员的帮派，不清空整表
 *      —— 万一有人不信邪打了线上，也不能把真实帮派删了
 *
 * 用法：
 *   BASE=http://127.0.0.1:3006 node scripts/check-guild-api.cjs
 *   A_NAME=dom B_NAME=04 node scripts/check-guild-api.cjs   # 两个已绑定选手的账号
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
  console.error(
    '✗ 这个脚本会写数据库，只允许打本地。\n' +
      '  真要打远端（会造/删数据）请显式加 ALLOW_REMOTE=1，并确认没有真实帮派会被影响。'
  );
  process.exit(1);
}

const SECRET = crypto
  .createHash('sha256')
  .update(String(env.AUTH_SECRET || env.DATABASE_URL || 'dota2-community-local-dev'))
  .digest();
const sign = (name) => {
  const payload = Buffer.from(JSON.stringify({ n: name, t: Date.now() })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

const A_NAME = process.env.A_NAME || 'dom';
const B_NAME = process.env.B_NAME || '04';

let pass = 0;
let fail = 0;
const ok = (cond, label, detail = '') => {
  if (cond) {
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
const pid = async (account) => {
  const r = await pool.query('SELECT player_id FROM public.play_score WHERE name=$1', [account]);
  return r.rows[0] ? Number(r.rows[0].player_id) : null;
};

(async () => {
  const [aId, bId] = await Promise.all([pid(A_NAME), pid(B_NAME)]);
  if (!aId || !bId) throw new Error('测试账号未绑定选手，换 A_NAME/B_NAME');

  // 只清这两个账号相关的帮派（当帮主的，或作为成员所在的）
  const clean = () =>
    pool.query(
      `DELETE FROM public.guilds
        WHERE leader_player_id = ANY($1::bigint[])
           OR id IN (SELECT guild_id FROM public.guild_members WHERE player_id = ANY($1::bigint[]))`,
      [[aId, bId]]
    );

  await clean();
  console.log(`账号 A=${A_NAME}(${aId})  B=${B_NAME}(${bId})\n`);

  // ---- 1. 初始状态 ----
  let r = await call(A_NAME, 'GET', '/api/guild');
  ok(r.status === 200 && r.d.success && r.d.bound === true, 'GET 我的帮派（未加入）', `bound=${r.d.bound}`);
  ok(r.d.guild === null, 'guild 为 null');
  ok(Object.keys(r.d.colors.used).length === 0 && r.d.colors.free.length === 12, '12 支配色全部可选');
  ok(r.d.maxMembers === 10, '上限 10 人');

  // ---- 2. 校验 ----
  r = await call(A_NAME, 'POST', '/api/guild', { name: '单', colorKey: 'crimson' });
  ok(r.status === 400 && /至少 2 个字/.test(r.d.error), '名字太短被拒', r.d.error);

  r = await call(A_NAME, 'POST', '/api/guild', { name: '甲帮' });
  ok(r.status === 400 && /配色/.test(r.d.error), '没选配色被拒', r.d.error);

  r = await call(A_NAME, 'POST', '/api/guild', { name: '加微信进群', colorKey: 'crimson' });
  ok(r.status === 400 && /引流|微信|违禁/.test(r.d.error), '违禁词被拦', r.d.error);

  // ---- 3. 正常创建 ----
  r = await call(A_NAME, 'POST', '/api/guild', { name: '甲帮', slogan: '今晚谁来守高地', colorKey: 'crimson' });
  ok(r.status === 201 && r.d.success, 'A 创建「甲帮」', 'id=' + r.d.id);
  ok(r.d.guild && r.d.guild.isLeader === true && r.d.guild.memberCount === 1, 'A 成为帮主，成员 1');
  ok(r.d.guild.slogan === '今晚谁来守高地', '口号已保存');

  r = await call(A_NAME, 'POST', '/api/guild', { name: '又一个帮', colorKey: 'moss' });
  ok(r.status === 400 && /已经在/.test(r.d.error), '已入帮后再创建被拒', r.d.error);

  // ---- 4. 互斥：名称 / 配色 ----
  r = await call(B_NAME, 'POST', '/api/guild', { name: '甲帮', colorKey: 'moss' });
  ok(r.status === 400 && /帮派名已经有人用/.test(r.d.error), '重名被拒', r.d.error);

  r = await call(B_NAME, 'POST', '/api/guild', { name: '乙帮', colorKey: 'crimson' });
  ok(r.status === 400 && /配色已经被/.test(r.d.error), '重色被拒', r.d.error);

  r = await call(B_NAME, 'POST', '/api/guild', { name: '乙帮', colorKey: 'moss' });
  ok(r.status === 201, 'B 创建「乙帮」（苔绿）');

  r = await call(B_NAME, 'PATCH', '/api/guild', { name: '甲帮' });
  ok(r.status === 400 && /帮派名已经有人用/.test(r.d.error), 'PATCH 改成别人的名字被拒', r.d.error);

  r = await call(B_NAME, 'PATCH', '/api/guild', { colorKey: 'crimson' });
  ok(r.status === 400 && /配色已经被/.test(r.d.error), 'PATCH 抢别人的配色被拒', r.d.error);

  // ---- 5. 修改 ----
  r = await call(B_NAME, 'PATCH', '/api/guild', { slogan: '周末爬山' });
  ok(r.status === 200 && r.d.guild.slogan === '周末爬山', '改口号成功');

  r = await call(B_NAME, 'PATCH', '/api/guild', { name: '乙帮改', colorKey: 'indigo' });
  ok(r.status === 200 && r.d.guild.name === '乙帮改' && r.d.guild.colorKey === 'indigo', '同时改名改色成功');

  r = await call(A_NAME, 'GET', '/api/guild');
  ok(r.d.colors.free.includes('moss'), '换色后旧配色释放');

  // ---- 6. 群友列表缓存已清（否则卡片要等 45 秒） ----
  const pl = await (await fetch(BASE + '/api/players')).json();
  const rowA = (pl.players || []).find((p) => String(p.id) === String(aId));
  const rowB = (pl.players || []).find((p) => String(p.id) === String(bId));
  ok(rowA && rowA.guild && rowA.guild.name === '甲帮', '/api/players 立刻带上 A 的帮派', rowA && rowA.guild && rowA.guild.name);
  ok(rowB && rowB.guild && rowB.guild.colorKey === 'indigo', '/api/players 带上 B 的新配色');

  // ---- 7. 权限 ----
  r = await call(B_NAME, 'DELETE', '/api/guild');
  ok(r.status === 200, 'B 解散自己的帮派');
  r = await call(A_NAME, 'GET', '/api/guild');
  const gid = r.d.guild.id;
  ok(r.d.guild.memberCount === 1, '解散后 A 帮派仍是 1 人');

  // 模拟「邀请已同意」的结果（P3 才做邀请流程，这里直接建成员关系）
  await pool.query("INSERT INTO public.guild_members (guild_id, player_id, role) VALUES ($1,$2,'member')", [gid, bId]);

  r = await call(B_NAME, 'GET', '/api/guild');
  ok(r.d.guild && r.d.guild.isLeader === false, 'B 以成员身份进帮，isLeader=false');
  ok(r.d.guild.members.length === 2, '成员列表 2 人');

  r = await call(B_NAME, 'PATCH', '/api/guild', { name: '成员改的名' });
  ok(r.status === 403 && /只有帮主/.test(r.d.error), '成员不能改帮派', r.d.error);

  r = await call(B_NAME, 'DELETE', '/api/guild');
  ok(r.status === 403, '成员不能解散帮派');

  r = await call(A_NAME, 'POST', '/api/guild/leave');
  ok(r.status === 400 && /帮主不能直接退出/.test(r.d.error), '帮主不能直接退出', r.d.error);

  r = await call(A_NAME, 'DELETE', '/api/guild/members/' + aId);
  ok(r.status === 400 && /不能移除自己/.test(r.d.error), '帮主不能移除自己', r.d.error);

  // ---- 8. 转让 ----
  r = await call(A_NAME, 'POST', '/api/guild/transfer', { playerId: bId });
  ok(r.status === 200, 'A 把帮主转让给 B');

  r = await call(A_NAME, 'GET', '/api/guild');
  ok(r.d.guild.isLeader === false, '转让后 A 变成员');
  r = await call(B_NAME, 'GET', '/api/guild');
  ok(r.d.guild.isLeader === true, '转让后 B 变帮主');
  const lg = await pool.query('SELECT leader_player_id FROM public.guilds WHERE id=$1', [gid]);
  ok(Number(lg.rows[0].leader_player_id) === bId, 'guilds.leader_player_id 同步更新');

  // ---- 9. 退出 / 移除 ----
  r = await call(A_NAME, 'POST', '/api/guild/leave');
  ok(r.status === 200, '成员 A 可以自己退出');

  r = await call(B_NAME, 'GET', '/api/guild');
  ok(r.d.guild.memberCount === 1, '退出后剩 1 人');

  await pool.query("INSERT INTO public.guild_members (guild_id, player_id, role) VALUES ($1,$2,'member')", [gid, aId]);
  r = await call(B_NAME, 'DELETE', '/api/guild/members/' + aId);
  ok(r.status === 200, '帮主可以移除成员');

  r = await call(B_NAME, 'DELETE', '/api/guild/members/' + aId);
  ok(r.status === 404 && /不在你的帮派/.test(r.d.error), '移除不在帮里的人 → 404', r.d.error);

  // ---- 10. 解散清理 ----
  r = await call(B_NAME, 'DELETE', '/api/guild');
  ok(r.status === 200, 'B 解散帮派');

  const left = await pool.query(
    `SELECT (SELECT count(*) FROM public.guilds WHERE leader_player_id = ANY($1::bigint[]))::int g,
            (SELECT count(*) FROM public.guild_members WHERE player_id = ANY($1::bigint[]))::int m`,
    [[aId, bId]]
  );
  ok(left.rows[0].g === 0 && left.rows[0].m === 0, '两个账号名下已清空', JSON.stringify(left.rows[0]));

  const pl2 = await (await fetch(BASE + '/api/players')).json();
  const rowA2 = (pl2.players || []).find((p) => String(p.id) === String(aId));
  ok(rowA2 && rowA2.guild === null, '/api/players 回到 guild=null（缓存也清了）');

  await clean();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})()
  .catch(async (e) => {
    console.error('ERR', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
