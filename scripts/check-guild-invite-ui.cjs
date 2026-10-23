// 邀请流程的界面测试：帮主发邀请 → 选择器 → 被邀请人进站弹窗 → 同意
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
const THEME = process.env.THEME || 'light';
const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
const env = {};
for (const l of envFile.split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const SECRET = crypto
  .createHash('sha256')
  .update(String(env.AUTH_SECRET || env.DATABASE_URL || 'dota2-community-local-dev'))
  .digest();
const sign = (name) => {
  const p = Buffer.from(JSON.stringify({ n: name, t: Date.now() })).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
};

const A = 'dom';
const B = '04';
const pool = new Pool({ connectionString: env.DATABASE_URL });

let pass = 0;
let fail = 0;
const ok = (c, label, detail = '') => {
  if (c) {
    pass++;
    console.log('  ok   ' + label + (detail ? '  (' + detail + ')' : ''));
  } else {
    fail++;
    console.log('  FAIL ' + label + (detail ? '  (' + detail + ')' : ''));
  }
};

const api = async (who, method, p, body) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { cookie: 'dd_session=' + sign(who), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, d: await r.json().catch(() => ({})) };
};

(async () => {
  const pid = async (a) => {
    const r = await pool.query('SELECT player_id FROM public.play_score WHERE name=$1', [a]);
    return Number(r.rows[0].player_id);
  };
  console.log('>>> 取账号完成');
  const [aId, bId] = await Promise.all([pid(A), pid(B)]);

  const clean = () =>
    pool.query(
      `DELETE FROM public.guilds
        WHERE leader_player_id = ANY($1::bigint[])
           OR id IN (SELECT guild_id FROM public.guild_members WHERE player_id = ANY($1::bigint[]))`,
      [[aId, bId]]
    );
  await clean();

  console.log('>>> 准备建帮');
  const created = await api(A, 'POST', '/api/guild', { name: '界面测试帮', slogan: '今晚谁来守高地', colorKey: 'sea' });
  if (!created.d.success) throw new Error('建帮失败: ' + created.d.error);

  const browser = await chromium.launch();

  // ---------- 帮主：打开管理 → 邀请成员 ----------
  console.log('>>> 浏览器已启动');
  const actx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
  await actx.addCookies([{ name: 'dd_session', value: sign(A), domain: '127.0.0.1', path: '/', httpOnly: true }]);
  const ap = await actx.newPage();
  const aErrors = [];
  ap.on('console', (m) => m.type() === 'error' && aErrors.push(m.text()));
  ap.on('pageerror', (e) => aErrors.push('pageerror: ' + e.message));

  console.log('>>> 打开 /profile');
  await ap.goto(BASE + '/profile', { waitUntil: 'networkidle', timeout: 60000 });
  await ap.waitForSelector('.guild-block', { timeout: 20000 });
  await ap.waitForTimeout(600);

  await ap.locator('.guild-block .btn').filter({ hasText: '帮派管理' }).click();
  await ap.waitForSelector('.guild-modal', { timeout: 10000 });
  await ap.waitForTimeout(300);

  console.log('>>> 管理弹窗已开');
  const inviteBtn = ap.locator('.guild-members-head .btn').filter({ hasText: '邀请成员' });
  ok((await inviteBtn.count()) === 1, '成员区右上角有「邀请成员」按钮');
  await inviteBtn.click();
  await ap.waitForSelector('.guild-picker', { timeout: 10000 });
  await ap.waitForTimeout(600);
  ok(true, '选择器打开');

  console.log('>>> 选择器已开');
  const totalRows = await ap.locator('.guild-picker-row').count();
  ok(totalRows > 100, '列出了全部群友', totalRows + ' 行');
  ok((await ap.locator('.guild-picker .filter-bar').count()) === 1, '选择器里有筛选栏（复用）');

  // 搜索 B 的昵称
  const bNick = (await pool.query('SELECT nickname FROM public.players WHERE id=$1', [bId])).rows[0].nickname;
  await ap.locator('.guild-picker .filter-search input').fill(bNick);
  await ap.waitForTimeout(500);
  const afterFilter = await ap.locator('.guild-picker-row').count();
  ok(afterFilter >= 1 && afterFilter < totalRows, '搜索能筛出目标', `${totalRows} → ${afterFilter}`);

  // 点「邀请」→ 填邀请语
  //
  // ⚠ 必须按昵称精确找到那一行。搜索「04」会命中 6 个人（昵称里带 04 的），
  //    点第一行等于随便邀了个人，后面的「被邀请人应该收到弹窗」自然不成立。
  const rows = ap.locator('.guild-picker-row');
  const rowCount = await rows.count();
  let targetIdx = -1;
  for (let i = 0; i < rowCount; i++) {
    const nm = ((await rows.nth(i).locator('.guild-picker-name').textContent().catch(() => '')) || '').trim();
    if (nm === bNick) { targetIdx = i; break; }
  }
  ok(targetIdx >= 0, '搜索后能找到被邀请人那一行', '第 ' + (targetIdx + 1) + ' 行 / ' + rowCount);
  await rows.nth(targetIdx).locator('.btn').filter({ hasText: '邀请' }).click();
  await ap.waitForSelector('.guild-picker-draft input', { timeout: 5000 });
  ok(true, '点邀请后出现邀请语输入框');
  await ap.locator('.guild-picker-draft input').fill('来一起守高地，缺个四号位');
  await ap.waitForTimeout(200);
  await ap.locator('.guild-picker-draft .btn-primary').click();
  await ap.waitForTimeout(1500);

  const stateText = ((await ap.locator('.guild-picker-state').first().textContent().catch(() => '')) || '').trim();
  ok(/已邀请/.test(stateText), '发送后该行变「已邀请」', stateText);
  await ap.screenshot({ path: 'shots/guild-picker-' + THEME + '.png' });

  await ap.locator('.guild-picker .modal-close').click();
  await ap.locator('.guild-modal .modal-close').click();
  await ap.waitForTimeout(300);

  // ---------- 被邀请人：进站弹窗 ----------
  const bctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await bctx.addCookies([{ name: 'dd_session', value: sign(B), domain: '127.0.0.1', path: '/', httpOnly: true }]);
  const bp = await bctx.newPage();
  const bErrors = [];
  bp.on('console', (m) => m.type() === 'error' && bErrors.push(m.text()));
  bp.on('pageerror', (e) => bErrors.push('pageerror: ' + e.message));

  await bp.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await bp.waitForTimeout(2600);

  const promptOpen = await bp.locator('.guild-invite-card').count();
  ok(promptOpen === 1, '被邀请人进站自动弹出邀请');

  if (promptOpen) {
    const gname = ((await bp.locator('.guild-invite-guild').first().textContent()) || '').trim();
    const from = ((await bp.locator('.guild-invite-from').first().textContent()) || '').trim();
    const quote = ((await bp.locator('.guild-invite-msg').first().textContent()) || '').trim();
    ok(gname === '界面测试帮', '弹窗显示帮派名', gname);
    ok(/dom/.test(from), '弹窗显示帮主', from);
    ok(/四号位/.test(quote), '弹窗显示邀请语', quote);
    await bp.screenshot({ path: 'shots/guild-invite-prompt-' + THEME + '.png' });

    // 刷新：不应该再弹（同一条只弹一次）
    await bp.reload({ waitUntil: 'networkidle' });
    await bp.waitForTimeout(1500);
    ok((await bp.locator('.guild-invite-card').count()) === 0, '刷新后不再重复弹');

    // 去个人信息页处理
    await bp.goto(BASE + '/profile', { waitUntil: 'networkidle', timeout: 60000 });
    await bp.waitForSelector('.guild-block', { timeout: 20000 });
    await bp.waitForTimeout(700);
    const rows = await bp.locator('.guild-invite-row').count();
    ok(rows === 1, '个人信息页列出待处理邀请', rows + ' 条');
    await bp.locator('.guild-block').screenshot({ path: 'shots/guild-invite-panel-' + THEME + '.png' });

    await bp.locator('.guild-invite-actions .btn-primary').first().click();
    await bp.waitForTimeout(1800);
    const joined = ((await bp.locator('.guild-mini-name').first().textContent().catch(() => '')) || '').trim();
    ok(joined === '界面测试帮', '同意后区块显示帮派', joined);
    ok((await bp.locator('.guild-invite-row').count()) === 0, '邀请列表已清空');
  }

  // 帮主那边成员数应变成 2
  const after = await api(A, 'GET', '/api/guild');
  ok(after.d.guild.memberCount === 2, '帮主视角成员数变 2', String(after.d.guild.memberCount));

  // 头像走 /api/avatar 代理拉 Steam，偶发 502 与帮派无关，别让它把断言带红
  const allErrors = [...aErrors, ...bErrors];
  const realErrors = allErrors.filter((t) => !/Failed to load resource|502/.test(t));
  console.log('\nconsole 错误: 共 ' + allErrors.length + ' 条，其中与功能相关的 ' + realErrors.length + ' 条', realErrors.slice(0, 3));
  ok(realErrors.length === 0, '无与功能相关的 console 报错');

  await browser.close();
  await clean();
  console.log('\n已清理测试数据');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})()
  .catch(async (e) => {
    console.error('ERR', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
