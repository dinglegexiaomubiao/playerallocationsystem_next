/**
 * 群友回忆自检（/memories 页 + /api/memories + 照片落盘 + 后台删除）。
 *
 * 三层断言：
 *   ① 静态：页面/组件/接口/样式/导航/更新日志/deploy 排除项是否齐全；
 *   ② 纯函数：路径白名单（这是唯一挡越权读文件的地方，必须单独测）、相对时间、网格档位；
 *   ③ 链路：真上传一张 PNG → 建回忆 → 取图 → 评论 → 删评论 → 删回忆 → 列表里消失。
 *
 * 用法：
 *   node scripts/check-memories.cjs                      # 本地 3006（默认写库，跑完硬删）
 *   BASE=https://dota.playerallocationsystem.online COOKIE='dd_session=...' node scripts/check-memories.cjs
 *
 * ⚠ 本地 3006 连的是**线上库**（SSH 隧道），所以脚本结尾会用 SQL 把测试行物理删掉，
 *   不在库里留垃圾；照片文件落在 .uploads/ 下，测试后也一并清。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadEnvConfig } = require('@next/env');

loadEnvConfig(process.cwd(), false);

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
const IS_LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE);

// 1x1 的 PNG，够用来验「文件头认得出 + 能落盘 + 能取回」
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let pass = 0;
let fail = 0;
const ok = (cond, label, extra) => {
  if (cond) {
    pass++;
    console.log('  ok   ' + label + (extra ? '（' + extra + '）' : ''));
  } else {
    fail++;
    console.log('  FAIL ' + label + (extra ? '（' + extra + '）' : ''));
  }
};

const read = (p) => {
  try {
    return fs.readFileSync(path.join(process.cwd(), p), 'utf8');
  } catch {
    return '';
  }
};
const exists = (p) => fs.existsSync(path.join(process.cwd(), p));

const cookie = () => {
  if (process.env.COOKIE) return process.env.COOKIE;
  if (!IS_LOCAL) return '';
  const name = String(process.env.ADMIN_NAMES || 'dom').split(',')[0].trim();
  const secret = crypto.createHash('sha256').update(String(process.env.AUTH_SECRET || 'x')).digest();
  const payload = Buffer.from(JSON.stringify({ n: name, t: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `dd_session=${payload}.${sig}`;
};

const call = async (url, opts = {}) => {
  const res = await fetch(BASE + url, {
    method: opts.method || 'GET',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, headers: res.headers, text };
};

(async () => {
  /* ---------------- ① 静态 ---------------- */
  console.log('\n[静态 · 文件与接线]');
  const files = [
    'lib/memories.mjs',
    'lib/memory-store.mjs',
    'lib/memories-view.mjs',
    'lib/image-compress.mjs',
    'pages/api/memories/index.js',
    'pages/api/memories/upload.js',
    'pages/api/memories/[id]/index.js',
    'pages/api/memories/[id]/comments.js',
    'pages/api/memories/[id]/comments/[cid].js',
    'pages/api/media/[...path].js',
    'pages/api/admin/memories.js',
    'pages/memories/index.js',
    'pages/admin/memories.js',
    'components/MemoryComposer.js',
    'components/MemoryItem.js',
    'styles/memories.css',
  ];
  const missing = files.filter((f) => !exists(f));
  ok(missing.length === 0, '17 个文件都在', missing.length ? '缺 ' + missing.join(', ') : '');

  ok(read('components/Layout.js').includes("href: '/memories'"), '主导航有「群友回忆」');
  ok(
    read('components/admin/AdminShell.js').includes("href: '/admin/memories'"),
    '后台导航有「回忆」'
  );
  ok(read('pages/_app.js').includes("styles/memories.css"), '_app.js 引入了 memories.css');
  ok(read('deploy/deploy.sh').includes('--exclude=.uploads'), '部署包排除了 .uploads');
  ok(read('.gitignore').includes('.uploads/'), '.gitignore 忽略了 .uploads');

  const cl = read('lib/changelog.js');
  ok(cl.includes("version: '1.15.0'"), '更新日志有 1.15.0');
  const block = cl.slice(cl.indexOf("version: '1.15.0'"), cl.indexOf("version: '1.14.1'"));
  ok(block.includes('adminOnly: true'), '后台条目标了 adminOnly（不给普通群友看）');

  // 页面里不能再包 Layout（会渲染两个 header）。判 import 而不是找字符串，
  // 因为文件注释里就写着「不要包 <Layout>」，按字符串判会自己把自己绊倒。
  ok(!/import\s+Layout\s+from/.test(read('pages/memories/index.js')), 'memories 页没有再包 <Layout>');

  /* ---------------- ② 纯函数 ---------------- */
  console.log('\n[纯函数 · 路径白名单与展示逻辑]');
  const mem = await import('../lib/memories.mjs');
  const view = await import('../lib/memories-view.mjs');

  ok(mem.isPhotoPath('memories/2026/10/abcdef12-3456-7890-abcd-ef1234567890.jpg'), '正常路径通过');
  const bad = [
    'memories/../../etc/passwd',
    '/etc/passwd',
    'memories/2026/10/../../secret.png',
    'memories/2026/10/x.php',
    'memories/2026/10/abcdef12.svg',
    'memories/2026/10/abc.jpg',
    'https://evil.com/a.jpg',
    '',
    null,
  ];
  const leaks = bad.filter((p) => mem.isPhotoPath(p));
  ok(leaks.length === 0, '9 种越权/非法路径全部拒绝', leaks.join(', '));
  ok(mem.photoUrl('memories/2026/10/abcdef12-3456-7890-abcd-ef1234567890.png') ===
    '/api/media/memories/2026/10/abcdef12-3456-7890-abcd-ef1234567890.png', 'photoUrl 拼接正确');
  ok(mem.photoUrl('/etc/passwd') === '', 'photoUrl 对非法路径返回空');

  ok(view.relTime(new Date(Date.now() - 30e3).toISOString()) === '刚刚', 'relTime 30 秒前 = 刚刚');
  ok(view.relTime(new Date(Date.now() - 3 * 3600e3).toISOString()) === '3 小时前', 'relTime 3 小时前');
  ok(view.gridClass(1) === 'mem-grid mem-grid-1', 'gridClass 1 张');
  ok(view.gridClass(2) === 'mem-grid mem-grid-2', 'gridClass 2 张');
  ok(view.gridClass(9) === 'mem-grid mem-grid-3', 'gridClass 9 张走九宫格');
  ok(view.aspectOf(1600, 900) === '1600 / 900', 'aspectOf 生成占位比例');
  ok(view.aspectOf(0, 0) === null, 'aspectOf 缺尺寸时返回 null（不写非法 CSS）');

  /* ---------------- ③ 链路 ---------------- */
  const ck = cookie();
  console.log('\n[链路 · ' + BASE + ']');
  if (!ck) {
    console.log('  skip 没有 cookie（远端请用 COOKIE=... 传入，或本地跑）');
  } else {
    const list0 = await call('/api/memories');
    ok(list0.status === 200 && list0.json && list0.json.success, 'GET /api/memories 200');

    const anon = await call('/api/memories', { method: 'POST', body: { content: 'x' } });
    ok(anon.status === 401, '未登录发布被拒（401）', 'status=' + anon.status);

    const badUp = await call('/api/memories/upload', {
      method: 'POST',
      cookie: ck,
      body: { data: 'data:image/png;base64,aGVsbG8=' },
    });
    ok(badUp.status === 400, '非图片被文件头拦下（400）', (badUp.json && badUp.json.error) || '');

    const up = await call('/api/memories/upload', {
      method: 'POST',
      cookie: ck,
      body: { data: 'data:image/png;base64,' + PNG },
    });
    ok(up.status === 201 && up.json && up.json.success && up.json.p, '上传成功并返回相对路径');
    const p = up.json && up.json.p;

    const badPath = await call('/api/memories', {
      method: 'POST',
      cookie: ck,
      body: { content: '越权', photos: [{ p: '../../package.json' }] },
    });
    ok(badPath.status === 400, '发布时带非法照片路径被拒（400）');

    const created = await call('/api/memories', {
      method: 'POST',
      cookie: ck,
      body: { content: '自检：这是一条测试回忆\n第二行', photos: [{ p, w: 1, h: 1 }] },
    });
    ok(created.status === 201 && created.json && created.json.memory, '发布成功');
    const mid = created.json && created.json.memory && created.json.memory.id;
    ok(
      created.json &&
        created.json.memory &&
        created.json.memory.photos[0].url === '/api/media/' + p,
      '返回体里的照片 URL 由 photoUrl 统一拼接'
    );

    const media = await call('/api/media/' + p);
    ok(media.status === 200, '照片可读（200）');
    ok(
      String(media.headers.get('cache-control') || '').includes('immutable'),
      '照片带 immutable 长缓存'
    );

    const trav = await call('/api/media/..%2f..%2fpackage.json');
    ok(trav.status === 404, '路径穿越被拒（404）');

    const c1 = await call(`/api/memories/${mid}/comments`, {
      method: 'POST',
      cookie: ck,
      body: { content: '自检评论' },
    });
    ok(c1.status === 201 && c1.json && c1.json.comment, '评论成功');
    const cid = c1.json && c1.json.comment && c1.json.comment.id;

    const cList = await call(`/api/memories/${mid}/comments`);
    ok(cList.status === 200 && cList.json && cList.json.comments.length === 1, '评论列表读到 1 条');

    const cDel = await call(`/api/memories/${mid}/comments/${cid}`, { method: 'DELETE', cookie: ck });
    ok(cDel.status === 200, '删自己评论成功');

    /* 改文案：本人能改、能清空，未登录 / 超长 / 非字符串 / 不存在的 id 都要拦住。
       「别人改不了（403）」测不了 —— 脚本只有一个账号，越权那条只能靠代码评审。 */
    const edit = await call(`/api/memories/${mid}`, {
      method: 'PATCH',
      cookie: ck,
      body: { content: '自检：改过的文案' },
    });
    ok(
      edit.status === 200 && edit.json && edit.json.memory && edit.json.memory.content === '自检：改过的文案',
      '改文案成功并返回新内容',
      'status=' + edit.status
    );

    const cleared = await call(`/api/memories/${mid}`, {
      method: 'PATCH',
      cookie: ck,
      body: { content: '   ' },
    });
    ok(
      cleared.status === 200 && cleared.json && cleared.json.memory.content === '',
      '清空文案被允许（照片还在）',
      'status=' + cleared.status
    );

    const anonEdit = await call(`/api/memories/${mid}`, { method: 'PATCH', body: { content: 'x' } });
    ok(anonEdit.status === 401, '未登录改文案被拒（401）', 'status=' + anonEdit.status);

    const longEdit = await call(`/api/memories/${mid}`, {
      method: 'PATCH',
      cookie: ck,
      body: { content: 'x'.repeat(900) },
    });
    ok(
      longEdit.status === 200 &&
        longEdit.json &&
        longEdit.json.memory &&
        [...longEdit.json.memory.content].length === 800,
      '超过 800 字被截到 800（站内统一策略，不报错）',
      'status=' + longEdit.status
    );

    const badEdit = await call(`/api/memories/${mid}`, {
      method: 'PATCH',
      cookie: ck,
      body: { content: 123 },
    });
    ok(badEdit.status === 400, '非字符串 content 被拒（400）', 'status=' + badEdit.status);

    const noSuch = await call('/api/memories/99999999', {
      method: 'PATCH',
      cookie: ck,
      body: { content: 'x' },
    });
    ok(noSuch.status === 404, '改不存在的回忆 404', 'status=' + noSuch.status);

    const mDel = await call(`/api/memories/${mid}`, { method: 'DELETE', cookie: ck });
    ok(mDel.status === 200, '删自己回忆成功');

    const list1 = await call('/api/memories');
    const stillThere =
      list1.json && (list1.json.memories || []).some((m) => String(m.id) === String(mid));
    ok(!stillThere, '列表里已经看不到（软删生效）');

    // 站务收尾：物理删掉测试行，库里不留垃圾
    if (IS_LOCAL) {
      try {
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
        await pool.query('DELETE FROM memory_comments WHERE memory_id = $1', [mid]);
        await pool.query('DELETE FROM memories WHERE id = $1', [mid]);
        await pool.end();
        // 本地上传目录里的测试图也删掉
        const abs = path.join(process.cwd(), '.uploads', p || '');
        if (p && fs.existsSync(abs)) fs.unlinkSync(abs);
        console.log('  clean 测试行与测试图已物理删除');
      } catch (e) {
        console.log('  warn 清理失败（不影响结论）：' + e.message);
      }
    }
  }

  console.log(`\n结果：${fail === 0 ? '全部通过' : fail + ' 项失败'}（通过 ${pass}）`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('脚本异常：', e);
  process.exit(1);
});
