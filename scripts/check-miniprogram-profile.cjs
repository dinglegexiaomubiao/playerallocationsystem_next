#!/usr/bin/env node
/**
 * P1 三页联调：个人信息 / 我的赛事 / 改密码。
 *
 * 重点验的是「不该发生的写入」：
 *   ① 只提交改动过的字段 —— 没动的天梯分 / 最高分不能被清空；
 *   ② 留空 = 不修改（不是清空）；
 *   ③ 非法数字（小数）在客户端就拦下，不发请求。
 * 这三条错了都不会报错，只会悄悄改坏用户资料，所以必须写死断言。
 *
 * 用法：
 *   node scripts/check-miniprogram-profile.cjs                    # 只读部分
 *   MP_GA_PASS=Probe2026ga node scripts/check-miniprogram-profile.cjs
 */
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const BASE = process.argv[2] || 'https://dota.playerallocationsystem.online';
const ROOT = path.join(__dirname, '..', 'miniprogram');
const GA = { user: process.env.MP_GA_USER || '_mp_ga', pass: process.env.MP_GA_PASS || '' };
const NEW_PASS = 'Probe2026ga2';

const rt = createRuntime({ baseUrl: BASE, root: ROOT, token: '' });
const { loadPage, loadComponent, wait, toasts } = rt;

const api = require(path.join(ROOT, 'utils', 'api.js'));
const session = require(path.join(ROOT, 'utils', 'session.js'));

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};
const expect = (cond, msg) => (cond ? ok(msg) : bad(msg));

async function until(fn, timeoutMs, label) {
  const end = Date.now() + (timeoutMs || 10000);
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(120);
  }
  bad('等待超时：' + (label || '条件未成立'));
  return false;
}

const input = (page, key, value) =>
  page.onInput({ currentTarget: { dataset: { key: key } }, detail: { value: String(value) } });

