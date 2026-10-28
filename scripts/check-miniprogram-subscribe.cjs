#!/usr/bin/env node
/**
 * 小程序「订阅消息 + 站内信」静态自查（不连数据库、不连微信）。
 *
 * 为什么需要它：这功能横跨五层（小程序页 → /api/mp/* → lib/mp-notify.mjs →
 * 微信接口 → mp_* 五张表），而且**每一层失败都不报错**：
 *   - 没绑 openid  → 推送静默跳过
 *   - 模板 id 没配 → 推送静默跳过
 *   - 关键词名填错 → 微信回 47003，用户只看到「没收到」
 *   - tabBar 下标写错 → 红点挂到别的 tab 上
 * 这些在真机上都要「刚好有个人报名」才看得见。能靠读文件确认的，就不该等真机。
 *
 * 用法：node scripts/check-miniprogram-subscribe.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
let fail = 0;
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};
const ok = (m) => console.log('  ✓ ' + m);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readMp = (p) => fs.readFileSync(path.join(MP, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

console.log('\n[订阅消息自查] ' + ROOT);

/* ---------- 1. 小程序页面 ---------- */
const app = JSON.parse(readMp('app.json'));
const pages = app.pages || [];
for (const p of ['pages/messages/messages', 'pages/subscribe/subscribe']) {
  if (pages.indexOf(p) < 0) bad('app.json 没注册 ' + p);
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    if (!fs.existsSync(path.join(MP, p + ext))) bad('缺文件 miniprogram/' + p + ext);
  }
}
if (fail === 0) ok('两个新页面已注册且四件套齐全');

/* ---------- 2. 未读角标下标必须和 tabBar 里的「我的」一致 ---------- */
const tabList = (app.tabBar && app.tabBar.list) || [];
const mineIdx = tabList.findIndex((i) => i.pagePath === 'pages/mine/mine');
const badgeSrc = readMp('utils/badge.js');
const badgeIdx = Number((/MINE_TAB_INDEX\s*=\s*(\d+)/.exec(badgeSrc) || [])[1]);
if (mineIdx < 0) bad('tabBar 里找不到「我的」页');
else if (badgeIdx !== mineIdx) {
  bad(`badge.js 的 MINE_TAB_INDEX=${badgeIdx}，但 tabBar 里「我的」是第 ${mineIdx} 项 → 红点会挂错 tab`);
} else ok(`未读角标挂在 tabBar 第 ${mineIdx} 项（我的）`);

/* ---------- 3. 页面调用的接口必须真的存在 ---------- */
const apiFiles = [
  'pages/api/mp/status.js',
  'pages/api/mp/link.js',
  'pages/api/mp/subscribe.js',
  'pages/api/mp/interests.js',
  'pages/api/mp/inbox.js',
  'pages/api/admin/mp/subscribers.js',
  'pages/api/admin/mp/push-logs.js',
  'pages/api/admin/mp/push.js',
];
const missingApi = apiFiles.filter((f) => !exists(f));
missingApi.length ? bad('缺接口文件: ' + missingApi.join(', ')) : ok(apiFiles.length + ' 个接口文件齐全');

