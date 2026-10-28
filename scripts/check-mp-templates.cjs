#!/usr/bin/env node
/**
 * 验证订阅消息模板 id 是否真的能用于本小程序。
 *
 * 为什么需要这个脚本（2026-10-28 踩坑）：
 *   模板 id 长这样 Y3vGaDhJ2PALJW3MRJW9HNvc_V92wvLy92VrNc5W_Nc，43 位随机串，
 *   其中 S/5、l/I/1、0/O 肉眼几乎分不出来。抄错一位的后果不是「报个明确的错」，
 *   而是 wx.requestSubscribeMessage **整批失败**、只回一个笼统的 20001，
 *   于是本来正常的模板也跟着用不了，排查方向完全跑偏（当时怀疑过 AppID、
 *   怀疑过类目、怀疑过额度，就是没怀疑到 id 本身）。
 *
 * 原理：拿一个真实 openid 直连 send 接口，让微信自己判：
 *   43101 / 0     → 模板有效（43101 只是「对方还没订阅」，属于正常）
 *   47003         → 模板有效，但字段名/值和模板详情页对不上（FIELD_MAP 要改）
 *   40037 / 41030 → 模板 id 无效（就是抄错了，或不属于本小程序）
 *   40003         → openid 无效 —— 假 openid 一律如此，所以问不出模板的事
 *
 * 为什么必须在服务器上跑：要 access_token（MP_APPID/MP_SECRET）和一个真实 openid
 * （库里 mp_openids），本地两样都没有。
 *
 * 用法（在 /www/wwwroot/laroja 下）：
 *   node scripts/check-mp-templates.cjs
 * 退出码 0 = 全部有效，1 = 有无效/字段不匹配的模板。
 */
require('@next/env').loadEnvConfig(process.cwd());

(async () => {
  const notify = await import('../lib/mp-notify.mjs');
  const { pool } = await import('../lib/db.js');

  const cfg = notify.mpConfigured();
  console.log('=== 当前生效的模板 id ===');
  for (const k of Object.keys(cfg.templates)) {
    const v = cfg.templates[k] || '';
    console.log('  ' + k.padEnd(7), v ? v + '（' + v.length + '）' : '(空)');
  }
  if (!cfg.canPush) {
    console.error('\n✗ MP_APPID / MP_SECRET 没配齐，没法验证');
    await pool.end();
    process.exit(1);
  }

  const r = await notify.checkTemplates();
  console.log('\n=== 微信判定 ===');
  for (const k of Object.keys(r.templates || {})) {
    const t = r.templates[k];
    const mark = t.ok === false ? '✗' : t.note === 'field_mismatch' ? '△' : t.ok ? '✓' : '?';
    console.log(
      '  ' + mark + ' ' + k.padEnd(7) +
      ' errcode=' + String(t.errcode).padEnd(6) +
      ' note=' + String(t.note).padEnd(20) +
      ' ' + (t.errmsg || '').slice(0, 40)
    );
  }

  if (r.reason === 'no_openid') {
    console.log('\n⚠ 库里没有任何 openid，无法反证模板（微信对假 openid 只报 40003）。');
    console.log('  先在小程序「消息提醒」页绑定一次微信再跑。');
  }

  console.log('\n结论：', r.ok ? '全部有效 ✓' : '仍有问题 → bad=' + JSON.stringify(r.bad) + ' mismatch=' + JSON.stringify(r.mismatch));
  console.log('（结果已缓存到 mp_kv 的 tmpl:valid，小程序据此跳过无效模板，7 天有效）');

  await pool.end();
  process.exit(r.ok ? 0 : 1);
})().catch((e) => {
  console.error('验证失败:', e && e.message);
  process.exit(1);
});
