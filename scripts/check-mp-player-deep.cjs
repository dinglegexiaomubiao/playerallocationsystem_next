#!/usr/bin/env node
/**
 * components/player-deep 自检（离线，不联网、不消耗接口额度）。
 *
 * 这个组件同时挂在名片页和个人信息页上，一处坏了两个页面一起白屏，所以把它的
 * 状态机单独钉住：账号归一化（主号优先）→ 没号/未登录/可分析三种空闲态 →
 * 换号才清战绩（同号重渲染不清）→ 缺 SteamID/未登录时的点击分支。
 *
 *   node scripts/check-mp-player-deep.cjs
 */
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');

let fail = 0;
const ok = (m) => console.log('  ok   ' + m);
const bad = (m) => {
  console.log('  FAIL ' + m);
  fail++;
};
const expect = (cond, msg) => (cond ? ok(msg) : bad(msg));

// 假 baseUrl：本文件不发起任何请求，但 utils/api 需要它拼绝对地址
const rt = createRuntime({ baseUrl: 'https://example.invalid', root: MP });
const load = (props) => rt.loadComponent('components/player-deep/player-deep.js', props);

console.log('\n[账号归一化 · 主号优先，兼容两种历史形态]');

const c1 = load({ accounts: [{ accountId: '222', isPrimary: false }, { accountId: '111', isPrimary: true }] });
expect(c1._accounts.length === 2, '两个号都收下');
expect(c1._accounts[0].accountId === '111', '主号排在第一个（组件按顺序试号）');
expect(c1.data.hasAcc === true, 'hasAcc 置位');

const c2 = load({ accounts: ['333'] });
expect(c2._accounts.length === 1 && c2._accounts[0].accountId === '333', '纯字符串数组也认（旧数据形态）');

const c3 = load({ gameId: '444' });
expect(c3._accounts.length === 1 && c3._accounts[0].accountId === '444', '没传 accounts 时用 gameId 兜底');

const c4 = load({ accounts: [{ accountId: '  ', isPrimary: true }] });
expect(c4.data.hasAcc === false, '空白账号不算数（否则会拿空串去查 OpenDota）');

console.log('\n[空闲态文案 · 没号 / 未登录 / 可分析]');

const noAcc = load({ accounts: [], loggedIn: true });
expect(noAcc.data.insight.idleBtn === '无 SteamID', '没 SteamID：按钮写「无 SteamID」');
expect(noAcc.data.insight.idleHint.indexOf('SteamID') >= 0, '没 SteamID：提示说明原因');

const notLogin = load({ accounts: [{ accountId: '555' }], loggedIn: false });
expect(notLogin.data.insight.idleBtn === '登录后可用', '未登录：按钮写「登录后可用」');

const ready = load({ accounts: [{ accountId: '555' }], loggedIn: true });
expect(ready.data.insight.idleBtn === '看解读', '已登录：按钮写「看解读」');
expect(ready.data.insight.idleHint.indexOf('从服务器读取') >= 0, '已登录：提示说明内容来源');
expect(ready.data.stats.status === 'idle', '战绩初态是 idle（等用户点「拉取战绩」）');

console.log('\n[账号变了才清战绩，同号重渲染不清]');

ready.data.stats = { status: 'loaded', error: '', data: { total: 100 } };
ready.data.insight = { status: 'done', error: '', analysis: 'x', lines: ['x'], emptyText: '', idleHint: '', idleBtn: '' };
ready._reset([{ accountId: '555' }], '', true);
expect(ready.data.stats.status === 'loaded', '同一批账号再 reset：已拉到的战绩保留（下拉刷新不白屏）');
expect(ready.data.insight.status === 'done', '同一批账号再 reset：已读到的解读保留');

ready._reset([{ accountId: '666' }], '', true);
expect(ready.data.stats.status === 'idle', '换了账号：战绩清空重来（避免显示上一个人的数字）');
expect(ready.data.insight.status === 'idle', '换了账号：解读也清空');

console.log('\n[点击分支 · 少一次请求就少一次白等]');

const t0 = rt.toasts.length;
noAcc.onTapInsight();
expect(rt.toasts.length === t0 + 1 && rt.toasts[rt.toasts.length - 1].indexOf('SteamID') >= 0, '没 SteamID：只弹提示，不发请求');

const nav0 = rt.navLog.length;
notLogin.onTapInsight();
expect(rt.navLog.length === nav0 + 1 && rt.navLog[rt.navLog.length - 1].url === '/pages/login/login', '未登录：跳登录页，不硬调接口');

const running = load({ accounts: [{ accountId: '777' }], loggedIn: true });
running.data.insight = Object.assign({}, running.data.insight, { status: 'running' });
const nav1 = rt.navLog.length;
running.onTapInsight();
expect(rt.navLog.length === nav1 && running.data.insight.status === 'running', '正在读取时重复点击不会叠请求');

console.log('\n[参数校验 · 页面传参错了要在这里红]');

const wxml = require('fs').readFileSync(path.join(MP, 'components', 'player-deep', 'player-deep.wxml'), 'utf8');
expect(wxml.indexOf('{{insight.lines}}') >= 0, 'wxml 按行渲染解读（<text> 不保证保留换行）');
expect(wxml.indexOf('wx:if="{{!hasAcc}}"') >= 0, 'wxml 用 hasAcc 判空（不是用 gameId，多号时 gameId 为空）');

console.log('\n结果：' + (fail === 0 ? '全部通过' : fail + ' 项失败'));
process.exit(fail === 0 ? 0 : 1);