(async () => {
  console.log('\n[P1 三页联调] ' + BASE + '\n');

  // ---------- 未登录 ----------
  console.log('— 未登录 —');
  session.clearLogin();
  const p0 = loadPage('pages/profile/profile.js');
  await p0.onLoad();
  expect(p0.data.needLogin === true, '个人信息：未登录时提示去登录（不是白屏也不是报错）');

  const t0 = loadPage('pages/my-tournaments/my-tournaments.js');
  await t0.onLoad();
  expect(t0.data.needLogin === true, '我的赛事：未登录时提示去登录');

  if (!GA.pass) {
    console.log('\n· 跳过登录后的写链路（未传 MP_GA_PASS）\n');
    return finish();
  }

  // ---------- 登录 ----------
  console.log('— 登录后加载 —');
  const res = await api.request('/api/login', { username: GA.user, password: GA.pass }, { method: 'POST' });
  if (!res || !res.token) throw new Error('夹具账号登录失败');
  session.setLogin({ token: res.token, name: res.name || GA.user, isAdmin: !!res.isAdmin });

  // 把夹具资料复位成干净基线：这个脚本要能反复跑。
  // 不复位的话，第二次跑时「位置」已经是选中的，再点一下反而变成取消，
  // 断言就会莫名其妙挂掉（我第一次重跑就踩到了）。
  await api.request(
    '/api/profile',
    {
      score: 0,
      peak_score: 0,
      win_rate: 0,
      positions: [],
      heroes: [],
      self_intro: '',
      region: '',
      synergy_players: [],
      enemies: []
    },
    { method: 'PUT' }
  );

  const p = loadPage('pages/profile/profile.js');
  await p.onLoad();
  expect(!p.data.loading && !p.data.error, '个人信息加载完成');
  expect(p.data.bound === true, '账号已绑选手资料');
  expect(p.data.info.nickname === '_mp_guild_a', '昵称：' + p.data.info.nickname);
  expect(p.data.posChips.length === 6, '位置选项 6 个（来自 /api/options）');
  expect(p.data.limits.selfIntro === 300, '自我评价上限来自 /api/options：' + p.data.limits.selfIntro);
  expect(p.data.limits.nickname === 24, '群昵称上限来自 /api/options：' + p.data.limits.nickname);

  const before = await api.request('/api/profile', null, { method: 'GET' });
  const base = before.profile || {};
  console.log('    · 初始：score=' + base.score + ' peak=' + base.peak_score + ' region=' + JSON.stringify(base.region));

  // ---------- 第一次保存：改分数 / 胜率 / 位置 / 自评 ----------
  console.log('— 保存（多字段）—');
  input(p, 'score', 4800);
  input(p, 'peak_score', 6000);
  input(p, 'win_rate', 55);
  input(p, 'self_intro', '自测自我评价 2026');
  p.onTogglePos({ currentTarget: { dataset: { name: '优势路' } } });
  p.onTogglePos({ currentTarget: { dataset: { name: '中单' } } });
  expect(
    p.data.posChips.filter((x) => x.on).length === 2,
    '位置多选选中 2 项：' + p.data.form.positions.join('/')
  );

  toasts.length = 0;
  p.onSave();
  await until(() => p.data.saving === false, 12000, '保存结束');
  expect(toasts.join('/').indexOf('已保存') >= 0, '保存后提示：' + toasts.join(' / '));

  const after1 = (await api.request('/api/profile', null, { method: 'GET' })).profile || {};
  expect(Number(after1.score) === 4800, '当前天梯分落库 4800（实际 ' + after1.score + '）');
  expect(Number(after1.peak_score) === 6000, '历史最高分落库 6000（实际 ' + after1.peak_score + '）');
  expect(Number(after1.win_rate) === 55, '胜率落库 55（实际 ' + after1.win_rate + '）');
  expect(
    (after1.positions || []).join(',') === '优势路,中单',
    '位置落库且按 options 顺序：' + (after1.positions || []).join(',')
  );
  expect(after1.self_intro === '自测自我评价 2026', '自我评价落库');

  // ---------- 第二次保存：只改自评，别的字段必须原样 ----------
  console.log('— 保存（只改一个字段，其余不许被清空）—');
  input(p, 'self_intro', '自测自我评价 2026 · 第二次');
  p.onSave();
  await until(() => p.data.saving === false, 12000, '第二次保存结束');

  const after2 = (await api.request('/api/profile', null, { method: 'GET' })).profile || {};
  expect(after2.self_intro === '自测自我评价 2026 · 第二次', '自评已更新');
  expect(Number(after2.score) === 4800, '没动的天梯分仍是 4800（实际 ' + after2.score + '）');
  expect(Number(after2.peak_score) === 6000, '没动的最高分仍是 6000（实际 ' + after2.peak_score + '）');
  expect(Number(after2.win_rate) === 55, '没动的胜率仍是 55（实际 ' + after2.win_rate + '）');
  expect((after2.positions || []).length === 2, '没动的位置仍是 2 项');

  // ---------- 留空 = 不修改 ----------
  console.log('— 留空不写库 —');
  input(p, 'score', '');
  p.onSave();
  await until(() => p.data.saving === false, 12000, '留空保存结束');
  const after3 = (await api.request('/api/profile', null, { method: 'GET' })).profile || {};
  expect(Number(after3.score) === 4800, '分数输入框留空后，库里仍是 4800（没有被清空）');

  // ---------- 小数被拦在客户端 ----------
  console.log('— 校验 —');
  await p.load(); // 重新拉一次，把输入框恢复成库里的值
  input(p, 'score', '49.5');
  toasts.length = 0;
  p.onSave();
  await wait(600);
  expect(toasts.join('/').indexOf('整数') >= 0, '小数被拦：' + toasts.join(' / '));
  const after4 = (await api.request('/api/profile', null, { method: 'GET' })).profile || {};
  expect(Number(after4.score) === 4800, '被拦下时没有写库（仍是 4800）');

  // ---------- 无改动 ----------
  await p.load();
  toasts.length = 0;
  p.onSave();
  await wait(400);
  expect(toasts.join('/').indexOf('没有改动') >= 0, '没改任何字段时提示「没有改动」');

  // ---------- 地区：组件回填 + 提交 ----------
  console.log('— 地区 —');
  const picker = loadComponent('components/region-picker/region-picker.js', {
    value: '中国 广东省 深圳市 南山区'
  });
  await until(() => picker.data.provinceList.length > 0, 12000, '地区数据加载');
  expect(picker.data.province === '广东省', '组件回填省：' + picker.data.province);
  expect(picker.data.city === '深圳市', '组件回填市：' + picker.data.city);
  expect(picker.data.district === '南山区', '组件回填区：' + picker.data.district);

  p.onRegion({ detail: { value: '中国 广东省 深圳市 福田区' } });
  p.onSave();
  await until(() => p.data.saving === false, 12000, '地区保存结束');
  const after5 = (await api.request('/api/profile', null, { method: 'GET' })).profile || {};
  expect(after5.region === '中国 广东省 深圳市 福田区', '地区落库：' + after5.region);

  // ---------- 我的赛事 ----------
  console.log('— 我的赛事 —');
  const mt = loadPage('pages/my-tournaments/my-tournaments.js');
  await mt.onLoad();
  expect(!mt.data.loading && !mt.data.error, '我的赛事加载完成');
  expect(mt.data.bound === true, '绑定资料为 true');
  expect(Array.isArray(mt.data.list) && mt.data.list.length === 0, '夹具没参加过赛事 → 列表为空（空态，不报错）');

  // 真造一条报名记录，验列表映射（赛事名 / 状态 / 报名时间），然后退赛清掉
  let joined = false;
  try {
    await api.request('/api/tournaments/16/signup', {}, { method: 'POST' });
    joined = true;
    const mt2 = loadPage('pages/my-tournaments/my-tournaments.js');
    await mt2.onLoad();
    expect(mt2.data.list.length === 1, '报名后列表 1 条（实际 ' + mt2.data.list.length + '）');
    const one = mt2.data.list[0] || {};
    expect(
      String(one.name || '').indexOf('第十一届') >= 0,
      '赛事名：' + one.name
    );
    expect(one.statusText === '已结束', '状态文案：' + one.statusText);
    expect(one.captain === false, '不是队长时不给队长标');
    expect(!!one.dateText, '报名时间：' + one.dateText);
    expect(one.signupText === '已通过', '报名状态文案：' + one.signupText);
  } catch (e) {
    bad('我的赛事映射异常：' + ((e && e.message) || e));
  } finally {
    if (joined) {
      try {
        await api.request('/api/tournaments/16/signup', {}, { method: 'DELETE' });
        console.log('  · 已退赛，报名记录清掉');
      } catch (e) {
        bad('退赛失败，请手工删 tournament_players 里 ' + GA.user + ' 的记录');
      }
    }
  }

  // ---------- 改密码 ----------
  console.log('— 改密码 —');
  const pw = loadPage('pages/password/password.js');
  input(pw, 'oldPassword', GA.pass);
  input(pw, 'newPassword', '123');
  pw.onSubmit();
  expect(pw.data.error.indexOf('至少 6 位') >= 0, '太短被拦：' + pw.data.error);

  input(pw, 'newPassword', NEW_PASS);
  input(pw, 'confirm', NEW_PASS + 'x');
  pw.onSubmit();
  expect(pw.data.error.indexOf('不一致') >= 0, '两次不一致被拦：' + pw.data.error);

  input(pw, 'confirm', NEW_PASS);
  pw.onSubmit();
  await until(() => pw.data.busy === false, 12000, '改密结束');
  expect(pw.data.error === '', '改密成功无报错');
  expect(pw.data.oldPassword === '' && pw.data.newPassword === '', '成功后清空输入框');

  // 用新密码真的登录一次，证明密码确实换了（不是本地以为换了）
  session.clearLogin();
  const relogin = await api.request('/api/login', { username: GA.user, password: NEW_PASS }, { method: 'POST' });
  expect(!!relogin && !!relogin.token, '用新密码能登录');
  session.setLogin({ token: relogin.token, name: GA.user, isAdmin: false });

  // 改回原密码，别把夹具留在「密码已变」的状态
  const pw2 = loadPage('pages/password/password.js');
  input(pw2, 'oldPassword', NEW_PASS);
  input(pw2, 'newPassword', GA.pass);
  input(pw2, 'confirm', GA.pass);
  pw2.onSubmit();
  await until(() => pw2.data.busy === false, 12000, '改回原密码');
  expect(pw2.data.error === '', '已改回原密码');

  finish();
})().catch((e) => {
  console.error('脚本异常：', e && e.stack ? e.stack : e);
  process.exit(1);
});

function finish() {
  console.log('');
  if (fail === 0) console.log('✅ P1 三页全部通过\n');
  else {
    console.log('❌ ' + fail + ' 项未通过\n');
    process.exitCode = 1;
  }
}
