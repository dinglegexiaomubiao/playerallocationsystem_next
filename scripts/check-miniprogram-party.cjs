#!/usr/bin/env node
/**
 * 开黑列表：过期折叠 + 按钮语义 + 删除 + 发布后刷新 —— 回归脚本。
 *
 * 为什么要它：2026-10-28 用户连报两轮问题
 *   ① 过期招募还显示「招募中」、没折叠、点不了报名；
 *   ② 自己发的招募只有「关闭招募」，删不掉；而且刚发完不显示，要等下拉刷新。
 * 这些都是「不报错、不白屏」的软故障，只有盯着卡片看才发现，所以用本地假接口
 * 造几种典型卡片，把标签 / 按钮 / 折叠 / 真实请求逐条钉住。
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

// 四种典型卡片：
//   901 别人发的、招募中未过期  → 报名
//   902 别人发的、已关闭        → 无按钮
//   903 别人发的、已过期        → 折叠区，「已过期」，无报名
//   904 自己发的、招募中未过期  → 关闭招募 + 删除
// 903 故意让服务端返回旧口径（statusLabel「招募中」+ expired true），
// 验证前端是否还有兜底，否则接口没更新时用户又会看到「招募中」。
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
    title: '别人的招募中',
    status: 'open',
    statusLabel: '招募中',
    start_at: iso(now + 3 * 3600 * 1000),
    expired: false,
  }),
  Object.assign({}, BASE, {
    id: '902',
    title: '别人的已关闭',
    status: 'closed',
    statusLabel: '已关闭',
    start_at: iso(now + 3 * 3600 * 1000),
    expired: false,
  }),
  Object.assign({}, BASE, {
    id: '903',
    title: '别人的已过期',
    status: 'open',
    statusLabel: '招募中', // 旧口径，前端必须自己兜底成「已过期」
    start_at: iso(now - 48 * 3600 * 1000),
    expired: true,
  }),
  Object.assign({}, BASE, {
    id: '904',
    title: '我自己的招募',
    status: 'open',
    statusLabel: '招募中',
    start_at: iso(now + 5 * 3600 * 1000),
    expired: false,
    isMine: true,
  }),
];

const calls = [];

const server = http.createServer((req, res) => {
  calls.push(req.method + ' ' + req.url.split('?')[0]);
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/api/party')) {
    return res.end(JSON.stringify({ success: true, me: { bound: true }, posts: POSTS }));
  }
  if (req.method === 'POST' && /^\/api\/party\/\d+\/join/.test(req.url)) {
    return res.end(JSON.stringify({ success: true, id: '1' }));
  }
  if (req.method === 'DELETE' && /^\/api\/party\/\d+/.test(req.url)) {
    return res.end(JSON.stringify({ success: true }));
  }
  if (req.method === 'PATCH' && /^\/api\/party\/\d+$/.test(req.url)) {
    return res.end(JSON.stringify({ success: true, status: 'closed', statusLabel: '已关闭' }));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ success: false, error: 'mock 404' }));
});

const card = (rows, kw) => rows.filter((p) => !p.__fold && String(p.title).indexOf(kw) >= 0)[0];
const foldRow = (rows) => rows.filter((p) => p.__fold)[0];
const acts = (c) => (c && Array.isArray(c.actions) ? c.actions.map((a) => a.key) : []);
const hasAct = (c, k) => acts(c).indexOf(k) >= 0;

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

      // ① 过期折叠
      const fold = foldRow(rows);
      if (fold) ok('过期卡片默认折叠（' + fold.foldText + '）');
      else bad('没有折叠条 —— 过期卡片会平铺在列表里');
      if (page.data.expiredCount === 1) ok('过期计数正确（1）');
      else bad('过期计数应为 1，实际 ' + page.data.expiredCount);
      if (!page.data.showExpired) ok('折叠区默认收起');
      else bad('折叠区默认就是展开的');

      // ② 招募中：别人能报名
      const other = card(rows, '别人的招募中');
      if (hasAct(other, 'join')) ok('别人的招募中卡片有报名按钮');
      else bad('别人的招募中卡片没有报名按钮（actions=' + acts(other) + '）');
      if (other && other.isOpen) ok('招募中卡片 isOpen=true');
      else bad('招募中卡片 isOpen 应为 true');

      // ③ 已关闭：不能报名
      const closed = card(rows, '别人的已关闭');
      if (closed && !hasAct(closed, 'join')) ok('已关闭卡片没有报名按钮');
      else bad('已关闭卡片仍然给了报名按钮');

      // ④ 自己发的：关闭 + 删除 两个动作（用户报的就是「只有关闭没有删除」）
      const mine = card(rows, '我自己的招募');
      if (hasAct(mine, 'close')) ok('自己的招募有「关闭招募」');
      else bad('自己的招募没有关闭按钮（actions=' + acts(mine) + '）');
      if (hasAct(mine, 'delete')) ok('自己的招募有「删除」');
      else bad('自己的招募没有删除按钮 —— 用户报的就是这个（actions=' + acts(mine) + '）');

      // ⑤ 点报名要真的发出 POST
      const beforeJoin = calls.length;
      page.onAction({ currentTarget: { dataset: { id: other.id, act: 'join' } } });
      return rt.wait(1200).then(() => {
        const sent = calls.slice(beforeJoin).filter((c) => c === 'POST /api/party/901/join');
        if (sent.length) ok('点报名真的发出了 POST /api/party/901/join');
        else bad('点报名没有发出请求（实际：' + calls.slice(beforeJoin).join(', ') + '）');
      });
    })
    .then(() => {
      // ⑥ 点删除要真的发出 DELETE（modal 在测试运行时里默认「确定」）
      const beforeDel = calls.length;
      page.onAction({ currentTarget: { dataset: { id: '904', act: 'delete' } } });
      return rt.wait(1200).then(() => {
        const sent = calls.slice(beforeDel).filter((c) => c === 'DELETE /api/party/904');
        if (sent.length) ok('点删除真的发出了 DELETE /api/party/904');
        else bad('点删除没有发出请求（实际：' + calls.slice(beforeDel).join(', ') + '）');
        // 删除后要重拉一次列表，否则卡片还挂在页面上
        const refetched = calls.slice(beforeDel).filter((c) => c === 'GET /api/party');
        if (refetched.length) ok('删除后重新拉取了列表');
        else bad('删除后没有重新拉取列表');
      });
    })
    .then(() => {
      // ⑦ 发布页返回后要立刻刷新（partyListDirty）
      const app = rt.app;
      const beforeShow = calls.filter((c) => c === 'GET /api/party').length;
      app.globalData.partyListDirty = true;
      page.onShow();
      return rt.wait(1200).then(() => {
        const after = calls.filter((c) => c === 'GET /api/party').length;
        if (after > beforeShow) ok('partyListDirty 触发 onShow 重新拉取（刚发的招募立刻出现）');
        else bad('onShow 没有消费 partyListDirty —— 发布后要等下拉刷新');
        if (!app.globalData.partyListDirty) ok('标记消费后已清掉');
        else bad('partyListDirty 没清掉，会反复重拉');
      });
    })
    .then(() => {
      // ⑧ 展开折叠区：标签「已过期」、无报名按钮
      page.toggleExpired();
      const exp = card(page.data.list, '别人的已过期');
      if (page.data.showExpired) ok('折叠区可展开');
      else bad('点折叠条没有展开');
      if (exp && exp.statusLabel === '已过期') ok('过期卡片标签是「已过期」');
      else bad('过期卡片标签应为「已过期」，实际「' + (exp && exp.statusLabel) + '」');
      if (exp && !hasAct(exp, 'join')) ok('过期卡片没有报名按钮');
      else bad('过期卡片仍然给了报名按钮');
      if (exp && exp.isOpen === false) ok('过期卡片 isOpen=false');
      else bad('过期卡片 isOpen 应为 false');

      // ⑨ 收起
      page.toggleExpired();
      if (!page.data.showExpired && foldRow(page.data.list)) ok('再点一次能收起');
      else bad('收起失效');

      // ⑩ 「招募中」tab 只留可报名的
      page.onTab({ currentTarget: { dataset: { v: 'open' } } });
      const openTab = page.data.list.filter((p) => !p.__fold);
      if (openTab.length === 2 && openTab.every((p) => p.isOpen)) {
        ok('「招募中」tab 只留真正可报名的卡片（2 张）');
      } else {
        bad('「招募中」tab 应有 2 张可报名卡片，实际 ' + openTab.length + ' 张');
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
