/**
 * 验证「管理员功能只有管理员能看到」是在**服务端**过滤的，不是前端隐藏。
 *
 * 为什么单独一个脚本：这类问题在页面上看不出来 —— 管理员看到的是对的，
 * 普通用户看到的是对的，只有拉开网络面板或看 HTML 源码才能发现数据其实发出去了。
 *
 * 判据：普通用户拿到的 JSON 和 SSR HTML 里都不能出现管理员条目的文字。
 *
 * 用法：BASE=https://dota.playerallocationsystem.online node scripts/check-feed-admin.cjs
 * （只读，可以也应该打线上跑一次 —— 这是唯一能证明线上没泄漏的方式）
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
for (const l of envFile.split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const SECRET = crypto
  .createHash('sha256')
  .update(String(env.AUTH_SECRET || env.DATABASE_URL || 'dota2-community-local-dev'))
  .digest();
const sign = (name) => {
  const payload = Buffer.from(JSON.stringify({ n: name, t: Date.now() })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

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

// 只在管理员条目里出现的文字片段
const ADMIN_MARKS = ['后台可以改群友的登录账号名', '一键同步群友的 Steam 头像', '反馈工单可以在后台标记'];
const USER_MARKS = ['群友分布从「深圳 9 区」扩成全国三级', '英雄译名改用官方数据'];

(async () => {
  // ---- 1. 未登录 ----
  const anon = await (await fetch(BASE + '/api/feed')).json();
  const anonText = JSON.stringify(anon);
  ok(anon.success === true, '未登录能取 feed');
  ok(anon.isAdmin === false, 'isAdmin=false');
  ok(ADMIN_MARKS.every((m) => !anonText.includes(m)), '未登录的 JSON 里没有管理员条目',
    ADMIN_MARKS.filter((m) => anonText.includes(m)).join(' / ') || '干净');
  ok(USER_MARKS.every((m) => anonText.includes(m)), '未登录仍能看到普通更新');

  const feats = anon.items.filter((i) => i.kind === 'feature');
  ok(feats.length > 0, 'feature 类有条目', feats.length + ' 条');
  ok(feats.every((i) => i.version), '每条 feature 都带版本号', feats[0] && feats[0].version);

  // ---- 2. 管理员 ----
  //
  // ⚠ 打线上时本地签的 cookie 不被认（线上 AUTH_SECRET 是另一份），所以远端跑要传
  //   ADMIN_COOKIE。不传就跳过这几项而不是报失败 —— 否则每次线上跑都 4 个红叉，
  //   真出问题时反而看不出哪个是真问题。
  const REMOTE = !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE);
  const adminCookie = process.env.ADMIN_COOKIE || 'dd_session=' + sign('dom');
  const admin = await (await fetch(BASE + '/api/feed', { headers: { cookie: adminCookie } })).json();
  const adminText = JSON.stringify(admin);
  const adminFeats = admin.items.filter((i) => i.kind === 'feature');

  if (REMOTE && !admin.isAdmin) {
    console.log('  skip 远端 cookie 不被识别，跳过管理员可见性断言（可传 ADMIN_COOKIE）');
  } else {
    ok(admin.isAdmin === true, '管理员 isAdmin=true');
    ok(ADMIN_MARKS.every((m) => adminText.includes(m)), '管理员能看到管理员条目');
    ok(adminFeats.length > feats.length, '管理员的更新条目更多', `${feats.length} → ${adminFeats.length}`);
  }

  // ---- 3. /changelog 页面（SSR，要看 HTML 本身） ----
  const anonHtml = await (await fetch(BASE + '/changelog')).text();
  ok(anonHtml.includes('更新'), '未登录能打开日志页');
  ok(ADMIN_MARKS.every((m) => !anonHtml.includes(m)), '未登录的 HTML 里没有管理员条目',
    ADMIN_MARKS.filter((m) => anonHtml.includes(m)).join(' / ') || '干净');
  ok(anonHtml.includes('1.4.0'), 'HTML 里有版本号');

  if (!(REMOTE && !admin.isAdmin)) {
    const adminHtml = await (await fetch(BASE + '/changelog', { headers: { cookie: adminCookie } })).text();
    ok(ADMIN_MARKS.every((m) => adminHtml.includes(m)), '管理员的 HTML 里有管理员条目');
  }

  // ---- 4. 缓存头：带管理员差异的响应不能被共享缓存 ----
  //
  // 本地响应头是 no-store；线上会被 Nginx 改写成 no-cache
  // （/etc/nginx/snippets/laroja-proxy.conf 对所有 HTML/API 做 proxy_hide_header +
  //   add_header，看不到上游的值）。
  // no-cache 要求每次使用前回源验证，不会把本次的响应直接发给下一个人，可以接受；
  // 真正危险的是「public + s-maxage」—— 那才是谁先来谁决定后面所有人看到什么。
  const r = await fetch(BASE + '/api/feed');
  const cc = r.headers.get('cache-control') || '';
  const sharedCacheable = /\bpublic\b/i.test(cc) && /s-maxage\s*=\s*\d+/i.test(cc);
  ok(!sharedCacheable, '不是共享缓存（本地 no-store / 线上 no-cache 均可）', cc);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('ERR', e.message);
  process.exitCode = 1;
});
