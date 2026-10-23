/**
 * 帮派创建与管理的界面自检（个人信息页 → 创建弹窗 → 创建成功 → 管理弹窗）。
 *
 * 覆盖的是「接口测不到」的部分：字数实时显示、配色占用置灰、自己用的色不被置灰、
 * 解散要输入帮派名才允许、成员行按角色显示不同按钮。
 *
 * ⚠ 会写数据库（建一个测试帮派，最后解散）。只允许打本地，除非 ALLOW_REMOTE=1。
 *
 * 用法：
 *   BASE=http://127.0.0.1:3006 node scripts/check-guild-ui.cjs
 *   THEME=dark BASE=... node scripts/check-guild-ui.cjs
 */
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE) && process.env.ALLOW_REMOTE !== '1') {
  console.error('✗ 这个脚本会创建并解散一个帮派，只允许打本地。远端请显式加 ALLOW_REMOTE=1。');
  process.exit(1);
}
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
const ACCOUNT = process.env.AS_NAME || 'dom';
const payload = Buffer.from(JSON.stringify({ n: ACCOUNT, t: Date.now() })).toString('base64url');
const token = payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

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

(async () => {
  // 先确保干净
  await fetch(BASE + '/api/guild', { method: 'DELETE', headers: { cookie: 'dd_session=' + token } });

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'dd_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true }]);
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  if (THEME === 'dark') {
    await p.addInitScript(() => {
      try {
        localStorage.setItem('laroja-theme', 'dark');
      } catch (e) {}
    });
  }

  await p.goto(BASE + '/profile', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('.guild-block', { timeout: 20000 });
  await p.waitForTimeout(700);

  // ---- 1. 区块初始状态 ----
  const hasBlock = await p.locator('.guild-block').count();
  ok(hasBlock === 1, '基本信息里有帮派区块');
  const label = ((await p.locator('.guild-block-label').first().textContent()) || '').trim();
  ok(label === '帮派', '区块标题是「帮派」', label);
  const createBtn = p.locator('.guild-create-btn').first();
  ok(await createBtn.count() === 1, '有「创建帮派」按钮');
  ok(await createBtn.isEnabled(), '按钮可用（已绑定选手）');

  // ---- 2. 打开创建弹窗 ----
  await createBtn.click();
  await p.waitForSelector('.guild-modal', { timeout: 10000 });
  ok(true, '弹窗打开');
  const colors = await p.locator('.guild-color').count();
  ok(colors === 12, '12 个色块', colors + ' 个');
  const disabledColors = await p.locator('.guild-color:disabled').count();
  ok(disabledColors === 0, '没有人建帮时 12 支都可选', disabledColors + ' 支被占用');
  ok(await p.locator('#guild-name').count() === 1, '有名称输入框');
  ok(await p.locator('#guild-slogan').count() === 1, '有口号输入框');
  const lenHint = ((await p.locator('.guild-len').first().textContent()) || '').trim();
  ok(/^\d+\/12$/.test(lenHint), '名称有字数显示', lenHint);

  // ---- 3. 校验反馈 ----
  await p.locator('#guild-name').fill('单');
  await p.locator('.guild-modal-actions .btn-primary').click();
  await p.waitForTimeout(400);
  const err1 = ((await p.locator('.guild-msg.is-error').first().textContent().catch(() => '')) || '').trim();
  ok(/至少 2 个字/.test(err1), '名字太短有提示', err1);

  // ---- 4. 填写并创建 ----
  await p.locator('#guild-name').fill('守高地小队');
  await p.locator('.guild-color').nth(3).click(); // 青碧 teal
  await p.locator('#guild-slogan').fill('今晚谁来守高地');
  await p.waitForTimeout(200);
  const lenHint2 = ((await p.locator('.guild-len').first().textContent()) || '').trim();
  ok(lenHint2 === '5/12', '字数实时更新', lenHint2);

  await p.locator('.guild-modal-actions .btn-primary').click();
  await p.waitForTimeout(1800);

  ok(await p.locator('.guild-modal').count() === 0, '创建成功后弹窗关闭');
  const miniName = ((await p.locator('.guild-mini-name').first().textContent().catch(() => '')) || '').trim();
  ok(miniName === '守高地小队', '区块显示帮派名', miniName);
  const role = ((await p.locator('.guild-mini .guild-role').first().textContent().catch(() => '')) || '').trim();
  ok(role === '帮主', '身份是帮主', role);
  const slogan = ((await p.locator('.guild-mini-slogan').first().textContent().catch(() => '')) || '').trim();
  ok(/今晚谁来守高地/.test(slogan), '显示口号', slogan);
  ok(await p.locator('.guild-block .btn').filter({ hasText: '帮派管理' }).count() === 1, '出现「帮派管理」按钮');

  await p.locator('.guild-block').screenshot({ path: 'shots/guild-panel-' + THEME + '.png' });

  // ---- 5. 管理弹窗 ----
  await p.locator('.guild-block .btn').filter({ hasText: '帮派管理' }).click();
  await p.waitForSelector('.guild-modal', { timeout: 10000 });
  ok(true, '管理弹窗打开');
  const memberRows = await p.locator('.guild-member-row').count();
  ok(memberRows === 1, '成员列表 1 行', memberRows + ' 行');
  const memberRole = ((await p.locator('.guild-member-row .guild-role').first().textContent()) || '').trim();
  ok(memberRole === '帮主', '成员行标了帮主', memberRole);
  ok(await p.locator('.guild-dissolve-btn').count() === 1, '有「解散帮派」按钮');
  // 当前配色不该被自己占用而置灰
  const disabled2 = await p.locator('.guild-color:disabled').count();
  ok(disabled2 === 0, '自己用的配色不被置灰（仍可切换）', disabled2 + ' 支禁用');
  const onColor = ((await p.locator('.guild-color.is-on .guild-color-name').first().textContent()) || '').trim();
  ok(onColor === '青碧', '当前配色高亮', onColor);

  await p.screenshot({ path: 'shots/guild-modal-' + THEME + '.png' });

  // ---- 6. 解散的二次确认要输对名字 ----
  await p.locator('.guild-dissolve-btn').click();
  await p.waitForTimeout(300);
  const confirmBtn = p.locator('.guild-confirm .guild-danger-solid');
  ok(await confirmBtn.isDisabled(), '输入框为空时「确认解散」禁用');
  await p.locator('.guild-confirm input').fill('错的');
  await p.waitForTimeout(200);
  ok(await confirmBtn.isDisabled(), '输错名字仍禁用');
  await p.locator('.guild-confirm input').fill('守高地小队');
  await p.waitForTimeout(200);
  ok(await confirmBtn.isEnabled(), '输对名字后可以点');

  console.log('\nconsole 错误:', errors.length, errors.slice(0, 3));
  ok(errors.length === 0, '无 console 报错');

  // 清理：解散
  await confirmBtn.click();
  await p.waitForTimeout(1500);
  const cleaned = await (await fetch(BASE + '/api/guild', { headers: { cookie: 'dd_session=' + token } })).json();
  ok(cleaned.guild === null, '测试帮派已清理');

  await b.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('ERR', e.message);
  process.exitCode = 1;
});
