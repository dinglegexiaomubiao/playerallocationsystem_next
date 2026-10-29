/**
 * 内容安全三层（词表 → 微信 msgSecCheck → DeepSeek）的自检。
 *
 * 重点是**降级路径**：审核服务不可用时必须放行，绝不能因为拿不到 openid 或接口报错
 * 就让用户发不出内容。这类 bug 平时看不出来，线上却会变成「发帖一直失败」。
 *
 * 不联网、不写库，可随时跑：node scripts/check-mp-sec.cjs
 */
const assert = require('assert');

let pass = 0;
let fail = 0;

function ok(cond, name, extra) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name + (extra ? '  → ' + extra : ''));
  }
}

(async () => {
  // 必须在 import 前把开关清干净，避免读到跑脚本这台机器的真实配置
  delete process.env.MP_APPID;
  delete process.env.MP_SECRET;

  const sec = await import('../lib/mp-sec.mjs');

  console.log('[未配置 AppSecret：整层静默跳过]');
  ok(sec.isWxSecEnabled() === false, '没配 MP_APPID/MP_SECRET 时 isWxSecEnabled() === false');

  const r1 = await sec.msgSecCheck('今晚八点开黑，缺一个辅助');
  ok(r1.ok === true, '未配置时放行');
  ok(r1.skipped === 'not-configured', '跳过原因是 not-configured', JSON.stringify(r1));

  console.log('\n[配了密钥但没 openid：必须明确跳过，不能假装查过]');
  process.env.MP_APPID = 'wx_test_appid';
  process.env.MP_SECRET = 'test_secret';
  ok(sec.isWxSecEnabled() === true, '配好后 isWxSecEnabled() === true');

  const r2 = await sec.msgSecCheck('今晚八点开黑，缺一个辅助');
  ok(r2.ok === true, '没有 openid 时放行');
  // 这是 2026-10-29 实测踩到的坑：v2 接口不带 openid 会 40003，
  // 若不显式跳就变成「每次都静默降级」，等于这道防线根本没接。
  ok(r2.skipped === 'no-openid', '跳过原因是 no-openid（而不是去调接口拿 40003）', JSON.stringify(r2));

  const r2b = await sec.msgSecCheck('   ');
  ok(r2b.ok === true && r2b.skipped === 'empty', '空文本直接放行，不打接口');

  console.log('\n[请求头解析]');
  ok(sec.openidOf({ headers: { 'x-mp-openid': '  abc123  ' } }) === 'abc123', '读 header 并 trim');
  ok(sec.openidOf({ headers: { 'x-mp-openid': ['v1', 'v2'] } }) === 'v1', '数组形式取第一个');
  ok(sec.openidOf({ headers: {} }) === '', '没有这个头返回空串');
  ok(sec.openidOf(null) === '', 'req 为 null 不炸');

  // ai-moderate.mjs 里的 `import ... from './ai'` 用的是无扩展名写法，只有 Next 的
  // 打包器能解析，裸 node 会 ERR_MODULE_NOT_FOUND。所以「词表 → 微信 → DeepSeek」
  // 这条串联不在这里测，改由部署后用真实请求验证（见 .workbuddy/memory 的验收记录）。
  console.log('\n[i 提示] ai-moderate 的三层串联依赖 Next 打包解析，本脚本不覆盖；');
  console.log('        线上验证方式：带 X-MP-Openid 头提交一条含违禁词的内容，应被 400 拦下。');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('脚本自身出错:', e);
  process.exit(1);
});
