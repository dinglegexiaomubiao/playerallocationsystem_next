#!/usr/bin/env node
/**
 * 补丁三块联调：活动地区 / 意见反馈 / 管理员处置评价。
 *
 * 为什么单独一个脚本：它需要「绑了选手行的账号」+「管理员 token」两套身份同时在场，
 * 而 check-miniprogram-writes.cjs 只有无选手行的单账号。夹具仍由
 * deploy/probe-account.cjs 的 up-pair 建。
 *
 * 用法：
 *   node _probe-account.cjs up-pair Probe2026ga Probe2026gb          # 服务器上
 *   MP_GA_PASS=Probe2026ga ADMIN_TOKEN=<dom token> \
 *     node scripts/check-miniprogram-extras.cjs
 *   node _probe-account.cjs down                                      # 服务器上
 */
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const BASE = process.argv[2] || 'https://dota.playerallocationsystem.online';
const ROOT = path.join(__dirname, '..', 'miniprogram');
const GA = { user: process.env.MP_GA_USER || '_mp_ga', pass: process.env.MP_GA_PASS || '' };
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const rt = createRuntime({ baseUrl: BASE, root: ROOT, token: '' });
const { loadPage, loadComponent, wait } = rt;

const api = require(path.join(ROOT, 'utils', 'api.js'));
const session = require(path.join(ROOT, 'utils', 'session.js'));
const regions = require(path.join(ROOT, 'utils', 'regions.js'));

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};
const expect = (cond, msg) => (cond ? ok(msg) : bad(msg));

const stamp = Date.now().toString().slice(-6);
const LOCATION = '自测集合点' + stamp;
const FB_TEXT = '小程序反馈联调 ' + stamp + '，稍后删除';

function asUser(t) {
  session.setLogin({ token: t.token, name: t.name, isAdmin: !!t.isAdmin });
}

async function login(u) {
  session.clearLogin();
  const res = await api.request('/api/login', { username: u.user, password: u.pass }, { method: 'POST' });
  if (!res || !res.token) throw new Error(u.user + ' 没拿到 token');
  const who = { token: res.token, name: res.name || u.user, isAdmin: false };
  asUser(who);
  return who;
}

