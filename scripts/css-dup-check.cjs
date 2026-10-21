#!/usr/bin/env node
/**
 * 样式表同名选择器查重。
 *
 * 为什么需要：站点有 6 份 CSS，靠 pages/_app.js 的 import 顺序决定优先级：
 *   globals.css → main/index.css → layout.css → shell.css → home.css → tournament-dark.css
 * 同名选择器分散在多份文件里时，改「前面那份」的某些属性会毫无效果，
 * 因为真正生效的可能是后面那份；反过来也有一部分属性仍由前面那份决定。
 * 这类问题在自己那个页面上完全看不出来，只在别的页面炸。
 *
 * 用法：
 *   node scripts/css-dup-check.cjs              # 完整报告
 *   node scripts/css-dup-check.cjs --brief      # 只看汇总
 *   node scripts/css-dup-check.cjs .modal-body  # 只查某个选择器
 *   node scripts/css-dup-check.cjs --strict     # 存在「部分覆盖」时退出码 1（给 CI 用）
 *
 * 判定口径（逐属性找最终胜出者，而不是只比首尾两份文件）：
 *   完全覆盖 —— 该选择器的所有属性都被最后一份文件盖住（前面那份是死代码）
 *   部分覆盖 —— 一部分属性来自后面的文件，一部分仍由更早的文件决定（最坑）
 *   未被覆盖 —— 后面那份声明了但一个属性都没赢（等于没生效）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'globals.css',
  'main/index.css',
  'layout.css',
  'shell.css',
  'home.css',
  'tournament-dark.css',
];

const args = process.argv.slice(2);
const BRIEF = args.includes('--brief');
const STRICT = args.includes('--strict');
const FILTER = args.find((a) => !a.startsWith('--')) || '';

/** 极简 CSS 分块：按大括号栈走，区分 @media 容器与规则块，并跳过 @keyframes 里的 from/to/百分比 */
function parseRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let sel = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') {
      stack.push({ selector: sel.trim(), isAtRule: sel.trim().startsWith('@'), body: '' });
      sel = '';
    } else if (ch === '}') {
      const frame = stack.pop();
      const stepOfKeyframes = /^(from|to|\d+%)/.test(frame ? frame.selector : '');
      if (frame && !frame.isAtRule && !stepOfKeyframes) {
        rules.push({
          selector: frame.selector,
          body: frame.body,
          inMedia: stack.some((x) => x.isAtRule),
        });
      }
      sel = '';
    } else {
      const top = stack[stack.length - 1];
      if (top && !top.isAtRule) top.body += ch;
      else sel += ch;
    }
  }
  return rules;
}

const normSel = (s) => s.replace(/\s+/g, ' ').trim();
const propsOf = (body) =>
  body
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.includes(':'))
    .map((d) => d.slice(0, d.indexOf(':')).trim().toLowerCase())
    .filter(Boolean);

// ---------- 收集 ----------
const perFile = new Map(); // file → Map(selector → {props:Set, inMedia})
const fileStats = [];

FILES.forEach((file) => {
  const abs = path.join(ROOT, 'styles', file);
  if (!fs.existsSync(abs)) return;
  const rules = parseRules(fs.readFileSync(abs, 'utf8'));
  const map = new Map();
  const classes = new Set();

  rules.forEach((r) => {
    const key = normSel(r.selector);
    if (!map.has(key)) map.set(key, { props: new Set(), inMedia: false });
    const entry = map.get(key);
    propsOf(r.body).forEach((p) => entry.props.add(p));
    if (!r.inMedia) entry.inMedia = false;
    (r.selector.match(/\.[A-Za-z_][\w-]*/g) || []).forEach((c) => classes.add(c));
  });

  perFile.set(file, map);
  fileStats.push({ file, rules: rules.length, classes: classes.size });
});

// ---------- 交叉 ----------
const index = new Map(); // selector → [{file, props}]
perFile.forEach((map, file) => {
  map.forEach((entry, sel) => {
    if (!index.has(sel)) index.set(sel, []);
    index.get(sel).push({ file, props: entry.props });
  });
});

