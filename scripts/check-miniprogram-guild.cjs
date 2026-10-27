#!/usr/bin/env node
/**
 * 帮派写操作联调：建帮 → 改名换色 → 邀请 → 接受 → 踢人 → 转让 → 退出 → 解散。
 *
 * 为什么单独一个脚本：这条链路需要**两个都绑了选手行的账号**（帮派挂在 players 上），
 * 而 check-miniprogram-writes.cjs 的夹具是「没有选手行」的单账号 —— 混在一起
 * 会让那个脚本的语义变糊。夹具由 deploy/probe-account.cjs 的 up-pair 建。
 *
 * 每个动作都走真实页面方法（page.submitForm / page.removeMember …），
 * 不是直接打接口 —— 只有这样才能发现「页面拼的字段名和接口不一致」。
 *
 * 用法（先建夹具，跑完必须 down）：
 *   node deploy/probe-account.cjs up-pair Probe2026ga Probe2026gb   # 在服务器上跑
 *   MP_GA_PASS=Probe2026ga MP_GB_PASS=Probe2026gb \
 *     node scripts/check-miniprogram-guild.cjs
 *   node deploy/probe-account.cjs down                             # 在服务器上跑
 */
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const BASE = process.argv[2] || 'https://dota.playerallocationsystem.online';
const ROOT = path.join(__dirname, '..', 'miniprogram');

const GA = { user: process.env.MP_GA_USER || '_mp_ga', pass: process.env.MP_GA_PASS || '' };
const GB = { user: process.env.MP_GB_USER || '_mp_gb', pass: process.env.MP_GB_PASS || '' };

const rt = createRuntime({ baseUrl: BASE, root: ROOT, token: '' });
const { loadPage, wait } = rt;

const api = require(path.join(ROOT, 'utils', 'api.js'));
const session = require(path.join(ROOT, 'utils', 'session.js'));

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};
const expect = (cond, msg) => (cond ? ok(msg) : bad(msg));

const stamp = Date.now().toString().slice(-6);
const NAME1 = '自测帮派' + stamp;
const NAME2 = '自测帮派' + stamp + '改';

/** 换身份：token 走 session，和页面里读的是同一个来源 */
function asUser(t) {
  session.setLogin({ token: t.token, name: t.name, isAdmin: false });
}

async function login(u) {
  session.clearLogin();
  const res = await api.request('/api/login', { username: u.user, password: u.pass }, { method: 'POST' });
  if (!res || !res.token) throw new Error(u.user + ' 没拿到 token');
  const who = { token: res.token, name: res.name || u.user, playerId: '' };
  asUser(who);
  // 登录接口不返回 playerId（网页也不需要），要拿绑定的选手行得问 /api/guild
  const me = await api.request('/api/guild', null, { method: 'GET' });
  if (!me || me.bound !== true || !me.playerId) {
    throw new Error(u.user + ' 没有绑定选手行（夹具没建好？）');
  }
  who.playerId = String(me.playerId);
  return who;
}

/** 打开一个新页面实例并等首屏（配色表 + 我的帮派两个请求） */
async function openPage() {
  const p = await loadPage('pages/guild/guild.js');
  p.onLoad();
  await wait(2200);
  return p;
}