(async () => {
  console.log('\n[补丁功能联调] ' + BASE + '\n');
  if (!GA.pass || !ADMIN_TOKEN) {
    console.log('需要 MP_GA_PASS（有绑定选手的账号）与 ADMIN_TOKEN（清理工单/活动用）\n');
    process.exit(2);
  }

  const cleanup = { activityId: '', supportId: '', reviewId: '', foodId: '' };
  let A = null;

  try {
    // ---------- 1. 地区组件 ----------
    console.log('— 地区组件（省 / 市 / 区）—');
    expect(
      regions.buildRegion({ province: '广东省', city: '深圳市', district: '南山区' }) ===
        '中国 广东省 深圳市 南山区',
      'buildRegion 拼出 `中国 省 市 区`'
    );
    expect(regions.buildRegion({ province: '广东省' }) === '中国 广东省', '只到省也能拼');
    const sp = regions.splitRegion('中国 北京市 北京市 东城区');
    expect(
      sp.province === '北京市' && sp.city === '北京市' && sp.district === '东城区',
      'splitRegion 能把存量串反解成三级'
    );

    const rp = loadComponent('components/region-picker/region-picker.js', { value: '' });
    await wait(2500); // 等 /data/china-division.json 拉回来
    expect(!rp.data.failed, '区划数据加载成功（不是降级态）');
    expect(rp.data.provinceList.length > 30, '省级列表 ' + rp.data.provinceList.length + ' 项');

    const iGd = rp.data.provinceList.indexOf('广东省');
    rp.onProv({ detail: { value: String(iGd) } });
    expect(rp.events.change && rp.events.change.value === '中国 广东省', '选省后 emit `中国 广东省`');
    const iSz = rp.data.cityList.indexOf('深圳市');
    expect(iSz >= 0, '广东省下能找到深圳市');
    rp.onCity({ detail: { value: String(iSz) } });
    expect(rp.events.change.value === '中国 广东省 深圳市', '选市后 emit `中国 广东省 深圳市`');
    const iNs = rp.data.areaList.indexOf('南山区');
    expect(iNs >= 0, '深圳市下能找到南山区');
    rp.onArea({ detail: { value: String(iNs) } });
    expect(
      rp.events.change.value === '中国 广东省 深圳市 南山区',
      '选到区后 emit 完整四级串'
    );

    // 换省必须把下两级清掉，否则会拼出「广东省 东城区」这种跨省组合
    const iBj = rp.data.provinceList.indexOf('北京市');
    rp.onProv({ detail: { value: String(iBj) } });
    expect(rp.events.change.value === '中国 北京市', '换省后市/区被清空（不会跨省拼串）');

    const rp2 = loadComponent('components/region-picker/region-picker.js', {
      value: '中国 广东省 深圳市 南山区'
    });
    await wait(2000);
    expect(
      rp2.data.province === '广东省' && rp2.data.city === '深圳市' && rp2.data.district === '南山区',
      '带值进来能正确回填三级'
    );
    rp2.clear();
    expect(rp2.events.change.value === '', '清除按钮 emit 空串');

    // ---------- 2. 发活动带地区 ----------
    console.log('\n— 发活动（地区字段）—');
    A = await login(GA);
    const an = await loadPage('pages/activity-new/activity-new.js');
    an.onLoad();
    await wait(2500); // options
    if (an.data.optionsError) throw new Error('活动页选项没加载出来: ' + an.data.optionsError);

    an.onRegion({ detail: { value: '中国 广东省 深圳市 南山区' } });
    an.onInput({ currentTarget: { dataset: { k: 'location' } }, detail: { value: LOCATION } });
    an.submit();
    await wait(4000);
    if (an.data.error) throw new Error('发活动失败: ' + an.data.error);

    const acts = await api.request('/api/activities', null, { method: 'GET' });
    // ⚠ 列表接口的字段叫 posts，不是 activities（别按列表页的名字猜）
    const mine = (acts.posts || []).filter((x) => x.location === LOCATION)[0];
    if (!mine) throw new Error('活动接口说成功了，但列表里找不到（location=' + LOCATION + '）');
    cleanup.activityId = String(mine.id);
    expect(mine.region === '中国 广东省 深圳市 南山区', '活动 region 落库正确：' + mine.region);
    expect(!!mine.id, '活动 #' + mine.id + ' 已出现在列表');

    // 活动只能由发起人关/删（account_name 严格匹配，管理员也不行），所以用 A 自己删
    await api.request('/api/activities/' + cleanup.activityId, {}, { method: 'DELETE' });
    const actsAfter = await api.request('/api/activities', null, { method: 'GET' });
    expect(
      !(actsAfter.posts || []).some((x) => String(x.id) === cleanup.activityId),
      '删除后活动从列表消失'
    );
    cleanup.activityId = '';

    // ---------- 3. 反馈提交 + 我的反馈 ----------
    console.log('\n— 意见反馈 —');
    asUser(A);
    const fb = await loadPage('pages/feedback/feedback.js');
    fb.onLoad();
    fb.onInput({ currentTarget: { dataset: { k: 'message' } }, detail: { value: FB_TEXT } });
    fb.onInput({ currentTarget: { dataset: { k: 'contact' } }, detail: { value: '自测联系方式' } });
    fb.submit();
    await wait(9000); // 词表之后还有 AI 复审
    if (fb.data.error) throw new Error('反馈提交失败: ' + fb.data.error);
    expect(fb.data.tab === 'mine', '提交后自动切到「我的反馈」');
    expect(fb.data.message === '', '提交后正文已清空');

    await wait(1500);
    const row = (fb.data.reports || []).filter((r) => r.message === FB_TEXT)[0];
    expect(!!row, '「我的反馈」里能查到自己刚提的那条（client_token 生效）');
    if (row) {
      cleanup.supportId = row.id;
      expect(row.statusText.length > 0, '状态有中文文案：' + row.statusText);
      expect(row.timeText.length > 0, '时间格式化正常：' + row.timeText);
    }

    if (cleanup.supportId) {
      // 只有管理员能删工单，直接用管理员身份（_mp_ga 删会 403）
      session.setLogin({ token: ADMIN_TOKEN, name: 'dom', isAdmin: true });
      await api.request('/api/support', { id: cleanup.supportId }, { method: 'DELETE' });
      cleanup.supportId = '';
      asUser(A);
      await fb.loadMine();
      expect(
        !(fb.data.reports || []).some((r) => r.message === FB_TEXT),
        '管理员删掉后「我的反馈」里也没了'
      );
    }

    // ---------- 4. 管理员处置评价 ----------
    console.log('\n— 管理员删除违规评价 —');
    const foods = await api.request('/api/foods', null, { method: 'GET' });
    const food = (foods.foods || [])[0];
    if (!food) throw new Error('没有可测试的店');

    const created = await api.request(
      '/api/food-reviews',
      { food_id: String(food.id), content: '自测违规评价 ' + stamp, rating: 1 },
      { method: 'POST' }
    );
    const reviewId = created && created.review ? String(created.review.id) : '';
    if (!reviewId) throw new Error('测试评价没建出来');
    cleanup.reviewId = reviewId;
    cleanup.foodId = String(food.id);
    ok('已造一条待删评价 #' + reviewId + '（' + food.name + '）');

    // 切管理员身份加载美食页：isAdmin 决定「删除」按钮显不显示
    session.setLogin({ token: ADMIN_TOKEN, name: 'dom', isAdmin: true });
    const fp = await loadPage('pages/foods/foods.js');
    fp.onLoad();
    await wait(4000);
    expect(fp.data.isAdmin === true, '管理员身份下 isAdmin=true（页面上才会出现删除按钮）');

    const item = (fp.data.list || []).filter((x) => x.id === String(food.id))[0];
    if (!item) throw new Error('美食列表里找不到这家店（id=' + food.id + '）');
    const countBefore = item.reviewCount;

    fp.toggleReviews({ currentTarget: { dataset: { id: String(food.id) } } });
    await wait(400);
    const opened = (fp.data.list || []).filter((x) => x.id === String(food.id))[0];
    expect(opened.expanded === true, '点击后评价区展开');
    expect(
      (opened.reviews || []).some((r) => r.id === reviewId),
      '展开后能看到这条评价（共 ' + (opened.reviews || []).length + ' 条）'
    );

    fp.removeReview({ currentTarget: { dataset: { id: reviewId, food: String(food.id) } } });
    await wait(2500);
    const after = (fp.data.list || []).filter((x) => x.id === String(food.id))[0];
    expect(!(after.reviews || []).some((r) => r.id === reviewId), '删除后本地列表里立刻消失');
    expect(after.reviewCount === Math.max(0, countBefore - 1), '评价条数 ' + countBefore + ' → ' + after.reviewCount);

    // 服务端确认（本地删了不代表库里没了）
    const foods2 = await api.request('/api/foods', null, { method: 'GET' });
    const food2 = (foods2.foods || []).filter((x) => String(x.id) === String(food.id))[0];
    expect(
      !(food2.reviews || []).some((r) => String(r.id) === reviewId),
      '库里也确实删掉了'
    );
    cleanup.reviewId = '';
  } catch (e) {
    bad(e.message);
  } finally {
    // 收尾：任何一步挂了都不留测试数据
    const admin = { token: ADMIN_TOKEN, name: 'dom', isAdmin: true };
    if (cleanup.activityId || cleanup.supportId || cleanup.reviewId) {
      session.setLogin(admin);
      if (cleanup.activityId) {
        // ⚠ 活动只有发起人能删（管理员也不行），必须用 A 的身份
        try {
          if (!A) throw new Error('创建账号的会话已丢，无法删除');
          asUser(A);
          await api.request('/api/activities/' + cleanup.activityId, {}, { method: 'DELETE' });
          console.log('  · 已清理残留活动 #' + cleanup.activityId);
        } catch (e) {
          console.log('  ! 残留活动 #' + cleanup.activityId + ' 没删掉: ' + e.message);
          fail++;
        }
        session.setLogin(admin);
      }
      if (cleanup.supportId) {
        try {
          await api.request('/api/support', { id: cleanup.supportId }, { method: 'DELETE' });
          console.log('  · 已清理残留工单 #' + cleanup.supportId);
        } catch (e) {
          console.log('  ! 残留工单 #' + cleanup.supportId + ' 没删掉: ' + e.message);
          fail++;
        }
      }
      if (cleanup.reviewId) {
        try {
          await api.request('/api/food-reviews', { id: cleanup.reviewId }, { method: 'DELETE' });
          console.log('  · 已清理残留评价 #' + cleanup.reviewId);
        } catch (e) {
          console.log('  ! 残留评价 #' + cleanup.reviewId + ' 没删掉: ' + e.message);
          fail++;
        }
      }
    }
    session.clearLogin();
  }

  console.log('\n' + (fail ? '❌ ' + fail + ' 项没通过\n' : '✅ 三块补丁全部通过，且没有残留\n'));
  process.exit(fail ? 1 : 0);
})();
