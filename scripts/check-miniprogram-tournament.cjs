#!/usr/bin/env node
/**
 * 赛事详情联调：名次 / 赛程 / 队伍 / 报名名单 + 报名与退赛。
 *
 * 为什么单独一个脚本：这一页要同时验三件事，而且三者互相独立 ——
 * ①多数赛事没编赛程（rounds 为空）不能白屏；②三名次老数据只有单值字段要能回退；
 * ③报名是真写库（tournament_players），写错了会让「报名名单」多出一个假人。
 *
 * 用法（写链路需要一个已绑选手资料的账号，夹具用 deploy/probe-account.cjs）：
 *   node scripts/check-miniprogram-tournament.cjs                 # 只读部分
 *   MP_GA_PASS=Probe2026ga node scripts/check-miniprogram-tournament.cjs
 */
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const BASE = process.argv[2] || 'https://dota.playerallocationsystem.online';
const ROOT = path.join(__dirname, '..', 'miniprogram');
const GA = { user: process.env.MP_GA_USER || '_mp_ga', pass: process.env.MP_GA_PASS || '' };
// 第十一届：8 支队伍、51 人报名、冠军 vk、3 个轮次 17 场对阵
// 第一届：没编赛程（rounds 空）+ 4 条名次（冠军 1 + 并列亚军 3）
const T11 = '16';
const T1ST = '17';

const rt = createRuntime({ baseUrl: BASE, root: ROOT, token: '' });
const { loadPage, wait, toasts } = rt;

const api = require(path.join(ROOT, 'utils', 'api.js'));
const session = require(path.join(ROOT, 'utils', 'session.js'));

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};
const expect = (cond, msg) => (cond ? ok(msg) : bad(msg));

/** 轮询等待条件成立（页面里 setData 是异步回调式的，不能只看一次） */
async function until(fn, timeoutMs, label) {
  const end = Date.now() + (timeoutMs || 8000);
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(120);
  }
  bad('等待超时：' + (label || '条件未成立'));
  return false;
}

async function openPage(id) {
  const p = loadPage('pages/tournament/tournament.js');
  await p.onLoad({ id: id });
  return p;
}