(async () => {
  console.log('\n[帮派写操作联调] ' + BASE + '\n');
  if (!GA.pass || !GB.pass) {
    console.log('缺少 MP_GA_PASS / MP_GB_PASS。先在服务器上跑：');
    console.log('  node _probe-account.cjs up-pair <pwdA> <pwdB>\n');
    process.exit(2);
  }

  let A = null;
  let B = null;
  let created = false;

  try {
    // ---------- 0. 登录 ----------
    console.log('— 登录两个临时账号 —');
    A = await login(GA);
    ok(GA.user + ' 登录成功（playerId ' + A.playerId + '）');
    B = await login(GB);
    ok(GB.user + ' 登录成功（playerId ' + B.playerId + '）');
    if (A.playerId === B.playerId) throw new Error('两个夹具账号绑到了同一个选手行');

    // ---------- 1. 未加入帮派时的首屏 ----------
    console.log('\n— 首屏（未加入帮派）—');
    asUser(A);
    let page = await openPage();
    expect(!page.data.needLogin, '已登录，不显示「去登录」');
    expect(page.data.unbound === false, '已绑定选手行（unbound=false）');
    expect(page.data.guild === null, '还没有帮派');
    expect(page.data.colors.length > 0, '配色表取到了 ' + page.data.colors.length + ' 支（来自 /api/options）');
    expect(page.data.unbound === false && !page.data.form.open, '还没打开表单');

    // ---------- 2. 配色占用：被占的不能选 ----------
    console.log('\n— 配色占用 —');
    const list = await api.request('/api/guilds', null, { method: 'GET' });
    const used = (list.guilds || []).map((g) => g.colorKey).filter(Boolean);
    const takenColor = page.data.colors.filter((c) => c.taken)[0];
    expect(!!takenColor, '有已占用配色被标成 taken（' + (takenColor ? takenColor.label : '无') + '）');
    if (takenColor) {
      page.openCreate();
      page.pickColor({ currentTarget: { dataset: { key: takenColor.key, taken: true } } });
      expect(page.data.form.colorKey === '', '点已占用的配色不会选中（' + takenColor.label + '）');
      // 服务端也要拦：绕过 UI 直接提交同一支配色
      const denied = await api
        .request('/api/guild', { name: '自测占用' + stamp, slogan: '', colorKey: takenColor.key }, { method: 'POST' })
        .then(() => null, (e) => e);
      expect(!!denied, '服务端也拒绝重复配色：' + (denied ? denied.message : '竟然建成功了'));
    }

    // ---------- 3. 创建 ----------
    console.log('\n— 创建帮派 —');
    const free1 = page.data.colors.filter((c) => !c.taken)[0];
    const free2 = page.data.colors.filter((c) => !c.taken)[1];
    if (!free1 || !free2) throw new Error('空闲配色不足两支（12 支里已被占 ' + used.length + '）');
    page.openCreate();
    page.onName({ detail: { value: NAME1 } });
    page.onSlogan({ detail: { value: '联调临时口号，稍后解散' } });
    page.pickColor({ currentTarget: { dataset: { key: free1.key, taken: false } } });
    page.submitForm();
    await wait(2500);
    if (page.data.form.error) throw new Error('创建失败：' + page.data.form.error);
    created = true;
    expect(!!page.data.guild, 'GET /api/guild 里有帮派了');
    expect(page.data.guild && page.data.guild.name === NAME1, '帮派名 = ' + NAME1);
    expect(page.data.guild && page.data.guild.isLeader, '我的角色是帮主');
    expect(page.data.guild && page.data.guild.members.length === 1, '成员 1 人（只有自己）');
    expect(page.data.guild && page.data.guild.colorKey === free1.key, '配色 = ' + free1.label);
    expect(page.data.sentInvites.length === 0, '还没发出邀请');

    // ---------- 4. 改名换色 ----------
    console.log('\n— 改名换色（PATCH）—');
    page.openEdit();
    expect(page.data.form.mode === 'edit' && page.data.form.name === NAME1, '编辑表单预填了现有名字');
    page.onName({ detail: { value: NAME2 } });
    page.pickColor({ currentTarget: { dataset: { key: free2.key, taken: false } } });
    page.submitForm();
    await wait(2500);
    if (page.data.form.error) throw new Error('改名失败：' + page.data.form.error);
    expect(page.data.guild && page.data.guild.name === NAME2, '名字改成 ' + NAME2);
    expect(page.data.guild && page.data.guild.colorKey === free2.key, '配色换成 ' + free2.label);

    // ---------- 5. 邀请 ----------
    console.log('\n— 邀请群友 —');
    const inv = await api.request(
      '/api/guild/invites',
      { playerId: B.playerId, message: '联调邀请，稍后撤回' },
      { method: 'POST' }
    );
    expect(!!inv && !!inv.id, '邀请已发出（#' + (inv && inv.id) + '）');
    asUser(A);
    page = await openPage();
    expect(page.data.sentInvites.length === 1, '发出的邀请出现在「已发出」里');
    expect(
      page.data.sentInvites[0] && page.data.sentInvites[0].playerId === B.playerId,
      '「已发出」里就是被邀请的那个人'
    );

    // ---------- 6. 对方接受 ----------
    console.log('\n— 对方接受邀请 —');
    asUser(B);
    page = await openPage();
    expect(page.data.guild === null, '接受之前 B 还没有帮派');
    expect(page.data.myInvites.length === 1, 'B 收到 1 条邀请');
    expect(page.data.myInvites[0] && page.data.myInvites[0].guildName === NAME2, '邀请来自 ' + NAME2);
    expect(page.data.myInvites[0] && page.data.myInvites[0].message === '联调邀请，稍后撤回', '邀请语原样显示');
    const inviteId = page.data.myInvites[0] && page.data.myInvites[0].id;
    page.respondInvite({
      currentTarget: { dataset: { id: inviteId, action: 'accept', name: NAME2 } }
    });
    await wait(2500);
    expect(page.data.guild && page.data.guild.name === NAME2, 'B 加入后看到帮派 ' + NAME2);
    expect(page.data.guild && !page.data.guild.isLeader, 'B 是成员（不是帮主）');
    expect(page.data.guild && page.data.guild.members.length === 2, '成员 2 人');
    expect(page.data.myInvites.length === 0, '邀请处理完就不在列表里了');

    // ---------- 7. 踢人 ----------
    console.log('\n— 移出成员 —');
    asUser(A);
    page = await openPage();
    expect(page.data.guild && page.data.guild.members.length === 2, '帮主看到 2 名成员');
    const bRow = page.data.guild.members.filter((m) => m.playerId === B.playerId)[0];
    expect(!!bRow, '成员列表里能定位到 B');
    page.removeMember({ currentTarget: { dataset: { id: B.playerId, nick: bRow ? bRow.nickname : '' } } });
    await wait(2500);
    expect(page.data.guild && page.data.guild.members.length === 1, '移出后成员 1 人');
    asUser(B);
    page = await openPage();
    expect(page.data.guild === null, 'B 被移出后确实没有帮派了');

    // ---------- 8. 转让帮主 ----------
    console.log('\n— 转让帮主 —');
    asUser(A);
    const inv2 = await api.request('/api/guild/invites', { playerId: B.playerId }, { method: 'POST' });
    asUser(B);
    await api.request('/api/guild/invites/' + inv2.id, { action: 'accept' }, { method: 'POST' });
    asUser(A);
    page = await openPage();
    expect(page.data.guild && page.data.guild.isLeader, '转让前 A 还是帮主');
    page.transferTo({ currentTarget: { dataset: { id: B.playerId, nick: '_mp_guild_b' } } });
    await wait(2500);
    expect(page.data.guild && !page.data.guild.isLeader, '转让后 A 变成成员');
    asUser(B);
    page = await openPage();
    expect(page.data.guild && page.data.guild.isLeader, 'B 现在是帮主');

    // ---------- 9. 退出帮派 ----------
    console.log('\n— 退出帮派 —');
    asUser(A);
    page = await openPage();
    page.leave();
    await wait(2500);
    expect(page.data.guild === null, 'A 退出后没有帮派了');

    // ---------- 10. 解散 ----------
    console.log('\n— 解散帮派 —');
    asUser(B);
    page = await openPage();
    expect(page.data.guild && page.data.guild.isLeader, 'B 仍是帮主（可以解散）');
    page.dissolve();
    await wait(2500);
    created = false;
    expect(page.data.guild === null, '解散后 B 没有帮派了');
    const after = await api.request('/api/guilds', null, { method: 'GET' });
    expect(
      !(after.guilds || []).some((g) => g.name === NAME1 || g.name === NAME2),
      '公开列表里已经没有这个测试帮派'
    );
  } catch (e) {
    bad(e.message);
  } finally {
    // 中途失败也要收尾：帮派留着比测试数据更麻烦（会长期占用一支配色）
    if (created) {
      try {
        for (const who of [B, A]) {
          if (!who) continue;
          asUser(who);
          const me = await api.request('/api/guild', null, { method: 'GET' });
          if (me && me.guild) {
            if (me.guild.isLeader) {
              await api.request('/api/guild', {}, { method: 'DELETE' });
              console.log('  · 已解散残留帮派（' + who.name + '）');
            } else {
              await api.request('/api/guild/leave', {}, { method: 'POST' });
              console.log('  · 已退出残留帮派（' + who.name + '）');
            }
          }
        }
      } catch (e) {
        console.log('  ! 残留帮派没清掉，请人工处理: ' + e.message);
        fail++;
      }
      if (fail) {
        console.log('  ! 失败时仍可能有残留，请用 node _probe-account.cjs down 兜底');
      }
    }
    session.clearLogin();
  }

  console.log('\n' + (fail ? '❌ ' + fail + ' 项没通过\n' : '✅ 帮派写操作全部通过，且没有残留\n'));
  process.exit(fail ? 1 : 0);
})();
