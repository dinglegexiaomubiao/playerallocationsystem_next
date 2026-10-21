#!/usr/bin/env node
/**
 * 「我的反馈」闭环自检：提交 → 用户端能看到 → 管理员改状态并留言 → 用户端能看到留言。
 *
 * 为什么用脚本跑而不是点页面：这条链路跨了两次身份切换（普通访客 / 管理员），
 * 手工点很容易漏掉「未登录访客按设备串认领」那一半，而那正是最容易坏的地方。
 *
 * 用法：
 *   COOKIE="dd_session=..." node scripts/check-feedback-loop.cjs
 *   BASE=http://127.0.0.1:3000 COOKIE=... node scripts/check-feedback-loop.cjs
 *
 * COOKIE 必须是线上 AUTH_SECRET 签出来的（本地签的线上无效）。
 */
const BASE = process.env.BASE || 'https://dota.playerallocationsystem.online';
const COOKIE = process.env.COOKIE || '';

const token = 'selfcheck' + Date.now().toString(36);
const MARK = '【链路自检】';
let failed = 0;

const ok = (cond, label, extra = '') => {
  if (cond) console.log(`✅ ${label}${extra ? ' — ' + extra : ''}`);
  else {
    failed += 1;
    console.log(`❌ ${label}${extra ? ' — ' + extra : ''}`);
  }
};

async function req(path, { method = 'GET', body, admin = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (admin && COOKIE) headers.Cookie = COOKIE;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON 响应（404 页面之类） */
  }
  return { status: res.status, json };
}

(async () => {
  console.log(`BASE=${BASE}  token=${token}\n`);

  // 1. 访客提交（不带登录态）
  const created = await req('/api/support', {
    method: 'POST',
    body: {
      kind: 'feedback',
      category: 'bug',
      message: `${MARK}自动检查用，可删除。`,
      client_token: token,
      detail: { form: '问题反馈', account: '未登录' },
    },
  });
  ok(created.status === 200 && created.json && created.json.success, '访客提交成功', `id=${created.json && created.json.id}`);
  const id = created.json && created.json.id;

  // 2. 同一个设备串能捞到这条
  const mine1 = await req(`/api/support?mine=1&token=${token}`);
  const list1 = (mine1.json && mine1.json.reports) || [];
  const hit = list1.find((r) => String(r.id) === String(id));
  ok(!!hit, '设备串查得到自己的反馈', `共 ${list1.length} 条`);
  ok(hit && hit.status === 'new', '初始状态为待处理', hit && hit.status);
  ok(hit && !hit.reply, '初始没有回复');

  // 3. 换个设备串应该看不到（越权检查）
  const other = await req(`/api/support?mine=1&token=otherdevice${Date.now().toString(36)}`);
  const list2 = (other.json && other.json.reports) || [];
  ok(!list2.some((r) => String(r.id) === String(id)), '别的设备串看不到这条');

  // 4. 没有凭证时不能查（接口不能被当成「列全部」）
  const anon = await req('/api/support?mine=1');
  const list3 = (anon.json && anon.json.reports) || [];
  ok(list3.length === 0, '无账号无设备串时返回空列表', `实际 ${list3.length} 条`);

  if (!COOKIE) {
    console.log('\n⚠ 没给 COOKIE，跳过管理员侧（改状态 / 留言）检查');
    process.exit(failed ? 1 : 0);
  }

  // 5. 管理员改状态 + 留言
  const REPLY = '已经看到了，正在排查。';
  const patched = await req('/api/support', {
    method: 'PATCH',
    admin: true,
    body: { id, status: 'doing', reply: REPLY },
  });
  ok(patched.status === 200 && patched.json && patched.json.success, '管理员设置「处理中」并留言');

  // 6. 用户端复查
  const mine2 = await req(`/api/support?mine=1&token=${token}`);
  const hit2 = ((mine2.json && mine2.json.reports) || []).find((r) => String(r.id) === String(id));
  ok(hit2 && hit2.status === 'doing', '用户端看到状态已变「处理中」', hit2 && hit2.status);
  ok(hit2 && hit2.reply === REPLY, '用户端看到管理员留言', hit2 && hit2.reply);
  ok(hit2 && !!hit2.replied_at, '留言带时间');
  ok(hit2 && hit2.replied_by === 'dom', '留言带署名', hit2 && hit2.replied_by);

  // 7. 越权检查：非管理员不能改
  const unauth = await req('/api/support', {
    method: 'PATCH',
    body: { id, status: 'done', reply: 'x' },
  });
  ok(unauth.status === 401 || unauth.status === 403, '未登录改不了状态', `HTTP ${unauth.status}`);

  // 8. 非法状态值要被拒
  const bad = await req('/api/support', {
    method: 'PATCH',
    admin: true,
    body: { id, status: 'whatever' },
  });
  ok(bad.status === 400, '非法状态值被拒绝', `HTTP ${bad.status}`);

  // 9. 空留言 = 撤回
  const cleared = await req('/api/support', {
    method: 'PATCH',
    admin: true,
    body: { id, reply: '' },
  });
  ok(cleared.status === 200, '空留言可撤回');
  const mine3 = await req(`/api/support?mine=1&token=${token}`);
  const hit3 = ((mine3.json && mine3.json.reports) || []).find((r) => String(r.id) === String(id));
  ok(hit3 && !hit3.reply && !hit3.replied_at, '撤回后用户端看不到留言', hit3 && String(hit3.reply));

  console.log(`\n清理用：DELETE FROM public.support_reports WHERE id = ${id};`);
  console.log(failed ? `\n${failed} 项未通过` : '\n全部通过');
  process.exit(failed ? 1 : 0);
})();
