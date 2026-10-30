#!/usr/bin/env node
/**
 * 微信小程序静态自查（不需要 DevTools）。
 *
 * 为什么要有它：小程序构建失败时 DevTools 的报错很不直观，而下面这些错误
 * 全都属于「一看就知道」的类型，本地跑一遍比在 DevTools 里猜快得多：
 *   1. JSON 不合法（小程序对 JSON 比 JS 严格，注释和尾逗号都会炸）
 *   2. app.json 里声明的页面缺 .js/.json/.wxml/.wxss —— 四件套缺一个就编译失败
 *   3. tabBar.pagePath 指向未注册的页面
 *   4. WXML 里写了小程序不支持的语法：可选链 ?.、空值合并 ??、箭头函数
 *   5. WXSS 自定义属性里写了 rpx —— 变量值不走编译期 rpx 转换，真机上尺寸全乱
 *   6. 页面 JS 里误用浏览器 API（document / window / localStorage / fetch）
 *
 * 用法：node scripts/check-miniprogram.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'miniprogram');
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
let fail = 0;
const bad = (m) => {
  console.log('  ✗ ' + m);
  fail++;
};
const ok = (m) => console.log('  ✓ ' + m);
const abs = (p) => path.join(ROOT, p);

console.log('\n[小程序自查] ' + ROOT);

// 1) 页面四件套
const missing = [];
for (const p of app.pages) {
  for (const ext of ['.js', '.json', '.wxml', '.wxss']) {
    if (!fs.existsSync(abs(p + ext))) missing.push(p + ext);
  }
}
missing.length
  ? bad('缺少页面文件: ' + missing.join(', '))
  : ok(app.pages.length + ' 个页面四件套齐全');

// 2) 每个页面 json 必须合法且有 usingComponents
const componentRefs = []; // { page, name, target }
for (const p of app.pages) {
  let j = null;
  try {
    j = JSON.parse(fs.readFileSync(abs(p + '.json'), 'utf8'));
  } catch (e) {
    bad(p + '.json 解析失败: ' + e.message);
    continue;
  }
  if (j.usingComponents === undefined) bad(p + '.json 缺 usingComponents');
  const uc = j.usingComponents || {};
  Object.keys(uc).forEach((name) => componentRefs.push({ page: p, name: name, target: uc[name] }));
}

// 3) tabBar
if (app.tabBar) {
  const list = app.tabBar.list || [];
  const notIn = list.map((i) => i.pagePath).filter((p) => app.pages.indexOf(p) < 0);
  notIn.length
    ? bad('tabBar 指向未注册页面: ' + notIn.join(', '))
    : ok('tabBar ' + list.length + ' 项路径正确');
  const noText = list.filter((i) => !i.text);
  if (noText.length) bad('tabBar 有 ' + noText.length + ' 项缺 text');
}

// 4) 首页模块跳转目标必须都已注册，避免点了白屏
const idxJs = fs.readFileSync(abs('pages/index/index.js'), 'utf8');
const paths = [...idxJs.matchAll(/path:\s*'([^']*)'/g)].map((m) => m[1]).filter(Boolean);
const badPaths = paths.filter((p) => app.pages.indexOf(p.replace(/^\//, '')) < 0);
badPaths.length
  ? bad('首页模块指向未注册页面: ' + badPaths.join(', '))
  : ok('首页 ' + paths.length + ' 个模块路径全部已注册');

// 5) app 级开关
app.lazyCodeLoading === 'requiredComponents'
  ? ok('lazyCodeLoading=requiredComponents')
  : bad('缺少 lazyCodeLoading（默认全量注入组件，启动慢）');

// 6) 自定义组件：四件套齐全 + 页面引用的组件真实存在 + WXML 里的自定义标签都注册过
//    「标签写了但 json 没注册」在 DevTools 里只报一句看不懂的模板错误，这里提前拦。
const wxmls = app.pages.map((p) => p + '.wxml').filter((f) => fs.existsSync(abs(f)));
const BUILTIN_TAGS = [
  'view', 'text', 'image', 'input', 'textarea', 'button', 'picker', 'picker-view',
  'picker-view-column', 'scroll-view', 'swiper', 'swiper-item', 'block', 'navigator',
  'icon', 'checkbox', 'checkbox-group', 'radio', 'radio-group', 'switch', 'slider',
  'form', 'label', 'video', 'audio', 'canvas', 'map', 'web-view', 'cover-view',
  'cover-image', 'rich-text', 'progress', 'movable-area', 'movable-view', 'editor',
  'camera', 'live-player', 'live-pusher', 'official-account', 'open-data', 'ad',
  'page-meta', 'navigation-bar', 'slot', 'template', 'import', 'include', 'wxs',
];

function componentDir(target) {
  // 支持 "/components/x/x" 与 "../../components/x/x" 两种写法
  if (target.charAt(0) === '/') return path.join(ROOT, target.slice(1));
  return path.resolve(ROOT, target);
}

const componentFiles = [];
// 同一个组件被多个页面引用时只算一个组件（否则「2 个组件」会让人以为多了一份）
const uniqComponents = new Set();
for (const ref of componentRefs) {
  const base = componentDir(ref.target);
  const miss = ['.js', '.json', '.wxml', '.wxss'].filter((ext) => !fs.existsSync(base + ext));
  if (miss.length) {
    bad(ref.page + ' 引用的组件缺 ' + miss.join('/') + ' → ' + ref.target);
    continue;
  }
  componentFiles.push(base);
  uniqComponents.add(base);
  try {
    const cj = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
    if (cj.component !== true) bad(path.relative(ROOT, base) + '.json 缺 "component": true');
  } catch (e) {
    bad(path.relative(ROOT, base) + '.json 解析失败: ' + e.message);
  }
  const cjs = fs.readFileSync(base + '.js', 'utf8');
  if (cjs.indexOf('Component(') < 0) bad(path.relative(ROOT, base) + '.js 没有调用 Component()');
}
if (uniqComponents.size) {
  ok(uniqComponents.size + ' 个自定义组件四件套齐全（被 ' + componentFiles.length + ' 处引用）');
}

for (const f of wxmls) {
  const s = fs.readFileSync(abs(f), 'utf8');
  const pageDef = app.pages.indexOf(f.replace(/\.wxml$/, ''));
  const pagePath = app.pages[pageDef];
  let registered = {};
  try {
    const pj = JSON.parse(fs.readFileSync(abs(pagePath + '.json'), 'utf8'));
    registered = pj.usingComponents || {};
  } catch (e) {
    registered = {};
  }
  const custom = new Set();
  for (const m of s.matchAll(/<([a-zA-Z][\w-]*)/g)) {
    const tag = m[1];
    if (BUILTIN_TAGS.indexOf(tag) >= 0) continue;
    custom.add(tag);
  }
  const unknown = [...custom].filter((t) => !registered[t]);
  if (unknown.length) bad(f + ' 用了没注册的自定义标签: ' + unknown.join(', '));
}

// 7) WXML 禁用语法
for (const f of wxmls) {
  const s = fs.readFileSync(abs(f), 'utf8');
  const hits = [];
  if (/\?\./.test(s)) hits.push('可选链 ?.');
  if (/\?\?/.test(s)) hits.push('空值合并 ??');
  if (/=>/.test(s)) hits.push('箭头函数');
  if (/<script/i.test(s)) hits.push('<script>');
  if (!/wx:else/.test(s) === false) {
    /* 仅确保 wx:else 不被当成独立条件写错，交给 DevTools */
  }
  const fors = (s.match(/wx:for=/g) || []).length;
  const keys = (s.match(/wx:key=/g) || []).length;
  if (fors > keys) hits.push('wx:for(' + fors + ') 多于 wx:key(' + keys + ')，缺 key 会告警刷屏');
  if (hits.length) bad(f + ' → ' + hits.join(' / '));
}

