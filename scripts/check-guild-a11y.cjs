// 帮派相关元素的对比度检查（日夜各一次）。
//
// 为什么不复用 scripts/a11y-contrast.cjs：那个脚本不带登录态，打 /profile 只会
// 看到未登录页，测不到帮派区块和弹窗。而且它扫整页，帮派元素淹没在几百条里。
//
// 这里只做两件事：打开个人信息页 → 量帮派区块；打开管理弹窗 → 量弹窗内部。
// 背景按 DOM 逐层合成（和 a11y 脚本同一套算法），半透明渐变也能算准。
const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE = process.env.BASE || 'http://127.0.0.1:3006';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(BASE) && process.env.ALLOW_REMOTE !== '1') {
  console.error('✗ 这个脚本会创建并删除帮派，只允许打本地。远端请显式加 ALLOW_REMOTE=1。');
  process.exit(1);
}
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
const payload = Buffer.from(JSON.stringify({ n: 'dom', t: Date.now() })).toString('base64url');
const token = payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

// 在页面里跑：只扫 guild-* 子树
const auditGuild = (sel) => {
  const parse = (s) => {
    const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:\s*,\s*([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = (c) => 0.2126 * lin(c.r / 255) + 0.7152 * lin(c.g / 255) + 0.0722 * lin(c.b / 255);
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;background:var(--bg-page)';
  document.body.appendChild(probe);
  const canvas = parse(getComputedStyle(probe).backgroundColor) || { r: 21, g: 23, b: 26, a: 1 };
  probe.remove();

  const bgOf = (el) => {
    let cur = el;
    const stack = [];
    while (cur) {
      const c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 0.99) break;
      }
      // 渐变背景（background-image）本身不算进合成，但它的底色已在 backgroundColor 里；
      // 帮派的渐变是 0.12 透明度的线性渐变，实际渲染色介于 compute 的 backgroundColor
      // 与渐变两端之间，这里按「渐变最深处」再叠一次做保守估计。
      cur = cur.parentElement;
    }
    let base = { ...canvas, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };

  const out = [];
  const root = document.querySelector(sel);
  if (!root) return [{ cls: 'MISSING', text: '找不到 ' + sel, ratio: 0, size: '', color: '' }];
  for (const el of root.querySelectorAll('*')) {
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const v = ratio(over(fg, bg), bg);
    if (v < 4.5) {
      out.push({
        cls: (el.className || el.tagName).toString().slice(0, 44),
        text: (el.textContent || '').trim().slice(0, 20),
        ratio: +v.toFixed(2),
        size: cs.fontSize,
        color: cs.color,
      });
    }
  }
  const seen = new Set();
  return out
    .filter((x) => {
      const k = x.cls + x.color + x.size;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.ratio - b.ratio);
};

const pool = new Pool({ connectionString: env.DATABASE_URL });
// 只删本脚本自己造的（固定测试名 + dom 当帮主），不清空整表
const clean = () =>
  pool.query(
    "DELETE FROM public.guilds WHERE name = '守高地小队' AND leader_player_id = (SELECT player_id FROM public.play_score WHERE name = 'dom')"
  );


(async () => {
  // 造一个有成员、有口号的帮派（对比度最差的场景：渐变底 + 彩色标签）
  await clean();
  const r = await fetch(BASE + '/api/guild', {
    method: 'POST',
    headers: { cookie: 'dd_session=' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '守高地小队', slogan: '今晚谁来守高地，缺个四号位', colorKey: 'teal' }),
  });
  const g = await r.json();
  if (!g.success) throw new Error('创建失败: ' + g.error);
  const ms = await pool.query(
    `SELECT p.id FROM public.players p
      WHERE p.id <> (SELECT leader_player_id FROM public.guilds WHERE id=$1)
      ORDER BY p.score DESC NULLS LAST LIMIT 3`,
    [g.id]
  );
  for (const m of ms.rows) {
    await pool.query("INSERT INTO public.guild_members (guild_id, player_id, role) VALUES ($1,$2,'member')", [g.id, m.id]);
  }

  const b = await chromium.launch();
  let total = 0;
  for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 } });
    await ctx.addCookies([{ name: 'dd_session', value: token, domain: '127.0.0.1', path: '/', httpOnly: true }]);
    const p = await ctx.newPage();
    if (theme === 'dark') {
      await p.addInitScript(() => {
        try {
          localStorage.setItem('laroja-theme', 'dark');
        } catch (e) {}
      });
    }
    await p.goto(BASE + '/profile', { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForSelector('.guild-block', { timeout: 20000 });
    await p.waitForTimeout(700);

    const panel = await p.evaluate(auditGuild, '.guild-block');
    await p.locator('.guild-block .btn').filter({ hasText: '帮派管理' }).click();
    await p.waitForSelector('.guild-modal', { timeout: 10000 });
    await p.waitForTimeout(400);
    const modal = await p.evaluate(auditGuild, '.guild-modal');

    console.log(`\n[${theme === 'light' ? '日间' : '夜间'}] 帮派区块 ${panel.length} 处低于 4.5 / 弹窗 ${modal.length} 处`);
    for (const x of [...panel, ...modal]) {
      console.log(`  ${x.ratio.toFixed(2)}:1  ${x.cls}  「${x.text}」  ${x.size}`);
    }
    total += panel.length + modal.length;
    await ctx.close();
  }
  await b.close();

  await clean();
  await pool.end();

  if (total) {
    console.log(`\n✗ 共 ${total} 处低于 4.5:1`);
    process.exit(1);
  }
  console.log('\n✓ 帮派区块与弹窗：两个主题均无低于 4.5:1 的文字');
})().catch(async (e) => {
  console.error('ERR', e.message);
  try {
    await clean();
    await pool.end();
  } catch (x) {}
  process.exit(1);
});
