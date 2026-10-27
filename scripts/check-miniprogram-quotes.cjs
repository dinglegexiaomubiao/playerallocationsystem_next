#!/usr/bin/env node
/**
 * 语录打分/评价联调（小程序端）。
 *
 * 评价是**一人一评、可改**（服务端 UNIQUE(quote_id, reviewer_id) + upsert），
 * 所以最容易错的地方不是「能不能提交」，而是「第二次提交会不会变成第二条」——
 * 错了不报错，只是平均分被自己拉偏。这类必须写死断言。
 *
 * 验六件事：
 *   ① 未登录点提交 → 一个字节都不写库（不是「提交后才被拒」）；
 *   ② 展开评价区才发请求，拉过就缓存（不重复请求）；
 *   ③ 提交 4.5 分 + 文字 → 平均分/人数/我的评价三处同步更新；
 *   ④ 再提交 2 分 + 空文字 → 评价条数不变、id 不变（upsert），文字被清空；
 *   ⑤ 非法输入（4.3 分、6 分、超长文字）由接口挡下，返回 400 而不是 500；
 *   ⑥ 删掉自己的评价 → 人数回到基线、平均分回到基线。
 *
 * 用法（写链路需要绑了选手资料的夹具账号）：
 *   node scripts/check-miniprogram-quotes.cjs                  # 只读部分
 *   MP_GA_PASS=Probe2026ga node scripts/check-miniprogram-quotes.cjs
 *
 * 跑完必须 `node _probe-account.cjs down` 撤夹具；本脚本自己会删掉它创建的每一条评价，
 * 结束时再核对一遍条数 == 基线。
 */
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const BASE = process.argv[2] || 'https://dota.playerallocationsystem.online';
const ROOT = path.join(__dirname, '..', 'miniprogram');
const GA = { user: process.env.MP_GA_USER || '_mp_ga', pass: process.env.MP_GA_PASS || '' };

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

async function until(fn, timeoutMs, label) {
  const end = Date.now() + (timeoutMs || 10000);
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(120);
  }
  bad('等待超时：' + (label || '条件未成立'));
  return false;
}

const getReviews = (id) => api.request('/api/quotes/' + id + '/reviews', null, { method: 'GET' });

