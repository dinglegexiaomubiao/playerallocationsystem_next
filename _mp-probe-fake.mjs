// 探针：用假 openid 发 send，看微信对「有效模板」和「无效模板」分别报什么错。
// 目的：找出一种零成本（不消耗真实用户额度）的模板 ID 自检方式。
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());

const notify = await import('./lib/mp-notify.mjs');
const { pool } = await import('./lib/db.js');

const token = await notify.getAccessToken();
if (!token) {
  console.log('取不到 access_token');
  await pool.end();
  process.exit(1);
}

const cfg = notify.mpConfigured();
const FAKE = 'oProbeFakeOpenid_this_is_not_real';

const cases = [
  { key: 'digest', data: { time1: { value: '2026-10-28 17:35' }, thing2: { value: '探针' }, thing3: { value: '探针' } } },
  { key: 'signup', data: { time1: { value: '2026-10-28 17:35' }, thing2: { value: '线上' }, thing3: { value: '探针' }, thing4: { value: '探针' } } },
];

for (const c of cases) {
  const body = {
    touser: FAKE,
    template_id: cfg.templates[c.key],
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
  console.log(`[${c.key}] 假openid → errcode=${json.errcode} errmsg=${json.errmsg}`);
}

// 再补一发：故意把有效模板的字段名写错，看是否报 47003（验证「字段错」也能量出来）
const wrongField = {
  touser: FAKE,
  template_id: cfg.templates.digest,
  page: 'pages/messages/messages',
  miniprogram_state: cfg.envVersion || 'formal',
  lang: 'zh_CN',
  data: { wrong1: { value: 'x' } },
};
const res2 = await fetch(
  'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + encodeURIComponent(token),
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wrongField) }
);
const j2 = await res2.json();
console.log(`[digest] 字段写错 → errcode=${j2.errcode} errmsg=${j2.errmsg}`);

await pool.end();
process.exit(0);