// 8) WXSS 自定义属性里不能出现 rpx
const wxsss = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const fp = path.join(d, n);
    if (fs.statSync(fp).isDirectory()) {
      if (n !== 'node_modules' && n !== 'miniprogram_npm') walk(fp);
    } else if (n.endsWith('.wxss')) {
      wxsss.push(fp);
    }
  }
})(ROOT);
for (const f of wxsss) {
  const s = fs.readFileSync(f, 'utf8');
  const m = /--[\w-]+\s*:[^;{}]*rpx/.exec(s);
  if (m) bad(path.relative(ROOT, f) + ' 自定义属性含 rpx → ' + m[0].trim());
  // @import 指错路径不会报错，只会「页面没样式」，最难查
  for (const im of s.matchAll(/@import\s+["']([^"']+)["']/g)) {
    const target = path.resolve(path.dirname(f), im[1]);
    if (!fs.existsSync(target)) bad(path.relative(ROOT, f) + ' @import 找不到 → ' + im[1]);
  }

  // 8b) 注释提前闭合（2026-10-30 真踩过）：注释正文里写了「星号 + 斜杠」，比如列举
  //    「.act-*/.tile*」这种通配写法，那个斜杠会把注释就地结束，后面的中文说明
  //    当成 CSS 选择器 → WXSS 编译报 unexpected `�`，整份样式不生效。
  //    静态四件套检查看不出来，只能在这里守：注释去掉后不该再有中文散文。
  const opens = (s.match(/\/\*/g) || []).length;
  const closes = (s.match(/\*\//g) || []).length;
  if (opens !== closes) {
    bad(path.relative(ROOT, f) + ' 注释标记不成对（/* ' + opens + ' 个，*/ ' + closes + ' 个）');
  }
  const stripped = s.replace(/\/\*[\s\S]*?\*\//g, '');
  const leaked = stripped
    .split('\n')
    .map((l, i) => ({ no: i + 1, text: l }))
    .filter((x) => /[\u4e00-\u9fa5]/.test(x.text) && !/content\s*:/.test(x.text));
  if (leaked.length) {
    bad(
      path.relative(ROOT, f) +
        ' 注释外出现中文（多半是注释被提前闭合）→ 第 ' +
        leaked[0].no +
        ' 行: ' +
        leaked[0].text.trim().slice(0, 50)
    );
  }
  const openBrace = (stripped.match(/{/g) || []).length;
  const closeBrace = (stripped.match(/}/g) || []).length;
  if (openBrace !== closeBrace) {
    bad(path.relative(ROOT, f) + ' 花括号不成对（{ ' + openBrace + ' 个，} ' + closeBrace + ' 个）');
  }
}

// 9) 页面 / 组件 / utils 的 JS 不许碰浏览器 API，且语法必须能被解析
const jss = app.pages.map((p) => p + '.js').filter((f) => fs.existsSync(abs(f)));
const compJss = componentFiles
  .map((base) => path.relative(ROOT, base) + '.js')
  .filter((f) => fs.existsSync(abs(f)));
const utilJss = fs
  .readdirSync(abs('utils'))
  .filter((n) => n.endsWith('.js'))
  .map((n) => 'utils/' + n);
for (const f of jss.concat(compJss, utilJss)) {
  const s = fs.readFileSync(abs(f), 'utf8');
  for (const w of ['document.', 'window.', 'localStorage', 'fetch(']) {
    if (s.indexOf(w) >= 0) bad(f + ' 含浏览器 API: ' + w);
  }
}
for (const f of ['app.js'].concat(utilJss, compJss, jss)) {
  try {
    new Function(fs.readFileSync(abs(f), 'utf8'));
  } catch (e) {
    bad(f + ' 语法错误: ' + e.message);
  }
}

// 10) project.config.json 指向要能覆盖 app.json 所在目录
try {
  const proj = JSON.parse(fs.readFileSync(abs('project.config.json'), 'utf8'));
  proj.miniprogramRoot === './'
    ? ok('miniprogramRoot=./')
    : bad('miniprogramRoot=' + proj.miniprogramRoot + '（应为 ./）');
  if (!proj.appid) bad('project.config.json 缺 appid');
} catch (e) {
  bad('project.config.json 解析失败: ' + e.message);
}

console.log(
  '\n' +
    (fail
      ? '❌ ' + fail + ' 项未通过'
      : '✅ 全部通过（' +
        wxsss.length +
        ' wxss / ' +
        wxmls.length +
        ' wxml / ' +
        jss.length +
        ' js）') +
    '\n'
);
process.exit(fail ? 1 : 0);
