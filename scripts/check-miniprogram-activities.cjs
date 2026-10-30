#!/usr/bin/env node
/**
 * 活动招募：过期折叠 + 按钮语义（关闭/重新招募/删除/报名/取消）+ 筛选（类型/地区/日期/只看招募中/搜索）—— 回归脚本。
 *
 * 为什么要它：2026-10-30 把小程序活动页对齐网页端时，活动页原本差距最大——
 *   ① 没有过期折叠（过期活动平铺、还显示「招募中」）；
 *   ② 发起人非招募中时只有「我发起的」，没有「重新招募」「删除」；
 *   ③ 没有网页端那套筛选（类型 / 地区 / 日期 / 只看招募中 / 搜索）。
 * 这些都是「不报错、不白屏」的软故障，用本地假接口造几种典型活动把标签 / 按钮 / 折叠 / 筛选逐条钉住。
 *
 * 用法：node scripts/check-miniprogram-activities.cjs
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

// 几种典型活动：
//   901 别人发的、招募中未过期   → 报名
//   902 别人发的、已关闭         → 已停止招募（无按钮）
//   903 别人发的、已过期         → 折叠区，「已过期」，无报名
//   904 自己发的、招募中未过期   → 关闭招募 + 删除
//   905 自己发的、已关闭非过期   → 重新招募 + 删除
//   906 自己已报名的、招募中     → 取消报名
const BASE = {
  type: 'meal',
  typeLabel: '约饭',
  region: '深圳市 · 南山区',
  location: '海岸城',
  cost: 'AA 制',
  need_people: 6,
  duration_min: 120,
  joinedPeople: 2,
  signups: [],
  signupCount: 0,
  creator: { player_id: '1', nickname: '测试发起人' },
  isMine: false,
  iJoined: false,
};

const POSTS = [
  Object.assign({}, BASE, {
    id: '901',
    title: '别人的约饭招募中',
    status: 'open',
    statusLabel: '招募中',
    meet_at: iso(now + 3 * 3600 * 1000),
    expired: false,
  }),
  Object.assign({}, BASE, {
    id: '902',
    title: '别人的活动已关闭',
    status: 'closed',
    statusLabel: '已关闭',
    meet_at: iso(now + 3 * 3600 * 1000),
    expired: false,
  }),
  Object.assign({}, BASE, {
    id: '903',
    title: '别人的活动已过期',
    status: 'open',
    statusLabel: '招募中', // 旧口径，前端必须自己兜底成「已过期」
    meet_at: iso(now - 48 * 3600 * 1000),
    expired: true,
  }),
  Object.assign({}, BASE, {
    id: '904',
    title: '我自己的约饭',
    status: 'open',
    statusLabel: '招募中',
    meet_at: iso(now + 5 * 3600 * 1000),
    expired: false,
    isMine: true,
  }),
  Object.assign({}, BASE, {
    id: '905',
    title: '我自己关掉的活动',
    status: 'closed',
    statusLabel: '已关闭',
    meet_at: iso(now + 6 * 3600 * 1000),
    expired: false,
    isMine: true,
  }),
  Object.assign({}, BASE, {
    id: '906',
    title: '我报名的爬山',
    status: 'open',
    statusLabel: '招募中',
    type: 'hike',
    typeLabel: '爬山',
    meet_at: iso(now + 8 * 3600 * 1000),
    expired: false,
    iJoined: true,
  }),
];

const calls = [];

const server = http.createServer((req, res) => {
  calls.push(req.method + ' ' + req.url.split('?')[0]);
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/api/activities')) {
    return res.end(JSON.stringify({ success: true, me: { bound: true }, posts: POSTS }));
  }
  if (req.method === 'POST' && /^\/api\/activities\/\d+\/join/.test(req.url)) {
    return res.end(JSON.stringify({ success: true, id: '1' }));
  }
  if (req.method === 'DELETE' && /^\/api\/activities\/\d+$/.test(req.url)) {
    return res.end(JSON.stringify({ success: true }));
  }
  if (req.method === 'PATCH' && /^\/api\/activities\/\d+$/.test(req.url)) {
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
  console.log('\n[活动招募回归] 本地假接口 ' + port);

  const rt = createRuntime({
    baseUrl: 'http://127.0.0.1:' + port,
    root: ROOT,
    token: 'faketoken',
  });
  const page = rt.loadPage('pages/activities/activities.js');
  page.onLoad();

  rt.wait(2500)
    .then(() => {
      const rows = page.data.list;

      // ① 过期折叠
      const fold = foldRow(rows);
      if (fold) ok('过期活动默认折叠（' + fold.foldText + '）');
      else bad('没有折叠条 —— 过期活动会平铺在列表里');
      if (page.data.expiredCount === 1) ok('过期计数正确（1）');
      else bad('过期计数应为 1，实际 ' + page.data.expiredCount);
      if (!page.data.showExpired) ok('折叠区默认收起');
      else bad('折叠区默认就是展开的');

      // ② 招募中：别人能报名
      const other = card(rows, '别人的约饭招募中');
      if (hasAct(other, 'join')) ok('别人的招募中活动有报名按钮');
      else bad('别人的招募中活动没有报名按钮（actions=' + acts(other) + '）');
      if (other && other.isOpen) ok('招募中活动 isOpen=true');
      else bad('招募中活动 isOpen 应为 true');

      // ③ 已关闭：已停止招募（无按钮）
      const closed = card(rows, '别人的活动已关闭');
      if (closed && closed.actions.length === 0 && closed.stoppedText === '已停止招募') {
        ok('已关闭活动显示「已停止招募」，无按钮');
      } else {
        bad('已关闭活动应无按钮且文案「已停止招募」（actions=' + acts(closed) + '）');
      }

      // ④ 自己发的招募中：关闭 + 删除
      const mine = card(rows, '我自己的约饭');
      if (hasAct(mine, 'close')) ok('自己的活动有「关闭招募」');
      else bad('自己的活动没有关闭按钮（actions=' + acts(mine) + '）');
      if (hasAct(mine, 'delete')) ok('自己的活动有「删除」');
      else bad('自己的活动没有删除按钮（actions=' + acts(mine) + '）');

      // ⑤ 自己发的已关闭非过期：重新招募 + 删除
      const mineClosed = card(rows, '我自己关掉的活动');
      if (hasAct(mineClosed, 'reopen')) ok('自己已关闭的活动有「重新招募」');
      else bad('自己已关闭的活动没有重新招募按钮（actions=' + acts(mineClosed) + '）');
      if (hasAct(mineClosed, 'delete')) ok('自己已关闭的活动有「删除」');
      else bad('自己已关闭的活动没有删除按钮');

      // ⑥ 自己已报名：取消报名
      const joined = card(rows, '我报名的爬山');
      if (hasAct(joined, 'cancel')) ok('自己已报名的活动有「取消报名」');
      else bad('自己已报名的活动没有取消按钮（actions=' + acts(joined) + '）');
    })
    .then(() => {
      // ⑦ 点报名真的发 POST
      const before = calls.length;
      const other = card(page.data.list, '别人的约饭招募中');
      page.onAction({ currentTarget: { dataset: { id: other.id, act: 'join' } } });
      return rt.wait(1200).then(() => {
        const sent = calls.slice(before).filter((c) => c === 'POST /api/activities/901/join');
        if (sent.length) ok('点报名真的发出了 POST /api/activities/901/join');
        else bad('点报名没有发出请求（实际：' + calls.slice(before).join(', ') + '）');
      });
    })
    .then(() => {
      // ⑧ 点删除真的发 DELETE，并重新拉取
      const before = calls.length;
      page.onAction({ currentTarget: { dataset: { id: '904', act: 'delete' } } });
      return rt.wait(1200).then(() => {
        const sent = calls.slice(before).filter((c) => c === 'DELETE /api/activities/904');
        if (sent.length) ok('点删除真的发出了 DELETE /api/activities/904');
        else bad('点删除没有发出请求');
        const refetched = calls.slice(before).filter((c) => c === 'GET /api/activities');
        if (refetched.length) ok('删除后重新拉取了列表');
        else bad('删除后没有重新拉取列表');
      });
    })
    .then(() => {
      // ⑨ 点关闭真的发 PATCH status=closed
      const before = calls.length;
      page.onAction({ currentTarget: { dataset: { id: '905', act: 'reopen' } } });
      return rt.wait(1200).then(() => {
        const sent = calls.slice(before).filter((c) => c === 'PATCH /api/activities/905');
        if (sent.length) ok('点重新招募真的发出了 PATCH /api/activities/905');
        else bad('点重新招募没有发出请求');
      });
    })
    .then(() => {
      // ⑩ 展开折叠区：标签「已过期」、无报名按钮
      page.toggleExpired();
      const exp = card(page.data.list, '别人的活动已过期');
      if (page.data.showExpired) ok('折叠区可展开');
      else bad('点折叠条没有展开');
      if (exp && exp.statusLabel === '已过期') ok('过期活动标签是「已过期」');
      else bad('过期活动标签应为「已过期」，实际「' + (exp && exp.statusLabel) + '」');
      if (exp && !hasAct(exp, 'join')) ok('过期活动没有报名按钮');
      else bad('过期活动仍然给了报名按钮');
      page.toggleExpired();
      if (!page.data.showExpired && foldRow(page.data.list)) ok('再点一次能收起');
      else bad('收起失效');
    })
    .then(() => {
      // ⑪ 类型筛选：只留「爬山」应只剩 906
      page.onType({ currentTarget: { dataset: { v: 'hike' } } });
      const hike = page.data.list.filter((p) => !p.__fold && p.type === 'hike');
      if (hike.length === 1 && hike[0].id === '906') ok('类型筛选「爬山」只留 1 张（906）');
      else bad('类型筛选失效，命中 ' + hike.length + ' 张');
      page.onType({ currentTarget: { dataset: { v: 'all' } } });

      // ⑫ 只看招募中：tab=all + openOnly → 只剩 isOpen 的（901/904/906，903 过期 902 关闭 905 关闭）
      page.onToggleOpenOnly();
      const openOnly = page.data.list.filter((p) => !p.__fold && p.isOpen);
      if (openOnly.length === 3) ok('只看招募中只留 3 张可报名（901/904/906）');
      else bad('只看招募中应为 3 张，实际 ' + openOnly.length + ' 张');
      page.onToggleOpenOnly();

      // ⑬ 搜索：命中标题关键字
      page.onKeyword({ detail: { value: '爬山' } });
      const searched = page.data.list.filter((p) => !p.__fold);
      if (searched.length === 1 && searched[0].id === '906') ok('搜索「爬山」只命中 906');
      else bad('搜索失效，命中 ' + searched.length + ' 张');
      page.onKeyword({ detail: { value: '' } });

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
