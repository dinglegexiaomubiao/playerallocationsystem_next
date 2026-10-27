#!/usr/bin/env node
/**
 * 群友名片：近期战绩（OpenDota）+ AI 战力分析 联调。
 *
 * 这一页特殊在**链路长**：/api/player-stats 要连 OpenDota（冷启动几秒），
 * /api/ai-analysis 服务端上限 90 秒、结果缓存 30 分钟。所以断言分三层写：
 *   ① 纯函数层：AI 返回的 markdown 怎么切成块（不联网，跑得快，最该覆盖）；
 *   ② 只读层：页面能拿到 SteamID、未登录点分析不瞎发请求、战绩能拉回来；
 *   ③ 写/花钱层：真调一次 AI（消耗额度），验 blocks 非空 + 第二次命中缓存。
 *
 * 用法：
 *   node scripts/check-miniprogram-ai.cjs                  # 只跑 ① ②
 *   MP_GA_PASS=Probe2026ga node scripts/check-miniprogram-ai.cjs   # 连 ③ 一起
 *
 * 注意：③ 会真实消耗 Anthropic/DeepSeek 额度（一次分析 + 一次缓存命中），
 * 不需要就别传 MP_GA_PASS。本脚本不写库，跑完无需清理。
 */
const path = require('path');
const { createRuntime } = require('./lib/mp-runtime.cjs');

const BASE = process.argv[2] || 'https://dota.playerallocationsystem.online';
const ROOT = path.join(__dirname, '..', 'miniprogram');
const GA = { user: process.env.MP_GA_USER || '_mp_ga', pass: process.env.MP_GA_PASS || '' };

const rt = createRuntime({ baseUrl: BASE, root: ROOT, token: '' });
const { loadPage, wait, toasts, store } = rt;

const api = require(path.join(ROOT, 'utils', 'api.js'));
const session = require(path.join(ROOT, 'utils', 'session.js'));
const aiText = require(path.join(ROOT, 'utils', 'ai-text.js'));

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
    await wait(200);
  }
  bad('等待超时：' + (label || '条件未成立'));
  return false;
}