const usedPaths = new Set();
for (const f of ['pages/messages/messages.js', 'pages/subscribe/subscribe.js', 'utils/badge.js']) {
  const src = readMp(f);
  for (const m of src.matchAll(/'(\/api\/mp\/[a-z-]+)/g)) usedPaths.add(m[1]);
}
const declared = new Set(apiFiles.map((f) => f.replace(/^pages/, '').replace(/\.js$/, '')));
const notDeclared = [...usedPaths].filter((p) => !declared.has(p));
notDeclared.length
  ? bad('小程序调用了不存在的接口: ' + notDeclared.join(', '))
  : ok(`小程序调用的 ${usedPaths.size} 个接口全部存在`);

/* ---------- 4. 授权接口的关键契约 ---------- */
const statusSrc = read('pages/api/mp/status.js');
if (statusSrc.indexOf('tmplId') < 0) {
  bad('/api/mp/status 没返回 tmplId → wx.requestSubscribeMessage 拿不到 id，授权按钮一定失败');
} else ok('/api/mp/status 下发了 tmplId');

const subSrc = readMp('pages/subscribe/subscribe.js');
if (subSrc.indexOf('wx.requestSubscribeMessage') < 0) bad('订阅页没有调用 wx.requestSubscribeMessage');
else ok('订阅页调用了 wx.requestSubscribeMessage');
if (subSrc.indexOf('/api/mp/subscribe') < 0) bad('订阅页没把授权结果回传后端（额度不会加）');
else ok('订阅页把授权结果回传后端');

/* ---------- 5. lib/mp-notify.mjs 的自洽性 ---------- */
const notify = read('lib/mp-notify.mjs');
// 每个模板都要有字段映射，否则推送时 data 是空对象 → 微信 47003
const tmplKeys = [...notify.matchAll(/^\s{2}(\w+):\s*\{\n\s{4}key:\s*'/gm)].map((m) => m[1]);
const mapBlock = (notify.match(/const FIELD_MAP = \{([\s\S]*?)\n\};/) || [])[1] || '';
const mappedKeys = [...mapBlock.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
const unmapped = tmplKeys.filter((k) => mappedKeys.indexOf(k) < 0);
tmplKeys.length === 0
  ? bad('没解析到 TEMPLATES 定义（正则失配，检查文件结构是否变了）')
  : unmapped.length
    ? bad('这些模板在 FIELD_MAP 里没有字段映射: ' + unmapped.join(','))
    : ok(`${tmplKeys.length} 个模板都有字段映射（${tmplKeys.join(' / ')}）`);

// 字段 key 必须与微信后台模板**完全一致，一个不许少**。
// 少一个必填字段 → 47003，而且是「用户报名了才发现」的那种错。
// 期望值来自「我的模板 → 详情页」截图（2026-10-28）。
// ⚠ 这两个模板的编号不是从 thing1 开始的，第一个字段就是 time1。
const EXPECTED_FIELDS = {
  digest: ['time1', 'thing2', 'thing3'], // 游戏活动通知：活动时间/活动名称/活动内容
  signup: ['time1', 'thing2', 'thing3', 'thing4'], // 活动报名成功通知：时间/地点/名称/备注
};
for (const [key, want] of Object.entries(EXPECTED_FIELDS)) {
  const line = new RegExp('^\\s{2}' + key + ':\\s*\\{([^}]*)\\}', 'm').exec(mapBlock);
  if (!line) {
    bad('FIELD_MAP 里找不到 ' + key + ' 的字段映射');
    continue;
  }
  const got = [...line[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]).sort();
  const w = want.slice().sort();
  if (got.join(',') !== w.join(',')) {
    bad(`FIELD_MAP.${key} 的字段是 [${got.join(',')}]，模板要的是 [${w.join(',')}] → 会 47003`);
  } else {
    ok(`FIELD_MAP.${key} 与模板字段一一对应（${w.join(' / ')}）`);
  }
}

// 一次性订阅的核心：必须有额度扣减，且只在额度 > 0 时成功
if (notify.indexOf('remaining > 0') < 0) bad('consumeQuota 没有 remaining > 0 条件 → 没有额度也会推');
else ok('额度扣减带 remaining > 0 条件（无额度不会推）');

// 站内信是兜底：推送失败不能让通知消失
if (notify.indexOf('addInbox') < 0) bad('lib/mp-notify.mjs 里没有 addInbox（站内信兜底没了）');
else ok('站内信与推送分离（推送失败仍有站内信）');

/* ---------- 6. 报名链路必须真的调了通知 ---------- */
const joinFiles = ['pages/api/party/[id]/join.js', 'pages/api/activities/[id]/join.js'];
let joinHooked = 0;
for (const f of joinFiles) {
  const src = read(f);
  if (src.indexOf('notifySignupToOwner') < 0) bad(f + ' 没调用 notifySignupToOwner（报名不会通知发起人）');
  else {
    joinHooked++;
    // 必须是不 await 的写法，否则微信接口慢会把报名卡住
    if (!/notifySignupToOwner\s*\(\s*\{/.test(src) || src.indexOf('await notifySignupToOwner') >= 0) {
      bad(f + ' await 了通知 → 微信接口慢时报名会被卡住');
    }
    if (src.indexOf('account_name') < 0) bad(f + ' 没查 account_name（不知道通知谁）');
    // 「活动地点」是订阅模板的必填字段，不传就是 47003
    if (src.indexOf('place:') < 0) bad(f + ' 没传 place → 报名提醒模板缺必填字段，47003');
  }
}
if (joinHooked === joinFiles.length) ok('两条报名链路都接了定向通知，且不阻塞主流程');

/* ---------- 7. 后台入口 ---------- */
const shell = read('components/admin/AdminShell.js');
for (const href of ['/admin/mp-subscribers', '/admin/mp-push']) {
  if (shell.indexOf(href) < 0) bad('AdminShell 导航缺 ' + href);
  if (!exists('pages' + href + '.js')) bad('缺页面 pages' + href + '.js');
}
if (shell.indexOf('/admin/mp-subscribers') >= 0 && shell.indexOf('/admin/mp-push') >= 0) {
  ok('后台导航有「订阅」「推送」两项，页面都在');
}

/* ---------- 8. 定时任务 ---------- */
if (!exists('scripts/mp-digest.cjs')) bad('缺 scripts/mp-digest.cjs（每日汇总跑不起来）');
else {
  const eco = read('deploy/ecosystem.config.js');
  if (eco.indexOf('laroja-digest') < 0) bad('ecosystem.config.js 没注册 laroja-digest（cron 不会跑）');
  else if (eco.indexOf('cron_restart') < 0) bad('laroja-digest 缺 cron_restart');
  else ok('每日汇总已注册为 pm2 cron 任务');
}

/* ---------- 9. 密钥不许进仓库 ---------- */
const dirty = [];
for (const f of ['lib/mp-notify.mjs', 'pages/api/mp/link.js', 'pages/api/admin/mp/push.js']) {
  const src = read(f);
  // 只允许 process.env.MP_SECRET，不能出现字面量赋值
  if (/MP_SECRET\s*=\s*['"][0-9a-zA-Z]{16,}['"]/.test(src)) dirty.push(f);
}
dirty.length ? bad('有文件把 AppSecret 写死了: ' + dirty.join(', ')) : ok('没有硬编码 AppSecret');

console.log(fail === 0 ? '\n✅ 全部通过\n' : `\n❌ ${fail} 项未通过\n`);
process.exit(fail === 0 ? 0 : 1);
