// 诊断模板 ID 是否有效：拿真实 openid 直连 send 接口，看 errcode
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());

const notify = await import('./lib/mp-notify.mjs');
const { pool } = await import('./lib/db.js');

const rows = await pool.query(
  `SELECT openid, account_name FROM public.mp_openids ORDER BY created_at DESC LIMIT 5`
);
console.log('已绑定 openid 数:', rows.rowCount);
for (const r of rows.rows) {
  console.log('  - account=' + r.account_name + ' openid=' + notify.maskOpenid(r.openid) + ' len=' + r.openid.length);
}
if (!rows.rowCount) {
  console.log('没有 openid，先在小程序里绑定微信');
  await pool.end();
  process.exit(0);
}

const subs = await pool.query(
  `SELECT openid, template_key, remaining, accepted_total, rejected_at FROM public.mp_subscriptions`
);
console.log('订阅记录:', JSON.stringify(subs.rows.map((x) => ({
  openid: notify.maskOpenid(x.openid), key: x.template_key, remaining: x.remaining, accepted: x.accepted_total, rejected: !!x.rejected_at,
}))));

const openid = rows.rows[0].openid;
const token = await notify.getAccessToken();
console.log('access_token:', token ? token.length + ' 字符' : '取不到');

// 对每个模板发一条真消息。errCode 语义：
//   43101 = 用户未订阅/已拒收  → 模板 ID 是「对的」
//   40037 / 41030 = 模板 ID 无效 → 模板 ID 是「错的」
//   47003 = 参数不匹配 → 模板对、字段错
const cfg = notify.mpConfigured();
const cases = [
  { key: 'digest', data: { time1: { value: '2026-10-28 17:30' }, thing2: { value: '探针测试' }, thing3: { value: '看看模板是否有效' } } },
  { key: 'signup', data: { time1: { value: '2026-10-28 17:30' }, thing2: { value: '线上' }, thing3: { value: '探针测试' }, thing4: { value: '忽略这条' } } },
];

for (const c of cases) {
  const tmplId = cfg.templates[c.key];
  const body = {
    touser: openid,
    template_id: tmplId,
    page: 'pages/messages/messages',
    miniprogram_state: cfg.envVersion || 'formal',
    lang: 'zh_CN',
    data: c.data,
  };
  const res = await fetch(
    'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + encodeURIComponent(token),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const json = await res.json();
  console.log(`[${c.key}] tmplId=${tmplId.slice(0, 12)}… → errcode=${json.errcode} errmsg=${json.errmsg}`);
}

await pool.end();
process.exit(0);
