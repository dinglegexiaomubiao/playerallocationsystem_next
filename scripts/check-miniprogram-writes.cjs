#!/usr/bin/env node
/**
 * 写操作联调：真的用页面逻辑去发布/报名/评价，验完把数据清掉。
 *
 * 为什么要单独一测：只读页面字段映射错了顶多显示难看，写操作字段拼错会
 * **静默写进生产库**（比如 mode 传了 label 而不是 key，服务端存进去的就是
 * 一个没人认识的值）。所以这里走真实接口，并且每条都验证「副作用确实发生」
 * 以及「清理后确实消失」。
 *
 * 需要：
 *   MP_PROBE_USER / MP_PROBE_PASS  由 deploy/probe-account.cjs 临时建的探针账号
 *   ADMIN_TOKEN                    管理员（dom）token。两个用途：删测试评价
 *                                   （/api/food-reviews DELETE 只给管理员）、
 *                                   删测试语录 + 建/关/删测试卡片
 *                                   （探针账号没绑选手行，自己删不掉自己的语录）
 *   MP_TOKEN                       （可选）身份识别用
 *
 * 用法：
 *   MP_PROBE_USER=_mp_probe MP_PROBE_PASS=Probe2026mp ADMIN_TOKEN=xxx \
 *     node scripts/check-miniprogram-writes.cjs
 */
const path = require('path');
const https = require('https');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const BASE = process.argv[2] || 'https://dota.playerallocationsystem.online';
const ROOT = path.join(__dirname, '..', 'miniprogram');
const PROBE_USER = process.env.MP_PROBE_USER || '';
const PROBE_PASS = process.env.MP_PROBE_PASS || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const rt = createRuntime({ baseUrl: BASE, root: ROOT, token: '' });
const { loadPage, wait } = rt;

const api = require(path.join(ROOT, 'utils', 'api.js'));
const session = require(path.join(ROOT, 'utils', 'session.js'));

const pad = (n) => (n < 10 ? '0' + n : '' + n);
function inHours(h) {
  const d = new Date(Date.now() + h * 60 * 60 * 1000);
  return { date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), time: pad(d.getHours()) + ':00' };
}

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};

/** 临时换成另一个身份发请求（清理时要用管理员删评价） */
async function asIdentity(token, fn) {
  const prevStore = rt.store.get('token');
  const prevApp = rt.app.globalData.token;
  rt.store.set('token', token);
  rt.app.globalData.token = token;
  try {
    return await fn();
  } finally {
    if (prevStore === undefined) rt.store.delete('token');
    else rt.store.set('token', prevStore);
    rt.app.globalData.token = prevApp;
  }
}