const dups = [...index.entries()]
  .filter(([sel, list]) => list.length > 1 && (!FILTER || sel.includes(FILTER)))
  .map(([sel, list]) => {
    const winner = new Map(); // prop → file（按文件顺序，最后声明者胜出）
    list.forEach((f) => f.props.forEach((p) => winner.set(p, f.file)));

    const lastFile = list[list.length - 1].file;
    const fromLast = [];
    const fromEarlier = {};
    winner.forEach((file, prop) => {
      if (file === lastFile) fromLast.push(prop);
      else (fromEarlier[file] = fromEarlier[file] || []).push(prop);
    });

    const earlierCount = Object.values(fromEarlier).reduce((n, a) => n + a.length, 0);
    const kind =
      winner.size === 0 ? '空规则' : earlierCount === 0 ? '完全覆盖' : fromLast.length === 0 ? '未被覆盖' : '部分覆盖';

    return { sel, files: list.map((f) => f.file), kind, fromEarlier, fromLast, total: winner.size };
  })
  .sort((a, b) => {
    const rank = { 部分覆盖: 0, 未被覆盖: 1, 空规则: 2, 完全覆盖: 3 };
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
    return b.files.length - a.files.length || a.sel.localeCompare(b.sel);
  });

// ---------- 输出 ----------
console.log('样式表规模');
fileStats.forEach((s) => {
  console.log(`  ${s.file.padEnd(22)} 规则 ${String(s.rules).padStart(5)}   类选择器 ${String(s.classes).padStart(4)}`);
});

const byKind = {};
dups.forEach((d) => (byKind[d.kind] = (byKind[d.kind] || 0) + 1));
console.log(`\n跨文件重复的选择器：${dups.length} 个`);
console.log(`  部分覆盖 ${byKind['部分覆盖'] || 0}（最坑） · 完全覆盖 ${byKind['完全覆盖'] || 0}（前面是死代码） · 未被覆盖 ${byKind['未被覆盖'] || 0}`);

const pairs = new Map();
dups.forEach((d) => {
  const k = d.files.join(' → ');
  if (!pairs.has(k)) pairs.set(k, []);
  pairs.get(k).push(d);
});
console.log('\n按文件对：');
[...pairs.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .forEach(([k, v]) => {
    const partial = v.filter((x) => x.kind === '部分覆盖').length;
    console.log(`  ${k.padEnd(46)} ${String(v.length).padStart(3)} 个（部分覆盖 ${partial}）`);
  });

if (!BRIEF) {
  console.log('\n【部分覆盖】改前面那份的部分属性不会生效：');
  dups
    .filter((d) => d.kind === '部分覆盖')
    .forEach((d) => {
      console.log(`\n  ${d.sel}`);
      console.log(`    文件: ${d.files.join(' → ')}`);
      Object.entries(d.fromEarlier).forEach(([f, props]) => {
        console.log(`    仍由 ${f.padEnd(20)} 决定: ${props.join(', ')}`);
      });
      console.log(`    由 ${d.files[d.files.length - 1].padEnd(22)} 决定: ${d.fromLast.join(', ')}`);
    });

  console.log('\n【未被覆盖】后面那份声明了但没生效：');
  dups.filter((d) => d.kind === '未被覆盖').forEach((d) => console.log(`  ${d.sel.padEnd(40)} ${d.files.join(' → ')}`));

  console.log('\n【完全覆盖】前面那份是死代码，可安全删除：');
  dups.filter((d) => d.kind === '完全覆盖').forEach((d) => console.log(`  ${d.sel.padEnd(44)} ${d.files.join(' → ')}`));
}

console.log('\n提示：改某个类之前先 grep -rn "^\\.你的类名" styles/*.css');
const partial = byKind['部分覆盖'] || 0;
process.exit(STRICT && partial > 0 ? 1 : 0);