(async () => {
  console.log('\n[语录打分联调] ' + BASE + '\n');

  // ---------- 挑一条真实语录当靶子 ----------
  const list = await api.request('/api/quotes?offset=0&limit=30', null, { method: 'GET' });
  const quotes = (list && list.quotes) || [];
  if (!quotes.length) throw new Error('没有语录可测');
  // 优先挑「已经有人评过」的，能顺带验平均分摘要；没有再退回第一条
  const target = quotes.filter((q) => Number(q.ratingCount) > 0)[0] || quotes[0];
  const qid = String(target.id);
  const base = await getReviews(qid);
  const baseCount = Number(base.ratingCount) || 0;
  const baseAvg = Number(base.ratingAvg) || 0;
  console.log('  靶子语录 #' + qid + '（' + baseCount + ' 人评，均分 ' + baseAvg + '）\n');

  // ---------- 页面加载（未登录）----------
  console.log('— 列表与评价区（未登录）—');
  const p = loadPage('pages/quotes/quotes.js');
  p.onShow();
  await p.onLoad();
  await until(() => !p.data.loading, 10000, '语录列表加载');
  expect(!p.data.error, '列表加载无报错');
  expect(p.data.groups.length > 0, '按月分组 ' + p.data.groups.length + ' 组');
  expect(p.data.total > 0, '共 ' + p.data.total + ' 条语录');
  expect(p.data.loggedIn === false, '未登录时 loggedIn = false（session 没有 isAdmin()，别调）');
  expect(p.data.scoreLabels.length === 11, '评分档位 11 档（0 ~ 5，半星步进）');
  expect(
    p.data.scoreLabels[0] === '5 分' && p.data.scoreLabels[10] === '0（不打分）',
    '档位从高到低：' + p.data.scoreLabels[0] + ' … ' + p.data.scoreLabels[10]
  );

  // 展开：应该发一次请求，再展开不重复发
  p.toggleReviews({ currentTarget: { dataset: { id: qid } } });
  await until(() => p.data.reviews[qid] && p.data.reviews[qid].loading === false, 10000, '评价区加载');
  const rv = p.data.reviews[qid] || {};
  expect(rv.open === true, '点「评价」展开评价区');
  expect(rv.count === baseCount, '评价人数与接口一致：' + rv.count);
  expect(rv.list.length === baseCount, '评价条数 ' + rv.list.length);
  expect(
    rv.list.every((x) => typeof x.stars === 'string' && x.stars.length === 5),
    '每条评价都有 5 星图（★/☆ 拼串）'
  );
  expect(!!p._loaded[qid], '评价已标记为缓存（再展开不重复请求）');

  // 收起 → 展开，缓存命中
  p.toggleReviews({ currentTarget: { dataset: { id: qid } } });
  expect(p.data.reviews[qid].open === false, '再点一次收起');
  p.toggleReviews({ currentTarget: { dataset: { id: qid } } });
  await wait(200);
  expect(p.data.reviews[qid].open === true, '第三次点又展开（列表没被清空）');

  // 未登录提交：不能写库
  p.onScoreChange({ currentTarget: { dataset: { id: qid } }, detail: { value: '3' } });
  expect(p.data.reviews[qid].scoreIndex === 3 && p.data.reviews[qid].scoreLabel === '3.5 分', '选完分后档位显示 3.5 分');
  p.onComment({ currentTarget: { dataset: { id: qid } }, detail: { value: '未登录不该写进去' } });
  expect(p.data.reviews[qid].commentLen === 8, '字数统计 ' + p.data.reviews[qid].commentLen + '/200');
  p.submitReview({ currentTarget: { dataset: { id: qid } } });
  await wait(1200);
  const afterAnon = await getReviews(qid);
  expect(
    Number(afterAnon.ratingCount) === baseCount && !afterAnon.myReview,
    '未登录点提交：库里一条没多（走的是「去登录」而不是偷偷写入）'
  );

  if (!GA.pass) {
    console.log('\n（没有 MP_GA_PASS，跳过写链路：提交/更新/删除/非法输入）');
    console.log('\n' + (fail ? '✗ ' + fail + ' 项未通过' : '✓ 只读部分全部通过'));
    process.exit(fail ? 1 : 0);
  }

  // ---------- 登录后写链路 ----------
  console.log('\n— 登录后：提交 / 更新 / 删除 —');
  const login = await api.request(
    '/api/login',
    { username: GA.user, password: GA.pass },
    { method: 'POST' }
  );
  if (!login || !login.token) throw new Error('夹具账号登录失败，先跑 up-pair');
  session.setLogin({ token: login.token, name: GA.user, isAdmin: !!login.isAdmin });
  expect(session.isLoggedIn(), '夹具账号登录成功（' + GA.user + '）');

  // 重新载入页面，让 onShow 读到登录态
  const p2 = loadPage('pages/quotes/quotes.js');
  p2.onShow();
  await p2.onLoad();
  await until(() => !p2.data.loading, 10000, '登录后列表加载');
  expect(p2.data.loggedIn === true, '登录后 loggedIn = true');

  p2.toggleReviews({ currentTarget: { dataset: { id: qid } } });
  await until(() => p2.data.reviews[qid] && p2.data.reviews[qid].loading === false, 10000, '登录后评价区加载');
  expect(p2.data.reviews[qid].myId === '', '还没评过时 myId 为空');

  // ① 提交 4.5 分 + 文字
  p2.onScoreChange({ currentTarget: { dataset: { id: qid } }, detail: { value: '1' } }); // 4.5 分
  p2.onComment({ currentTarget: { dataset: { id: qid } }, detail: { value: '_mp 自动测试评价' } });
  toasts.length = 0;
  p2.submitReview({ currentTarget: { dataset: { id: qid } } });
  await until(() => p2.data.reviews[qid].busy === false && !!p2.data.reviews[qid].myId, 12000, '提交评价');
  const after1 = await getReviews(qid);
  expect(Number(after1.ratingCount) === baseCount + 1, '人数 ' + baseCount + ' → ' + after1.ratingCount);
  expect(after1.myReview && Number(after1.myReview.score) === 4.5, '我的评分 4.5');
  expect(after1.myReview && after1.myReview.comment === '_mp 自动测试评价', '评价文字已保存');
  expect(toasts.indexOf('已提交评价') >= 0, '提交后有 toast 反馈');
  const myId = String(after1.myReview.id);
  expect(p2.data.reviews[qid].myId === myId, '页面记住「我的评价」id（按钮切成「更新我的评价」）');
  const row = p2.all.filter((x) => x.id === qid)[0];
  expect(
    !!row && row.ratingCount === Number(after1.ratingCount),
    '列表上的摘要跟着更新（不整页重拉）：' + (row ? row.ratingText : '无')
  );

  // ② 再提交 2 分 + 空文字 → 覆盖，不新增
  p2.onScoreChange({ currentTarget: { dataset: { id: qid } }, detail: { value: '6' } }); // 2 分
  p2.onComment({ currentTarget: { dataset: { id: qid } }, detail: { value: '' } });
  p2.submitReview({ currentTarget: { dataset: { id: qid } } });
  await until(() => p2.data.reviews[qid].busy === false, 12000, '更新评价');
  await wait(400);
  const after2 = await getReviews(qid);
  expect(Number(after2.ratingCount) === baseCount + 1, '第二次提交人数不变（是 upsert 不是追加）：' + after2.ratingCount);
  expect(after2.myReview && String(after2.myReview.id) === myId, '还是同一条评价记录（id 未变）');
  expect(after2.myReview && Number(after2.myReview.score) === 2, '分数已改成 2');
  expect(after2.myReview && after2.myReview.comment === '', '文字被清空（空字符串就是清空）');

  // ③ 非法输入：分数必须被接口挡下（文字超长是**截断**不是报错，见下面单独一条）
  const rejects = [];
  const tryBad = async (body, why) => {
    try {
      await api.request('/api/quotes/' + qid + '/reviews', body, { method: 'POST' });
      rejects.push(why + ' 竟然通过了');
    } catch (e) {
      if (e.statusCode !== 400) rejects.push(why + ' 返回 ' + e.statusCode + '（应该 400）：' + e.message);
    }
  };
  await tryBad({ score: 4.3 }, '4.3 分（不是 0.5 的倍数）');
  await tryBad({ score: 6 }, '6 分（超过上限）');
  await tryBad({ score: -1 }, '-1 分');
  await tryBad({ comment: '没有分数' }, '完全不给分数');
  expect(rejects.length === 0, '非法分数全部被接口以 400 挡下' + (rejects.length ? '：' + rejects.join('；') : ''));
  // 上面几个失败的请求不应该留下第四条
  const afterBad = await getReviews(qid);
  expect(Number(afterBad.ratingCount) === baseCount + 1, '非法请求没写库（人数仍是 ' + afterBad.ratingCount + '）');

  // 文字超长的口径是「截断」而不是「报错」（与网页端 checkInput 一致），必须验清楚：
  // 报错会让用户以为自己写错了，截断则是静默的 —— 静默的行为更要用断言钉住。
  await api.request(
    '/api/quotes/' + qid + '/reviews',
    { score: 2, comment: 'x'.repeat(201) },
    { method: 'POST' }
  );
  const afterLong = await getReviews(qid);
  expect(
    afterLong.myReview && afterLong.myReview.comment.length === 200,
    '201 字评价被截到 200 存下（不是 400，也不是整条丢掉）：' + (afterLong.myReview ? afterLong.myReview.comment.length : '×')
  );

  // ④ 删除自己的评价
  p2.removeMyReview({ currentTarget: { dataset: { id: qid, rid: myId } } });
  await until(() => !p2.data.reviews[qid].myId, 12000, '删除评价');
  await wait(400);
  const afterDel = await getReviews(qid);
  expect(Number(afterDel.ratingCount) === baseCount, '删掉后人数回到基线 ' + baseCount);
  expect(
    Math.abs((Number(afterDel.ratingAvg) || 0) - baseAvg) < 1e-9,
    '平均分回到基线 ' + baseAvg
  );
  expect(!afterDel.myReview, '我的评价已清空（可以重新评）');
  expect(
    !!p2.data.reviews[qid].error === false,
    '删除后评价区没有残留报错：' + (p2.data.reviews[qid].error || '无')
  );

  // ---------- 残留核对 ----------
  console.log('\n— 残留核对 —');
  const final = await getReviews(qid);
  expect(Number(final.ratingCount) === baseCount, '语录 #' + qid + ' 评价数回到基线 ' + baseCount);
  const mine = (final.reviews || []).filter((r) => r.reviewer && r.reviewer.nickname === '_mp_guild_a');
  expect(mine.length === 0, '夹具账号没有留下任何评价');
  if (toasts.indexOf('已删除') < 0) console.log('  · 提示：删除路径的 toast 是「已删除」');

  console.log('\n' + (fail ? '✗ ' + fail + ' 项未通过' : '✓ 全部通过'));
  console.log('记得撤夹具：node _probe-account.cjs down');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nERR ' + e.message);
  if (e.statusCode) console.error('   HTTP ' + e.statusCode);
  process.exit(1);
});