(async () => {
  console.log('\n[赛事详情联调] ' + BASE + '\n');

  // ---------- 只读：完整的一届（第十一届） ----------
  console.log('— 详情渲染（第十一届）—');
  const p = await openPage(T11);
  expect(!p.data.loading && !p.data.error, '页面加载完成且无报错');
  expect(p.data.t && p.data.t.name.indexOf('第十一届') >= 0, '赛事名：' + (p.data.t && p.data.t.name));
  expect(p.data.t && p.data.t.statusText === '已结束', '状态文案 = 已结束');
  expect(!!(p.data.t && p.data.t.dateText), '时间区间：' + (p.data.t && p.data.t.dateText));

  expect(p.data.places.length >= 1, '名次条数 ' + p.data.places.length);
  expect(
    p.data.places.length > 0 && p.data.places[0].label === '冠军' && !!p.data.places[0].team,
    '首条名次是冠军：' + (p.data.places[0] ? p.data.places[0].team : '无')
  );

  expect(p.data.teams.length === 8, '队伍 8 支（实际 ' + p.data.teams.length + '）');
  const t0 = p.data.teams[0] || {};
  expect(!!t0.name && t0.memberCount >= 1, '首队「' + t0.name + '」有 ' + t0.memberCount + ' 名成员');
  expect(!!t0.captain, '首队队长：' + t0.captain);
  expect(t0.open === false, '队伍成员默认折叠');

  expect(p.data.signupTotal === 51, '报名名单 51 人（实际 ' + p.data.signupTotal + '）');
  expect(p.data.signupList.length === 8, '首屏只渲染 8 条（实际 ' + p.data.signupList.length + '）');
  expect(
    p.data.signupList.length > 0 && !!p.data.signupList[0].positionsText,
    '名单带本届位置：' + (p.data.signupList[0] ? p.data.signupList[0].positionsText : '')
  );
  expect(
    p.data.signupList.length > 0 && p.data.signupList[0].score > 0,
    '名单带本届分数：' + (p.data.signupList[0] ? p.data.signupList[0].score : '')
  );

  // ---------- 赛程分组（同一届，它有 3 个轮次 17 场） ----------
  console.log('— 赛程分组 —');
  expect(p.data.rounds.length === 3, '轮次分组 3 组（实际 ' + p.data.rounds.length + '）');
  const totalMatches = p.data.rounds.reduce((n, r) => n + r.items.length, 0);
  expect(totalMatches === 17, '对阵共 17 场（实际 ' + totalMatches + '）');
  const r0 = p.data.rounds[0] || { items: [] };
  expect(!!r0.name && r0.items.length >= 1, '首轮「' + r0.name + '」有 ' + r0.items.length + ' 场');
  const m0 = r0.items[0] || {};
  expect(!!m0.a && !!m0.b, '对阵双方：' + m0.a + ' vs ' + m0.b);
  const allItems = p.data.rounds.reduce((acc, r) => acc.concat(r.items), []);
  const scored = allItems.filter((x) => x.finished)[0];
  expect(!!scored, '存在已打完的对阵');
  expect(
    !!scored && /\d+ : \d+/.test(scored.scoreText),
    '比分格式 "A : B"：' + (scored ? scored.scoreText : '无')
  );
  expect(!!scored && !!scored.winner, '已打完的对阵带胜者：' + (scored ? scored.winner : ''));

  // ---------- 交互：折叠展开 ----------
  console.log('— 折叠与展开 —');
  p.toggleTeam({ currentTarget: { dataset: { idx: 0 } } });
  expect(p.data.teams[0].open === true, '点队伍后展开成员');
  expect(
    p.data.teams[0].members.length >= 1 && !!p.data.teams[0].members[0].name,
    '展开后有成员：' + (p.data.teams[0].members[0] || {}).name
  );
  expect(p.data.teams[1].open === false, '只展开被点的那一队（没连坐）');
  p.toggleTeam({ currentTarget: { dataset: { idx: 0 } } });
  expect(p.data.teams[0].open === false, '再点一次收起');

  p.toggleSignups();
  expect(p.data.signupList.length === 51, '展开全部后 51 条（实际 ' + p.data.signupList.length + '）');
  p.toggleSignups();
  expect(p.data.signupList.length === 8, '收起回到 8 条');

  // ---------- 只读：没编赛程 + 并列名次（第一届） ----------
  console.log('— 空赛程与并列名次（第一届）—');
  const p17 = await openPage(T1ST);
  expect(!p17.data.error, '第一届加载无报错');
  expect(p17.data.rounds.length === 0, '没编赛程时 rounds 为空（页面不显示赛程区块，不白屏）');
  expect(p17.data.signupTotal === 40, '报名 40 人（实际 ' + p17.data.signupTotal + '）');
  const seconds = p17.data.places.filter((x) => x.label === '亚军');
  expect(seconds.length === 3, '并列亚军 3 条（实际 ' + seconds.length + '）');
  expect(
    p17.data.places.length === 4 && p17.data.places[0].label === '冠军',
    '名次 4 条且首条为冠军'
  );

  // ---------- 异常：不存在的赛事 ----------
  console.log('— 异常分支 —');
  const bad1 = loadPage('pages/tournament/tournament.js');
  await bad1.onLoad({});
  expect(!!bad1.data.error && bad1.data.error.indexOf('缺少赛事') >= 0, '缺 id 时给提示而不是白屏');
  const bad2 = await openPage('99999999');
  expect(!!bad2.data.error, '不存在的赛事给出错误文案：' + bad2.data.error);

  // ---------- 匿名：点报名先要求登录 ----------
  console.log('— 匿名报名 —');
  const penv = await openPage(T11);
  expect(penv.data.state.loggedIn === false, '未登录时 loggedIn=false');
  penv.onSignupTap();
  await wait(300);
  expect(penv.data.state.signedUp === false, '未登录点报名不会写库（仍显示未报名）');
  expect(penv.data.busy === false, '未登录点报名没把按钮挂死在忙状态');

  // ---------- 写链路：报名 → 名单里出现 → 退赛 ----------
  let signedId = null;
  let page1 = null;
  try {
    if (!GA.pass) {
      console.log('\n· 跳过报名/退赛写链路（未传 MP_GA_PASS）');
    } else {
      console.log('— 报名与退赛（' + GA.user + '）—');
      session.clearLogin();
      const res = await api.request('/api/login', { username: GA.user, password: GA.pass }, { method: 'POST' });
      if (!res || !res.token) throw new Error('夹具账号登录失败');
      session.setLogin({ token: res.token, name: res.name || GA.user, isAdmin: !!res.isAdmin });

      page1 = await openPage(T11);
      expect(page1.data.state.loggedIn === true, '已登录');
      expect(page1.data.state.bound === true, '账号已绑选手资料');
      expect(page1.data.state.signedUp === false, '报名前是未报名状态');
      // 夹具选手没填分数/位置，所以这里应该是空串（不许瞎编一个默认值）
      expect(page1.data.profileText === '', '档案为空时不编造预填值（实际「' + page1.data.profileText + '」）');
      // 用合成档案验一遍格式化（真实账号有分数时走这条）
      page1.applyState({
        loggedIn: true,
        bound: true,
        profile: { score: 5200, positions: '优势路,中单' }
      });
      expect(
        page1.data.profileText === '5200 分 · 优势路·中单',
        '档案预填值格式化：' + page1.data.profileText
      );
      await page1.loadState();

      toasts.length = 0;
      page1.onSignupTap(); // 内部 showModal 由运行时自动确认
      await until(() => page1.data.state.signedUp === true, 12000, '报名后状态变已报名');
      expect(page1.data.state.signedUp === true, '报名成功，按钮变「退赛」');
      expect(page1.data.signupTotal === 52, '名单 51 → 52（实际 ' + page1.data.signupTotal + '）');
      expect(toasts.length > 0, '给了 toast 反馈：' + toasts.join(' / '));

      // 新报名的人在名单末尾（按 signed_at 升序），展开全部才看得到 —— 顺带验证展开逻辑
      page1.toggleSignups();
      const mine = page1.data.signupList.filter((s) => s.name === '_mp_guild_a')[0];
      expect(!!mine, '展开后能在名单里找到自己（_mp_guild_a）');
      signedId = mine ? mine.id : null;

      toasts.length = 0;
      page1.onSignupTap(); // 已报名 → 变退赛
      await until(() => page1.data.state.signedUp === false, 12000, '退赛后状态变未报名');
      expect(page1.data.state.signedUp === false, '退赛成功');
      expect(page1.data.signupTotal === 51, '名单回到 51（实际 ' + page1.data.signupTotal + '）');
      expect(toasts.join('/').indexOf('已退赛') >= 0, '退赛 toast：' + toasts.join(' / '));
      signedId = null;
    }
  } catch (e) {
    bad('写链路异常：' + ((e && e.message) || e));
  } finally {
    // 兜底：只要还留着报名记录就删掉，别在「报名名单」里留个假人
    if (signedId) {
      try {
        await api.request('/api/tournaments/' + T11 + '/signup', {}, { method: 'DELETE' });
        console.log('  · 兜底已清除测试报名');
      } catch (e) {
        console.log('  ! 兜底清除失败，请手工删 tournament_players 里 player_id=' + signedId);
        fail++;
      }
    }
  }

  console.log('');
  if (fail === 0) console.log('✅ 赛事详情全部通过\n');
  else {
    console.log('❌ ' + fail + ' 项未通过\n');
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error('脚本异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});
