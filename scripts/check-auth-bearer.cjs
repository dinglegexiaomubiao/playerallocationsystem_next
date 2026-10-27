#!/usr/bin/env node
/**
 * 会话双通道自测：网页 cookie 与小程序 Bearer 必须等价，且互不兜底。
 *
 * 为什么单独测这个：getSession 是所有权限闸门的唯一入口，它错一次就是全站错。
 * 而 Bearer 分支在浏览器里根本走不到（浏览器不会自己发 Authorization），
 * 线上出问题时手边没有现成的复现手段 —— 所以把断言写死在这里。
 *
 * 用法：node scripts/check-auth-bearer.cjs
 */
const path = require('path');

const LIB = path.join(__dirname, '..', 'lib', 'auth.js');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};
const eq = (title, actual, expect) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expect);
  a === e ? ok(title) : bad(title + '：得到 ' + a + '，期望 ' + e);
};

(async () => {
  const auth = await import('file://' + LIB.replace(/\\/g, '/'));
  const { createToken, verifyToken, getSession, isAdmin, setSessionCookie } = auth;

  console.log('\n[会话双通道自测]\n');

  const token = createToken('dom');

  // ---- 1. 两条通道等价 ----
  eq(
    'cookie 通道能取到会话',
    getSession({ cookies: { dd_session: token } }),
    { name: 'dom' }
  );
  eq(
    'Bearer 通道能取到会话',
    getSession({ headers: { authorization: 'Bearer ' + token } }),
    { name: 'dom' }
  );
  eq(
    'Bearer 大小写不敏感（bearer 小写也认）',
    getSession({ headers: { authorization: 'bearer ' + token } }),
    { name: 'dom' }
  );
  eq(
    'Authorization 头名大写也认',
    getSession({ headers: { Authorization: 'Bearer ' + token } }),
    { name: 'dom' }
  );

  // ---- 2. 拒绝无效输入 ----
  eq('没有 cookie/头 → 未登录', getSession({}), null);
  eq('req 为 undefined 不炸', getSession(undefined), null);
  eq('空 Bearer → 未登录', getSession({ headers: { authorization: 'Bearer ' } }), null);
  eq('别的认证方案（Basic）不认', getSession({ headers: { authorization: 'Basic abc' } }), null);
  eq('签名被改一位 → 未登录', getSession({ headers: { authorization: 'Bearer ' + token + 'x' } }), null);
  eq(
    'payload 被改（换个名字）→ 未登录',
    getSession({
      headers: { authorization: 'Bearer ' + Buffer.from(JSON.stringify({ n: 'hacker', t: Date.now() })).toString('base64url') + '.' + token.split('.')[1] },
    }),
    null
  );

  // ---- 3. ⚠ 坏 Bearer 不许退回 cookie ----
  eq(
    '坏 Bearer + 好 cookie → 判未登录（不兜底）',
    getSession({
      cookies: { dd_session: token },
      headers: { authorization: 'Bearer 乱写的token' },
    }),
    null
  );

  // ---- 4. 过期 ----
  const realNow = Date.now;
  const future = realNow() + 31 * 24 * 60 * 60 * 1000;
  Date.now = () => future;
  eq('31 天后的 token 失效', verifyToken(token), null);
  Date.now = realNow;
  eq('恢复时间后 token 仍有效', verifyToken(token), { name: 'dom' });

  // ---- 5. 管理员判定走同一条路 ----
  eq('Bearer(dom) → 是管理员', isAdmin({ headers: { authorization: 'Bearer ' + token } }), true);
  eq(
    'Bearer(普通群友) → 不是管理员',
    isAdmin({ headers: { authorization: 'Bearer ' + createToken('随便一个群友') } }),
    false
  );
  eq('无凭据 → 不是管理员', isAdmin({}), false);

  // ---- 6. setSessionCookie 必须把同一个串返回给调用方 ----
  const headers = {};
  const res = { setHeader: (k, v) => (headers[k] = v) };
  const issued = setSessionCookie(res, 'dom');
  issued === headers['Set-Cookie'].match(/dd_session=([^;]+)/)[1]
    ? ok('setSessionCookie 返回的 token 与写入 cookie 的一致')
    : bad('setSessionCookie 返回值和 cookie 不一致');
  /HttpOnly/.test(headers['Set-Cookie'])
    ? ok('cookie 仍带 HttpOnly（网页侧防护没被削弱）')
    : bad('cookie 丢了 HttpOnly');
  eq('签发的 token 可被 Bearer 通道验证', getSession({ headers: { authorization: 'Bearer ' + issued } }), {
    name: 'dom',
  });

  console.log('\n' + (fail ? '❌ ' + fail + ' 项未通过\n' : '✅ 会话双通道全部通过\n'));
  process.exit(fail ? 1 : 0);
})();