(async () => {
  console.log('\n[写操作联调] ' + BASE + '\n');
  if (!PROBE_USER || !PROBE_PASS) {
    console.log('缺少 MP_PROBE_USER / MP_PROBE_PASS，先跑 deploy/probe-account.cjs up <密码>\n');
    process.exit(2);
  }

  const cleanup = { activityId: '', reviewId: '', partyJoined: '', quoteId: '', partyCreatedId: '' };

  try {
    // ---------- 1. 选项接口 ----------
    console.log('— 选项常量 —');
    const { loadOptions } = require(path.join(ROOT, 'utils', 'options.js'));
    const opts = await loadOptions();
    if (!opts.partyModes || !opts.partyModes.length) throw new Error('/api/options 没有 partyModes');
    if (!opts.activityTypes || !opts.activityTypes.length) throw new Error('/api/options 没有 activityTypes');
    ok(
      'GET /api/options → 模式 ' + opts.partyModes.length + ' / 类型 ' + opts.activityTypes.length +
        ' / 位置 ' + (opts.positions || []).length + ' / 时长 ' + (opts.durations || []).length
    );

    // ---------- 2. 探针登录 ----------
    console.log('\n— 登录 —');
    const login = await loadPage('pages/login/login.js');
    login.onLoad({});
    login.onUsername({ detail: { value: PROBE_USER } });
    login.onPassword({ detail: { value: PROBE_PASS } });
    login.submit();
    await wait(4000);
    if (login.data.error) throw new Error('登录失败: ' + login.data.error);
    if (!session.getToken()) throw new Error('登录后没有 token');
    ok('探针账号登录成功，token 已存');

    // ---------- 3. 发开黑：字段必须全部通过服务端校验 ----------
    console.log('\n— 发开黑（表单 → /api/party）—');
    const partyNew = await loadPage('pages/party-new/party-new.js');
    partyNew.onLoad({});
    await wait(3000);
    if (partyNew.data.optionsError) throw new Error('选项加载失败: ' + partyNew.data.optionsError);
    const when1 = inHours(3);
    partyNew.setData({ modeIndex: 0, needIndex: 2, durIndex: 0, date: when1.date, time: when1.time, title: '自测卡片请忽略' });
    partyNew.submit();
    await wait(5000);
    {
      // 探针账号没绑选手资料，服务端必然在「已通过所有字段校验」之后才拒它。
      // 如果错误是「请选择开黑模式 / 请选择持续时间 / 请选择开始时间」，
      // 说明表单字段拼错了 —— 那才是这个断言真正在防的东西。
      const err = String(partyNew.data.error || '');
      if (!err) throw new Error('没报错，可能真的建了卡片（需人工检查并删除）');
      if (err.indexOf('选手资料') < 0) throw new Error('错误不是「缺选手资料」，说明字段校验没过: ' + err);
      ok('字段全部通过校验（服务端按预期拦在「缺选手资料」）');
    }

    // ---------- 4. 发活动：真实创建 → 校验 → 删除 ----------
    console.log('\n— 发活动（表单 → /api/activities）—');
    const actNew = await loadPage('pages/activity-new/activity-new.js');
    actNew.onLoad({});
    await wait(3000);
    if (actNew.data.optionsError) throw new Error('选项加载失败: ' + actNew.data.optionsError);
    const when2 = inHours(24);
    const actTitle = '自测活动请忽略 ' + Date.now();
    actNew.setData({
      typeIndex: 0,
      needIndex: 4,
      durIndex: 1,
      costIndex: 1,
      date: when2.date,
      time: when2.time,
      location: '自测地点（稍后删除）',
      title: actTitle,
      note: '小程序写操作联调产生的临时数据，脚本结束会删掉。'
    });
    actNew.submit();
    await wait(6000);
    if (actNew.data.error) throw new Error('发布失败: ' + actNew.data.error);

    const actList = await api.request('/api/activities', null, { method: 'GET' });
    const created = (actList.posts || []).filter((p) => p.title === actTitle)[0];
    if (!created) throw new Error('接口说成功了，但列表里找不到刚建的活动');
    cleanup.activityId = String(created.id);
    ok(
      '已创建活动 #' + created.id + '（' + created.typeLabel + ' / ' +
        created.joinedPeople + '/' + created.need_people + ' 人 / 集合 ' + created.meet_at + '）'
    );

    await api.request('/api/activities/' + cleanup.activityId, {}, { method: 'DELETE' });
    cleanup.activityId = '';
    const actAfter = await api.request('/api/activities', null, { method: 'GET' });
    if ((actAfter.posts || []).some((p) => p.title === actTitle)) throw new Error('删除后活动还在');
    ok('删除成功，列表里已消失');

    // ---------- 5. 报名 / 取消报名（开黑） ----------
    console.log('\n— 开黑报名 → 取消 —');
    const before = await api.request('/api/party', null, { method: 'GET' });
    const all = before.posts || [];
    const isFree = (p) =>
      p.status === 'open' && !p.isMine && !p.iJoined &&
      (p.need_players === null || p.need_players === undefined || p.signupCount < p.need_players);
    // 优先挑「还能报名」的（页面上的按钮也只给这种卡）；
    // 线上现有卡片全都过期了，但服务端的报名接口只看 status、不看 expired，
    // 所以退一步拿过期卡验证接口本身 —— 报名再取消，不留任何内容。
    let target = all.filter((p) => isFree(p) && !p.expired)[0];
    let useExpired = false;
    if (!target) {
      target = all.filter(isFree)[0];
      useExpired = !!target;
    }
    if (!target) {
      console.log('  · 没有可报名的卡片（跳过）');
    } else {
      if (useExpired) console.log('  · 现有卡片均已过期，用过期卡验证「报名→取消」接口（不留内容）');
      cleanup.partyJoined = String(target.id);
      await api.request('/api/party/' + target.id + '/join', {}, { method: 'POST' });
      const joined = await api.request('/api/party', null, { method: 'GET' });
      const afterJoin = (joined.posts || []).filter((p) => String(p.id) === String(target.id))[0];
      if (!afterJoin || !afterJoin.iJoined) throw new Error('报名后 iJoined 仍为 false');
      ok('报名「' + target.title + '」成功，人数 ' + target.signupCount + ' → ' + afterJoin.signupCount);

      await api.request('/api/party/' + target.id + '/join', {}, { method: 'DELETE' });
      const cancelled = await api.request('/api/party', null, { method: 'GET' });
      const afterCancel = (cancelled.posts || []).filter((p) => String(p.id) === String(target.id))[0];
      if (!afterCancel || afterCancel.iJoined) throw new Error('取消后 iJoined 仍为 true');
      if (afterCancel.signupCount !== target.signupCount) {
        throw new Error('取消后人数没回到原值：' + afterCancel.signupCount + ' ≠ ' + target.signupCount);
      }
      cleanup.partyJoined = '';
      ok('取消报名成功，人数已回到 ' + target.signupCount);
    }

    // ---------- 6. 美食评价：创建 → 校验 → 管理员删除 ----------
    console.log('\n— 美食评价（表单 → /api/food-reviews）—');
    if (!ADMIN_TOKEN) {
      console.log('  · 跳过（没传 ADMIN_TOKEN，创建后无法清理）');
    } else {
      const foods = await api.request('/api/foods', null, { method: 'GET' });
      const food = (foods.foods || [])[0];
      if (!food) throw new Error('没有可评价的店');

      const reviewPage = await loadPage('pages/food-review/food-review.js');
      reviewPage.onLoad({ id: String(food.id), name: food.name });
      reviewPage.onStar({ currentTarget: { dataset: { n: 4 } } });
      const text = '小程序写操作联调 ' + Date.now() + '，稍后删除';
      reviewPage.onContent({ detail: { value: text } });
      reviewPage.submit();
      await wait(8000);
      if (reviewPage.data.error) throw new Error('提交失败: ' + reviewPage.data.error);

      const after2 = await api.request('/api/foods', null, { method: 'GET' });
      const f2 = (after2.foods || []).filter((x) => String(x.id) === String(food.id))[0];
      const mine = (f2.reviews || []).filter((r) => r.content === text)[0];
      if (!mine) throw new Error('提交成功但列表里找不到这条评价');
      cleanup.reviewId = String(mine.id);
      ok('已提交评价 #' + mine.id + '（' + food.name + '，' + mine.rating + ' 星）');

      await asIdentity(ADMIN_TOKEN, () =>
        api.request('/api/food-reviews', { id: cleanup.reviewId }, { method: 'DELETE' })
      );
      cleanup.reviewId = '';
      const after3 = await api.request('/api/foods', null, { method: 'GET' });
      const f3 = (after3.foods || []).filter((x) => String(x.id) === String(food.id))[0];
      if ((f3.reviews || []).some((r) => r.content === text)) throw new Error('删除后评价还在');
      ok('管理员已删除该评价，店里的评价数回到 ' + (f3.reviews || []).length);
    }

    // ---------- 7. 语录收录：创建 → 非属主删除被挡 → 管理员删除 ----------
    // 为什么要拆成两段：属主判据是 `submitted_by = 本人的 players.id`，而探针账号
    // 在 play_score 里 player_id 为 NULL（真实注册一定会建/复用选手行并绑定，
    // 见 pages/api/register.js），所以属主分支在联调里根本走不到 ——
    // 探针删自己刚收的语录会和删别人的一样被 403 挡下。这里把它当负向用例验闸门，
    // 再切管理员身份真删。属主分支只能由「绑了选手行的账号」覆盖。
    console.log('\n— 语录收录（表单 → /api/quotes）—');
    {
      const quoteNew = await loadPage('pages/quote-new/quote-new.js');
      quoteNew.onLoad({});
      const text = '写操作自测语录 ' + Date.now() + '，稍后删除';
      quoteNew.onContent({ detail: { value: text } });
      // 走「自己写出处」这条路（选群友那条要搜人，/api/players/search 单独验证）
      quoteNew.onMode({ currentTarget: { dataset: { v: 'text' } } });
      quoteNew.onSourceText({ detail: { value: '自测出处' } });
      quoteNew.submit();
      await wait(10000); // 词表之后还有 AI 复审，等久一点
      if (quoteNew.data.error) throw new Error('收录失败: ' + quoteNew.data.error);

      const qs = await api.request('/api/quotes?limit=30', null, { method: 'GET' });
      const mineQuote = (qs.quotes || []).filter((q) => q.content === text)[0];
      if (!mineQuote) throw new Error('接口说成功了，但列表里找不到刚收录的语录');
      cleanup.quoteId = String(mineQuote.id);
      ok('已收录语录 #' + mineQuote.id + '（出处「' + (mineQuote.source.text || mineQuote.source.nickname) + '」）');

      // 列表里每条都带 canDelete：小程序靠它决定显不显示「删除」按钮
      if (mineQuote.canDelete === false) {
        ok('列表里 canDelete=false（没绑选手行 → 页面不会显示删除按钮）');
      } else {
        bad('列表里 canDelete 应为 false，实际 ' + mineQuote.canDelete);
      }
      const adminView = await asIdentity(ADMIN_TOKEN, () =>
        api.request('/api/quotes?limit=30', null, { method: 'GET' })
      );
      const sameAsAdmin = (adminView.quotes || []).filter((q) => String(q.id) === cleanup.quoteId)[0];
      if (sameAsAdmin && sameAsAdmin.canDelete === true) {
        ok('管理员视角同一条 canDelete=true');
      } else {
        bad('管理员视角 canDelete 应为 true，实际 ' + (sameAsAdmin ? sameAsAdmin.canDelete : '找不到这条'));
      }

      let denied = null;
      try {
        await api.request('/api/quotes/' + cleanup.quoteId, {}, { method: 'DELETE' });
      } catch (e) {
        denied = e;
      }
      if (!denied) throw new Error('没绑选手行的账号居然删成功了，属主判据可疑');
      if (denied.statusCode !== 403) {
        throw new Error('期望 403，实际 ' + denied.statusCode + '：' + denied.message);
      }
      if (String(denied.message || '').indexOf('只能删自己') < 0) {
        throw new Error('403 但文案不对：' + denied.message);
      }
      ok('没绑选手行的账号删不掉（403「只能删自己收录的语录」）—— 闸门生效');

      if (!ADMIN_TOKEN) throw new Error('没有 ADMIN_TOKEN：这条语录删不掉，请带管理员 token 重跑');
      await asIdentity(ADMIN_TOKEN, () =>
        api.request('/api/quotes/' + cleanup.quoteId, {}, { method: 'DELETE' })
      );
      cleanup.quoteId = '';
      const qs2 = await api.request('/api/quotes?limit=30', null, { method: 'GET' });
      if ((qs2.quotes || []).some((q) => q.content === text)) throw new Error('删除后语录还在');
      ok('管理员删除成功，列表里已消失');
    }

    // ---------- 8. 关闭自己的卡片（PATCH）----------
    console.log('\n— 关闭招募（PATCH /api/party/{id}）—');
    if (!ADMIN_TOKEN) {
      console.log('  · 跳过（没传 ADMIN_TOKEN：探针账号没绑选手，建不了卡片）');
    } else {
      const cardTitle = '自测卡片请忽略 ' + Date.now();
      const iso = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
      await asIdentity(ADMIN_TOKEN, () =>
        api.request(
          '/api/party',
          {
            mode: opts.partyModes[0].key,
            need_players: 5,
            duration_min: 90,
            start_at: iso,
            title: cardTitle
          },
          { method: 'POST' }
        )
      );
      const list1 = await api.request('/api/party', null, { method: 'GET' });
      const card = (list1.posts || []).filter((p) => p.title === cardTitle)[0];
      if (!card) throw new Error('卡片没建出来（或列表里找不到）');
      cleanup.partyCreatedId = String(card.id);
      ok('已建卡片 #' + card.id + '（' + card.statusLabel + ' / ' + card.play_time + '）');

      const patched = await asIdentity(ADMIN_TOKEN, () =>
        api.request('/api/party/' + card.id, { status: 'closed' }, { method: 'PATCH' })
      );
      const list2 = await api.request('/api/party', null, { method: 'GET' });
      const closed = (list2.posts || []).filter((p) => String(p.id) === String(card.id))[0];
      if (!closed || closed.status !== 'closed') throw new Error('PATCH 后状态不是 closed');
      ok('PATCH 关闭成功 → ' + patched.statusLabel + '（列表里 status=' + closed.status + '）');

      await asIdentity(ADMIN_TOKEN, () =>
        api.request('/api/party/' + card.id, {}, { method: 'DELETE' })
      );
      cleanup.partyCreatedId = '';
      const list3 = await api.request('/api/party', null, { method: 'GET' });
      if ((list3.posts || []).some((p) => String(p.id) === String(card.id))) throw new Error('删除后卡片还在');
      ok('已删除自测卡片，列表恢复 ' + (list3.posts || []).length + ' 张');
    }
  } catch (e) {
    bad(e.message);
  } finally {
    // 出错也要把残留清掉，否则生产库里会留下没人认领的测试数据
    if (cleanup.activityId) {
      try {
        await api.request('/api/activities/' + cleanup.activityId, {}, { method: 'DELETE' });
        console.log('  · 已清理残留活动 #' + cleanup.activityId);
      } catch (e) {
        console.log('  ! 残留活动 #' + cleanup.activityId + ' 没删掉，请人工处理: ' + e.message);
        fail++;
      }
    }
    if (cleanup.partyJoined) {
      try {
        await api.request('/api/party/' + cleanup.partyJoined + '/join', {}, { method: 'DELETE' });
        console.log('  · 已清理残留报名（卡片 #' + cleanup.partyJoined + '）');
      } catch (e) {
        console.log('  ! 残留报名没取消: ' + e.message);
        fail++;
      }
    }
    if (cleanup.reviewId && ADMIN_TOKEN) {
      try {
        await asIdentity(ADMIN_TOKEN, () =>
          api.request('/api/food-reviews', { id: cleanup.reviewId }, { method: 'DELETE' })
        );
        console.log('  · 已清理残留评价 #' + cleanup.reviewId);
      } catch (e) {
        console.log('  ! 残留评价 #' + cleanup.reviewId + ' 没删掉，请人工处理: ' + e.message);
        fail++;
      }
    }
    if (cleanup.quoteId && ADMIN_TOKEN) {
      try {
        // 必须用管理员身份：探针账号没绑选手行，删自己的语录也会被 403 挡
        await asIdentity(ADMIN_TOKEN, () =>
          api.request('/api/quotes/' + cleanup.quoteId, {}, { method: 'DELETE' })
        );
        console.log('  · 已清理残留语录 #' + cleanup.quoteId);
      } catch (e) {
        console.log('  ! 残留语录 #' + cleanup.quoteId + ' 没删掉，请人工处理: ' + e.message);
        fail++;
      }
    } else if (cleanup.quoteId) {
      console.log('  ! 残留语录 #' + cleanup.quoteId + ' 没删掉（缺 ADMIN_TOKEN），请人工处理');
      fail++;
    }
    if (cleanup.partyCreatedId && ADMIN_TOKEN) {
      try {
        await asIdentity(ADMIN_TOKEN, () =>
          api.request('/api/party/' + cleanup.partyCreatedId, {}, { method: 'DELETE' })
        );
        console.log('  · 已清理残留自测卡片 #' + cleanup.partyCreatedId);
      } catch (e) {
        console.log('  ! 残留自测卡片 #' + cleanup.partyCreatedId + ' 没删掉，请人工处理: ' + e.message);
        fail++;
      }
    }
  }

  console.log('\n' + (fail ? '❌ ' + fail + ' 项没通过\n' : '✅ 写操作全部通过，且没有残留数据\n'));
  process.exit(fail ? 1 : 0);
})();