(async () => {
  console.log('\n[群友名片 · 战绩与 AI 分析] ' + BASE + '\n');

  // ---------- ① 纯函数：markdown → 块 ----------
  console.log('— 文本解析（parseAnalysis）—');
  const sample = [
    '1. 🦸 **英雄池与打法特征**：偏爱先手控，喜欢玩能开团的英雄。',
    '',
    '2. 🛠 **需要注意特殊英雄**：最近用了几把 **修补匠**，胜率一般。',
    '### 补充',
    '- 这条是项目符号',
    '纯文本一行，没有任何标记',
    '**整行加粗**',
    '半截 **未闭合的加粗',
  ].join('\r\n'); // 故意用 CRLF：服务端 JSON 里少见，但复制粘贴的文本会有

  const parsed = aiText.parseAnalysis(sample);
  expect(parsed.blocks.length === 7, '7 行非空内容 → 7 块（空行被丢掉，实际 ' + parsed.blocks.length + '）');
  expect(parsed.items === 2, '识别出 2 个带序号的分析维度（实际 ' + parsed.items + '）');

  const b0 = parsed.blocks[0] || {};
  expect(b0.type === 'item' && b0.num === '1', '首块是序号 1 的条目');
  const b0bold = (b0.segs || []).filter((s) => s.b)[0];
  expect(
    !!b0bold && b0bold.t === '英雄池与打法特征',
    '`**英雄池与打法特征**` 被拆成加粗段（emoji 留在非加粗段）：' + (b0bold ? b0bold.t : '×')
  );
  expect(
    b0.segs.length >= 2 && b0.segs[b0.segs.length - 1].b === false,
    '加粗之后的正文仍是非加粗段'
  );

  // 注意：空行被丢弃，所以第二条是 blocks[1] 而不是 blocks[2]
  const b2 = parsed.blocks[1] || {};
  expect(b2.type === 'item' && b2.num === '2', '第二块是序号 2 的条目');
  expect(
    (b2.segs || []).filter((s) => s.b).length === 2,
    '一行里两处加粗都识别到（标题 + 修补匠）'
  );

  const h = parsed.blocks.filter((x) => x.type === 'h')[0];
  expect(!!h && h.segs[0].t === '补充', '`### 补充` 识别成小标题');
  const bullet = parsed.blocks.filter((x) => x.bullet)[0];
  expect(!!bullet && bullet.segs[0].t === '这条是项目符号', '`- 项目符号` 识别成列表项');
  const plain = parsed.blocks.filter((x) => x.type === 'p' && !x.bullet && x.segs.length === 1)[0];
  expect(!!plain, '无标记的一行原样保留');

  const unclosed = parsed.blocks.filter((x) => (x.segs || []).some((s) => s.t.indexOf('未闭合') >= 0))[0];
  expect(!!unclosed, '未闭合的 `**` 不会吞掉整段文本（照原样显示）');

  expect(aiText.parseAnalysis('').blocks.length === 0, '空文本 → 0 块（不渲染空壳）');
  expect(aiText.parseAnalysis(null).blocks.length === 0, 'null → 0 块（不抛异常）');
  const allSegsHaveKey = parsed.blocks.every(
    (b) => typeof b.k === 'number' && b.segs.every((s) => typeof s.k === 'number')
  );
  expect(allSegsHaveKey, '每块/每段都有 k 字段（WXML 的 wx:key 只认字段名）');

  // ---------- ② 只读：页面与战绩 ----------
  console.log('\n— 页面与近期战绩 —');
  const res = await api.request('/api/players', null, { method: 'GET' });
  const players = (res && res.players) || [];
  if (!players.length) throw new Error('/api/players 没数据');

  const withSteam = players
    .filter((p) => p.game_id && String(p.game_id).trim())
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const noSteam = players.filter((p) => !p.game_id || !String(p.game_id).trim());
  const target = withSteam[0];
  if (!target) throw new Error('没有填了 SteamID 的群友，无法测战绩');
  console.log('  靶子：' + target.nickname + '（' + target.score + ' 分，Steam ' + target.game_id + '）');

  const p = loadPage('pages/member/member.js');
  p.onLoad({ id: String(target.id) });
  p.onShow();
  await until(() => !p.data.loading, 15000, '名片加载');
  expect(!p.data.error, '名片加载无报错');
  expect(p.data.gameId === String(target.game_id), '拿到 SteamID：' + p.data.gameId);
  expect(p.data.stats.status === 'idle', '战绩默认不自动拉（点按钮才花几秒）');
  expect(p.data.ai.status === 'idle', 'AI 默认不自动跑（不白烧额度）');
  expect(p.data.loggedIn === false, '未登录时 loggedIn = false');

  // 未登录点 AI：只提示 + 跳登录，不发请求
  toasts.length = 0;
  p.onTapAI();
  await wait(300);
  expect(p.data.ai.status === 'idle', '未登录点「开始分析」不会进入 loading（不发请求）');
  expect(toasts.indexOf('登录后才能用 AI 分析') >= 0, '给出「登录后才能用 AI 分析」提示');

  // 没有 SteamID 的群友
  if (noSteam.length) {
    const pn = loadPage('pages/member/member.js');
    pn.onLoad({ id: String(noSteam[0].id) });
    pn.onShow();
    await until(() => !pn.data.loading, 15000, '无 SteamID 名片加载');
    expect(pn.data.gameId === '', '没填 SteamID 的群友 gameId 为空（页面显示提示而不是空白）');
    toasts.length = 0;
    pn.onTapAI();
    await wait(200);
    expect(toasts.indexOf('这位群友没填 SteamID') >= 0, '点分析提示缺 SteamID，不发请求');
  } else {
    console.log('  · 所有群友都填了 SteamID，跳过「无 SteamID」分支');
  }

  // 真拉一次战绩（OpenDota，冷启动几秒）
  const t0 = Date.now();
  let statsOk = true;
  await p.loadStats().catch((e) => {
    statsOk = false;
    bad('战绩拉取失败：' + (e && e.message));
  });
  if (statsOk) {
    const s = p.data.stats.data || {};
    ok('战绩拉回来了（耗时 ' + Math.round((Date.now() - t0) / 1000) + 's）');
    expect(p.data.stats.status === 'loaded', '状态 = loaded');
    expect(typeof s.total === 'number' && s.total >= 0, '近 N 场：' + s.total);
    expect(typeof s.winRate === 'number' && s.winRate >= 0 && s.winRate <= 100, '胜率 ' + s.winRate + '%');
    expect(typeof s.gpm === 'number', '场均 GPM ' + s.gpm);
    expect(typeof s.kda === 'string' || typeof s.kda === 'number', '场均 KDA ' + s.kda);
    expect(Array.isArray(s.heroes) && s.heroes.length <= 5, '常用英雄最多 5 个（实际 ' + s.heroes.length + '）');
    expect(!('recentMatches' in s), '只保留页面要显示的字段（没把几十场明细塞进 setData）');
  }

  // 未登录直接打 AI 接口 → 必须被拦住
  let anonStatus = 0;
  try {
    await api.request('/api/ai-analysis', { type: 'player', data: {} }, { method: 'POST' });
  } catch (e) {
    anonStatus = e.statusCode || 0;
  }
  expect(anonStatus === 401 || anonStatus === 403, '未登录直接调 AI 接口被拒（' + anonStatus + '）');

  if (!GA.pass) {
    console.log('\n（没有 MP_GA_PASS，跳过真调 AI：会消耗额度）');
    console.log('\n' + (fail ? '✗ ' + fail + ' 项未通过' : '✓ 只读部分全部通过'));
    process.exit(fail ? 1 : 0);
  }

  // ---------- ③ 真调 AI ----------
  console.log('\n— 真调 AI 分析（会消耗额度）—');
  const login = await api.request('/api/login', { username: GA.user, password: GA.pass }, { method: 'POST' });
  if (!login || !login.token) throw new Error('夹具账号登录失败，先跑 up-pair');
  session.setLogin({ token: login.token, name: GA.user, isAdmin: !!login.isAdmin });

  const p2 = loadPage('pages/member/member.js');
  p2.onLoad({ id: String(target.id) });
  p2.onShow();
  await until(() => !p2.data.loading, 15000, '登录后名片加载');
  expect(p2.data.loggedIn === true, '登录后 loggedIn = true');

  const t1 = Date.now();
  p2.onTapAI();
  await until(
    () => p2.data.ai.status === 'done' || p2.data.ai.status === 'error',
    150000,
    'AI 分析返回'
  );
  const cost = Math.round((Date.now() - t1) / 1000);

  if (p2.data.ai.status === 'error') {
    bad('AI 分析失败：' + p2.data.ai.error);
    console.log('     ↑ 若提示「暂未配置」，检查服务器 .env.local 的 ANTHROPIC_API_KEY');
    console.log('     ↑ 若提示超时，说明服务端 90 秒也没算完/额度不足，属后端问题，不是页面问题');
  } else {
    const a = p2.data.ai;
    ok('AI 返回并渲染完成（' + cost + 's，' + a.blocks.length + ' 块）');
    expect(a.blocks.length >= 3, '拆出 ' + a.blocks.length + ' 块内容');
    expect(a.items >= 1, '识别出 ' + a.items + ' 个分析维度');
    expect(
      a.blocks.every((b) => b.segs && b.segs.length > 0),
      '每块都有文本段（没有空壳块）'
    );
    const chars = a.blocks.reduce((n, b) => n + b.segs.reduce((m, s) => m + s.t.length, 0), 0);
    expect(chars > 100, '正文共 ' + chars + ' 字（不是一句话敷衍）');
    expect(
      a.blocks.some((b) => b.segs.some((s) => s.b)),
      '至少有一处加粗（说明 markdown 解析真的用上了）'
    );
    const cache = store.get('aiAnalysisCache') || {};
    expect(!!cache['player_' + String(target.id)], '结果写进了本地缓存（再次进入秒开）');

    // 第二次：服务端 30 分钟缓存，应该很快且标 cached
    const t2 = Date.now();
    p2.rerunAI();
    await until(
      () => p2.data.ai.status === 'done' || p2.data.ai.status === 'error',
      60000,
      '重新分析返回'
    );
    const cost2 = Math.round((Date.now() - t2) / 1000);
    expect(p2.data.ai.status === 'done', '重新分析成功');
    expect(p2.data.ai.cached === true, '第二次命中服务端缓存（cached=true）');
    expect(cost2 < 20, '第二次耗时 ' + cost2 + 's（明显快于首次 ' + cost + 's）');
  }

  console.log('\n' + (fail ? '✗ ' + fail + ' 项未通过' : '✓ 全部通过'));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\nERR ' + e.message);
  if (e.statusCode) console.error('   HTTP ' + e.statusCode);
  process.exit(1);
});
