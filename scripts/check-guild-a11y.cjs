/**
 * 帮派相关元素的对比度检查（日夜各一次，四个区域）。
 *
 * 覆盖：个人信息里的帮派区块 / 帮派管理弹窗 / 邀请成员选择器 / 进站邀请弹窗。
 * 这四块是帮派功能里所有「用户会读到文字」的地方，任何一处在某个主题下掉到
 * 4.5:1 以下都算问题 —— 尤其是卡片渐变底上的灰字（那是这个功能最容易出事的地方）。
 *
 * 为什么不复用 scripts/a11y-contrast.cjs：那个脚本不带登录态，打 /profile 只会
 * 看到未登录页，测不到这些区块；而且它扫整页，帮派元素会淹没在几百条里。
 *
 * ⚠ 会写数据库（造一个帮派 + 一条邀请），只允许打本地，除非 ALLOW_REMOTE=1。
 *
 * 用法：BASE=http://127.0.0.1:3006 node scripts/check-guild-a11y.cjs
 */
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
const sign = (n) => {
  const p = Buffer.from(JSON.stringify({ n, t: Date.now() })).toString('base64url');
  return p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
};

const A = process.env.A_NAME || 'dom';
const B = process.env.B_NAME || '04';
const pool = new Pool({ connectionString: env.DATABASE_URL });

// 在页面里跑：扫指定容器内的文本元素，返回低于 4.5:1 的
const auditIn = (sel) => {
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
      cur = cur.parentElement;
    }
    let base = { ...canvas, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };

  const root = document.querySelector(sel);
  if (!root) return [{ cls: 'MISSING', text: '找不到 ' + sel, ratio: 0, size: '' }];

  const out = [];
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
      });
    }
  }
  const seen = new Set();
  return out
    .filter((x) => {
      const k = x.cls + x.size;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.ratio - b.ratio);
};

(async () => {
  const pid = async (a) => {
    const r = await pool.query('SELECT player_id FROM public.play_score WHERE name=$1', [a]);
    return Number(r.rows[0].player_id);
  };
  const [aId, bId] = await Promise.all([pid(A), pid(B)]);
  const clean = () =>
    pool.query(
      `DELETE FROM public.guilds WHERE leader_player_id = ANY($1::bigint[])
         OR id IN (SELECT guild_id FROM public.guild_members WHERE player_id = ANY($1::bigint[]))`,
      [[aId, bId]]
    );
  await clean();

  // 造一个带口号、带 3 个成员的帮派，再造一条给 B 的邀请
  const api = async (who, method, p, body) => {
    const r = await fetch(BASE + p, {
      method,
      headers: { cookie: 'dd_session=' + sign(who), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, d: await r.json().catch(() => ({})) };
  };
  const g = await api(A, 'POST', '/api/guild', {
    name: '对比度测试帮',
    slogan: '今晚谁来守高地，缺个四号位',
    colorKey: 'teal',
  });
  if (!g.d.success) throw new Error('建帮失败: ' + g.d.error);
  const ms = await pool.query(
    'SELECT id FROM public.players WHERE id <> $1 ORDER BY score DESC NULLS LAST LIMIT 3',
    [bId]
  );
  for (const m of ms.rows) {
    await pool.query("INSERT INTO public.guild_members (guild_id, player_id, role) VALUES ($1,$2,'member')", [
      g.d.id,
      m.id,
    ]);
  }
  await api(A, 'POST', '/api/guild/invites', { playerId: bId, message: '一起打天梯啊，缺个四号位' });

  const browser = await chromium.launch();
  let total = 0;

  for (const theme of ['light', 'dark']) {
    const initScript =
      theme === 'dark'
        ? () => {
            try {
              localStorage.setItem('laroja-theme', 'dark');
            } catch (e) {}
          }
        : null;

    // ---- 帮主侧：区块 + 管理弹窗 + 选择器 ----
    const actx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await actx.addCookies([{ name: 'dd_session', value: sign(A), domain: '127.0.0.1', path: '/', httpOnly: true }]);
    const ap = await actx.newPage();
    if (initScript) await ap.addInitScript(initScript);

    await ap.goto(BASE + '/profile', { waitUntil: 'networkidle', timeout: 60000 });
    await ap.waitForSelector('.guild-block', { timeout: 20000 });
    await ap.waitForTimeout(700);
    const panel = await ap.evaluate(auditIn, '.guild-block');

    await ap.locator('.guild-block .btn').filter({ hasText: '帮派管理' }).click();
    await ap.waitForSelector('.guild-modal', { timeout: 10000 });
    await ap.waitForTimeout(400);
    const modal = await ap.evaluate(auditIn, '.guild-modal');

    await ap.locator('.guild-members-head .btn').filter({ hasText: '邀请成员' }).click();
    await ap.waitForSelector('.guild-picker', { timeout: 10000 });
    await ap.waitForTimeout(700);
    const picker = await ap.evaluate(auditIn, '.guild-picker');
    await ap.locator('.guild-picker .modal-close').click();
    await actx.close();

    // ---- 被邀请人侧：进站弹窗 ----
    const bctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await bctx.addCookies([{ name: 'dd_session', value: sign(B), domain: '127.0.0.1', path: '/', httpOnly: true }]);
    const bp = await bctx.newPage();
    if (initScript) await bp.addInitScript(initScript);
    await bp.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
    await bp.waitForTimeout(2600);
    const promptCount = await bp.locator('.guild-invite-card').count();
    const prompt = promptCount ? await bp.evaluate(auditIn, '.guild-invite-card') : [];
    await bctx.close();

    const zones = { 区块: panel, 管理弹窗: modal, 选择器: picker, 邀请弹窗: prompt };
    const sum = Object.values(zones).reduce((n, z) => n + z.length, 0);
    console.log(
      `\n[${theme === 'light' ? '日间' : '夜间'}] 共 ${sum} 处低于 4.5:1（邀请弹窗出现：${promptCount ? '是' : '否'}）`
    );
    for (const [name, list] of Object.entries(zones)) {
      if (list.length) {
        console.log(`  ${name}: ${list.length} 处`);
        for (const x of list.slice(0, 5)) console.log(`    ${x.ratio.toFixed(2)}:1  ${x.cls}  「${x.text}」  ${x.size}`);
      }
    }
    total += sum;
  }

  await browser.close();
  await clean();
  await pool.end();

  if (total) {
    console.log(`\n✗ 共 ${total} 处低于 4.5:1`);
    process.exit(1);
  }
  console.log('\n✓ 帮派四处界面：日夜两个主题均无低于 4.5:1 的文字');
})().catch(async (e) => {
  console.error('ERR', e.message);
  try {
    await pool.end();
  } catch (x) {}
  process.exit(1);
});
