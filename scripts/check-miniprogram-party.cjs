#!/usr/bin/env node
/**
 * 开黑列表：过期折叠 + 报名按钮语义 —— 回归脚本。
 *
 * 为什么要它：2026-10-28 用户报「有些招募过期了还显示招募中、也没折叠；招募中点不了报名」。
 * 根因是两个：① 服务端 statusLabel 直接取 status（没人手动关的卡片 status 一直是 open），
 * 过期卡也显示「招募中」；② 小程序没有网页端那套「已过期折叠区」，过期卡平铺在列表里，
 * 看着像还能报名、其实 isOpen=false 所以没有按钮 —— 用户的感觉就是「点了没法报名」。
 *
 * 这类 bug 不会报错、不会白屏，线上也看不出来（只有过期卡片时才显形），
 * 所以用本地假接口造三种典型卡片，把「标签 / 按钮 / 折叠 / 是否真的发出报名请求」逐条钉住。
 *
 * 用法：node scripts/check-miniprogram-party.cjs
 * 纯离线：只监听 127.0.0.1 随机端口，不访问线上、不写库。
 */
const http = require('http');
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const ROOT = path.join(__dirname, '..', 'miniprogram');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

// 三种典型卡片。第三张故意让服务端返回旧口径（statusLabel '招募中' + expired true），
// 验证前端是否还有兜底 —— 否则接口没更新时用户又会看到「招募中」。
const BASE = {
  mode: 'normal',
  modeLabel: '随机开黑',
  game_id: null,
  my_score: 5000,
  my_rank: '传奇',
  my_positions: ['1'],
  want_score_min: null,
  want_score_max: null,
  want_rank: '',
  want_positions: [],
  play_time: '',
  has_voice: true,
  voice_app: null,
  note: '',
  need_players: 5,
  duration_min: 120,
  creator: { player_id: '1', nickname: '测试发起人', score: 5000 },
  signups: [],
  signupCount: 0,
  isMine: false,
  iJoined: false,
};

const POSTS = [
  Object.assign({}, BASE, {
    id: '901',
    title: '招募中·未来',
    status: 'open',
    statusLabel: '招募中',
    start_at: iso(now + 3 * 3600 * 1000),
    expired: false,
  }),
  Object.assign({}, BASE, {
    id: '902',
    title: '已关闭',
    status: 'closed',
    statusLabel: '已关闭',
    start_at: iso(now + 3 * 3600 * 1000),
    expired: false,
  }),
  Object.assign({}, BASE, {
    id: '903',
    title: '已过期',
    status: 'open',
    statusLabel: '招募中', // 旧口径，前端必须自己兜底成「已过期」
    start_at: iso(now - 48 * 3600 * 1000),
    expired: true,
  }),
];

const calls = [];

const server = http.createServer((req, res) => {
  calls.push(req.method + ' ' + req.url.split('?')[0]);
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/api/party')) {
    return res.end(JSON.stringify({ success: true, me: { bound: false }, posts: POSTS }));
  }
  if (req.method === 'POST' && /^\/api\/party\/\d+\/join/.test(req.url)) {
    return res.end(JSON.stringify({ success: true, id: '1' }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ success: false, error: 'mock 404' }));
});

const card = (rows, kw) => rows.filter((p) => !p.__fold && String(p.title).indexOf(kw) >= 0)[0];
const foldRow = (rows) => rows.filter((p) => p.__fold)[0];

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log('\n[开黑列表回归] 本地假接口 ' + port);

  const rt = createRuntime({
    baseUrl: 'http://127.0.0.1:' + port,
    root: ROOT,
    token: 'faketoken',
  });
  const page = rt.loadPage('pages/party/party.js');
  page.onLoad();

  rt.wait(2500)
    .then(() => {
      const rows = page.data.list;

      // ① 默认收起：里面只有未过期卡片 + 一条折叠条
      const fold = foldRow(rows);
      if (fold) ok('过期卡片默认折叠（折叠条：' + fold.foldText + '）');
      else bad('没有折叠条 —— 过期卡片会平铺在列表里');

      if (page.data.expiredCount === 1) ok('过期计数正确（1）');
      else bad('过期计数应为 1，实际 ' + page.data.expiredCount);

      if (!page.data.showExpired) ok('折叠区默认收起');
      else bad('折叠区默认就是展开的');

      // ② 招募中的卡片必须有「报名」按钮
      const open = card(rows, '招募中');
      if (open && open.actionKey === 'join') ok('招募中卡片有报名按钮');
      else bad('招募中卡片没有报名按钮（actionKey=' + (open && open.actionKey) + '）');
      if (open && open.isOpen) ok('招募中卡片 isOpen=true');
      else bad('招募中卡片 isOpen 应为 true');

      // ③ 已关闭的卡片不能有报名按钮
      const closed = card(rows, '已关闭');
      if (closed && closed.actionKey !== 'join') ok('已关闭卡片没有报名按钮');
      else bad('已关闭卡片仍然给了报名按钮');

      // ④ 点「报名」要真的发出 POST
      const before = calls.length;
      page.onAction({ currentTarget: { dataset: { id: open.id, act: 'join' } } });
      return rt.wait(1500).then(() => ({ before }));
    })
    .then(({ before }) => {
      const sent = calls.slice(before).filter((c) => c === 'POST /api/party/901/join');
      if (sent.length) ok('点报名真的发出了 POST /api/party/901/join');
      else bad('点报名没有发出请求（实际：' + calls.slice(before).join(', ') + '）');

      // ⑤ 展开折叠区：过期卡片标签必须是「已过期」，且不给报名按钮
      page.toggleExpired();
      const rows = page.data.list;
      const exp = card(rows, '已过期');
      if (page.data.showExpired) ok('折叠区可展开');
      else bad('点折叠条没有展开');
      if (exp && exp.statusLabel === '已过期') ok('过期卡片标签是「已过期」');
      else bad('过期卡片标签应为「已过期」，实际「' + (exp && exp.statusLabel) + '」');
      if (exp && exp.actionKey !== 'join') ok('过期卡片没有报名按钮');
      else bad('过期卡片仍然给了报名按钮');
      if (exp && exp.isOpen === false) ok('过期卡片 isOpen=false');
      else bad('过期卡片 isOpen 应为 false');

      // ⑥ 再收起来要回到「只剩折叠条」的状态
      page.toggleExpired();
      if (!page.data.showExpired && foldRow(page.data.list)) ok('再点一次能收起');
      else bad('收起失效');

      // ⑦ 「招募中」tab 不该把过期卡片算进来
      page.onTab({ currentTarget: { dataset: { v: 'open' } } });
      const openTabRows = page.data.list.filter((p) => !p.__fold);
      if (openTabRows.length === 1 && openTabRows[0].actionKey === 'join') {
        ok('「招募中」tab 只留真正可报名的卡片');
      } else {
        bad('「招募中」tab 里应只有 1 张可报名卡片，实际 ' + openTabRows.length + ' 张');
      }
    })
    .then(() => {
      console.log('');
      server.close();
      if (fail) {
        console.log('❌ ' + fail + ' 项未通过\n');
        process.exit(1);
      }
      console.log('✅ 全部通过\n');
      process.exit(0);
    })
    .catch((e) => {
      console.error('回归脚本自身出错：', e);
      server.close();
      process.exit(1);
    });
});
