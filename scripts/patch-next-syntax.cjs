#!/usr/bin/env node
/**
 * 把 Next.js 16 自带的 class 静态初始化块（`static{ ... }`）降级成等价的 class 静态字段。
 *
 * 为什么需要：`static{ ... }` 是 ES2022 的**class static block**，需要
 * Chrome 94+ / Safari 16.4+。而站点有真实用户在用 iOS 16.0 / 16.2（Safari 16.0/16.2）
 * 和微信内置的 Chrome 86（XWEB 4433）。这些引擎解析到这个 `{` 就直接
 * `Unexpected token '{'`，整个 chunk 解析失败 → React 从来没启动 → 页面空白。
 * 证据见 /admin/support 里 category=boot 的工单（2026-10-22 #105/#106/#111）。
 *
 * 为什么可以安全改写：静态块里的 `this.X = expr;` 与静态字段 `static X = expr;`
 * 语义完全一致 —— 都在类定义时求值一次，产出的属性都是 writable/enumerable/configurable。
 * 静态字段从 Safari 14.1 / Chrome 72 就支持，覆盖到我们要照顾的引擎。
 *
 * 只处理「块体全部是 this.X = 表达式; 语句」这一种形态，其它形态原样保留并打印出来，
 * 交给 check-browser-syntax.cjs 在构建后兜底报警 —— 绝不猜测性地改代码。
 *
 * 幂等：已经改过的文件再跑一次不会有变化。
 * 为什么不用 patch-package：多一层依赖和 .patch 文件维护成本；
 * 这个脚本挂在 `npm run build` 的 prebuild 上，`npm ci` 之后自动重新生效。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NEXT_DIST = path.join(ROOT, 'node_modules', 'next', 'dist');

/** 按顶层 `;` 切分语句，跳过字符串 / 模板串 / 括号里的分号；顺手剥掉注释 */
function splitStatements(body) {
  const out = [];
  let cur = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') { cur += body[++i] || ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    // 注释：只在引号外剥离（块体里带注释的话，不剥会导致语句匹配失败）
    if (ch === '/' && body[i + 1] === '/') {
      const nl = body.indexOf('\n', i);
      i = nl < 0 ? body.length : nl;
      continue;
    }
    if (ch === '/' && body[i + 1] === '*') {
      const end = body.indexOf('*/', i + 2);
      i = end < 0 ? body.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ';' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 尝试把一段静态块体转成静态字段；转不了返回 null */
function bodyToFields(body) {
  const stmts = splitStatements(body);
  if (stmts.length === 0) return null;
  const fields = [];
  for (const s of stmts) {
    const m = s.match(/^this\.([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/);
    if (!m) return null; // 有别的语句（声明、控制流、裸赋值）→ 整体放弃，不猜
    fields.push(`static ${m[1]} = ${m[2].trim()};`);
  }
  return fields.join(' ');
}

/** 在文件里找出所有 `static { ... }` 并尝试改写。返回 { code, changed, skipped } */
function patchSource(code) {
  let out = '';
  let i = 0;
  let changed = 0;
  const skipped = [];

  while (i < code.length) {
    const idx = code.slice(i).search(/\bstatic\s*\{/);
    if (idx < 0) { out += code.slice(i); break; }
    const at = i + idx;
    out += code.slice(i, at);

    // 找到静态块的起始 `{`
    const braceStart = at + code.slice(at).indexOf('{');
    // 配对右括号
    let depth = 0;
    let j = braceStart;
    for (; j < code.length; j++) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) { out += code.slice(at); break; }

    const body = code.slice(braceStart + 1, j);
    const fields = bodyToFields(body);
    if (fields) {
      out += fields;
      changed++;
    } else {
      skipped.push(body.trim().slice(0, 120).replace(/\s+/g, ' '));
      out += code.slice(at, j + 1);
    }
    i = j + 1;
  }

  return { code: out, changed, skipped };
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(js|mjs|cjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function main() {
  if (!fs.existsSync(NEXT_DIST)) {
    console.log('[patch-next-syntax] 没有 node_modules/next，跳过（先 npm install）');
    return;
  }

  const files = walk(NEXT_DIST);
  let totalChanged = 0;
  let totalSkipped = 0;
  const skippedDetail = [];

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/\bstatic\s*\{/.test(src)) continue;

    const res = patchSource(src);
    if (res.changed > 0) {
      fs.writeFileSync(file, res.code, 'utf8');
      totalChanged += res.changed;
      console.log(`  → ${path.relative(ROOT, file)}：改写 ${res.changed} 处`);
    }
    if (res.skipped.length) {
      totalSkipped += res.skipped.length;
      for (const s of res.skipped) skippedDetail.push(`${path.relative(ROOT, file)} :: ${s}`);
    }
  }

  console.log(
    `[patch-next-syntax] 共改写 ${totalChanged} 处静态块${totalSkipped ? `，跳过 ${totalSkipped} 处（形态复杂，交给构建后检查兜底）` : ''}`
  );
  if (skippedDetail.length) {
    console.log('  跳过的静态块：');
    for (const s of skippedDetail.slice(0, 10)) console.log('    · ' + s);
  }

  // 自检：改完再扫一遍，确认目标文件里那个 Router 的静态块没了
  const routerFile = path.join(NEXT_DIST, 'shared', 'lib', 'router', 'router.js');
  if (fs.existsSync(routerFile)) {
    const left = (fs.readFileSync(routerFile, 'utf8').match(/\bstatic\s*\{/g) || []).length;
    console.log(
      left === 0
        ? '  ✓ router.js 里的静态块已清除（Router.events 改成静态字段）'
        : `  ⚠ router.js 里还剩 ${left} 处静态块`
    );
  }
}

main();
