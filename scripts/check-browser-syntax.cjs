#!/usr/bin/env node
/**
 * 构建后兜底检查：扫 .next/static 下所有 JS，确认没有老引擎解析不了的语法。
 *
 * 起因（2026-10-22）：Next.js 16.3.0 自己在 `next/dist/shared/lib/router/router.js`
 * 里用了 class 静态初始化块 `static{ this.events = ... }`，需要 Chrome 94+ / Safari 16.4+。
 * 站点有真实用户在用 iOS 16.0 / 16.2 和微信内置 Chrome 86 —— 整包解析失败，
 * 报 `Unexpected token '{'`，React 从来没启动，页面空白且后台查不到访问。
 *
 * 这类问题在桌面 Chrome / 新 iPhone 上**完全看不出来**，所以必须由构建环节把关：
 * `scripts/patch-next-syntax.cjs` 负责把已知形态改写成静态字段，本脚本负责
 * 在产物层面验证「真的没有了」。发现残留就直接让构建失败 —— 宁可部署不过，
 * 也不要把一个只在老设备上白屏的版本发上线。
 *
 * 用法：node scripts/check-browser-syntax.cjs [.next 目录]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 部署时 next build 会写到 NEXT_DIST_DIR（.next-build），检查必须跟着走，
// 否则会去扫上一版还没换掉的 .next —— 检查通过但新产物根本没被检查。
const NEXT_DIR = process.argv[2] || path.join(ROOT, process.env.NEXT_DIST_DIR || '.next');

// 每一项都是「语法级」不兼容：命中就是解析失败，不是运行时才报错。
// 括号里写明最早支持的版本，方便判断影响范围。
const RULES = [
  { name: 'class 静态初始化块 static{...}', re: /\bstatic\s*\{/g, since: 'Chrome 94 / Safari 16.4' },
  { name: '正则后行断言 (?<=)', re: /\(\?<[=!]/g, since: 'Chrome 62 / Safari 16.4' },
  { name: '正则 v 标志', re: /\/[gimsuy]*v[gimsuy]*[,;)\]]/g, since: 'Chrome 112 / Safari 17' },
];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

function main() {
  const base = path.join(NEXT_DIR, 'static');
  if (!fs.existsSync(base)) {
    console.log('[check-browser-syntax] 没有 .next/static，跳过（先 build）');
    return;
  }

  const files = walk(base);
  const hits = [];

  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(code)) !== null) {
        hits.push({
          file: path.relative(ROOT, file),
          rule: rule.name,
          since: rule.since,
          ctx: code.slice(Math.max(0, m.index - 70), m.index + 90).replace(/\s+/g, ' '),
        });
        if (hits.length > 40) break;
      }
    }
  }

  console.log(`[check-browser-syntax] 扫描 ${files.length} 个 JS 文件`);

  if (hits.length === 0) {
    console.log('  ✓ 没有发现老引擎解析不了的语法（iOS 16 / Chrome 86 可正常执行）');
    return;
  }

  console.error(`  ✗ 发现 ${hits.length} 处老引擎会解析失败的语法：`);
  for (const h of hits.slice(0, 12)) {
    console.error(`    · ${h.file}`);
    console.error(`      ${h.rule}（需 ${h.since}）`);
    console.error(`      上下文: ${h.ctx.slice(0, 180)}`);
  }
  console.error('');
  console.error('  影响：这些文件在 iOS 16.0~16.3 / Chrome <94 上整包解析失败，');
  console.error('        报 Unexpected token \'{\'，React 不会启动（页面空白/交互全死）。');
  console.error('  处理：把该语法改写成等价的低版本写法，或扩展 scripts/patch-next-syntax.cjs。');
  process.exit(1);
}

main();
