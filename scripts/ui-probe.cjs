#!/usr/bin/env node
/**
 * UI 溢出探针：把 WXSS 按真机宽度（375pt）渲染成 HTML，用无头 Chrome 量 scrollWidth。
 *
 * 为什么需要它：横向溢出（页面能左右滑、网格少一列、右侧文字被裁）在静态检查里
 * 只能靠规则推断，真正判定必须让浏览器算一遍布局。这里把 wxss 的 rpx 换算成 px
 * （1rpx = 0.5px @375），结构照 WXML 转成 HTML，然后读 body.scrollWidth。
 *
 *   node scripts/ui-probe.cjs              # 组件精测（player-deep：溢出 + 色块列数）
 *   node scripts/ui-probe.cjs --pages      # 26 个页面全量扫一遍（结构级）
 *   node scripts/ui-probe.cjs --stress     # 同上，但把纯数据插值换成长英文串，测「长昵称/长标题会不会顶宽」
 *   node scripts/ui-probe.cjs --components # 两个自定义组件各测一遍
 *
 * 退出码：0 = 干净；1 = 有页面/元素横向溢出（会列出可疑元素）。
 *
 * ⚠ 这是「结构级」探针：wx:for 只渲染一份、{{ }} 替换成占位文本，所以它抓的是
 * 尺寸与盒模型问题（满宽 + padding、固定宽超屏、flex 撑宽），抓不到「某个用户的
 * 昵称特别长」这类数据驱动的极端值 —— 那类要靠 --stress。
 * ⚠ --stress 有噪声：它把 score / time / count 这些本该很短的数字位也换成长串，
 * 所以报出来的溢出要逐个看类名 —— 只有「昵称 / 队伍名 / 标题 / 帮派名」这类
 * 用户自由输入的字段才是真问题，数字位一律当误报。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const run = promisify(execFile);
const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const VIEWPORT = 375;
const TMP = path.join(os.tmpdir(), 'mp-ui-probe');

const CHROME_CANDIDATES = [
  'C:/Users/SUNY09/AppData/Local/Google/Chrome/Application/chrome.exe',
  'C:/Users/SUNJOY09/AppData/Local/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));

// ---------------------------------------------------------------- 样式

/** 1rpx = 0.5px（750 设计宽 ÷ 375 视口） */
const rpx2px = (css) =>
  css.replace(/(-?\d*\.?\d+)rpx/g, (_, n) => {
    const v = Number(n) * 0.5;
    return (Number.isInteger(v) ? v : Number(v.toFixed(3))) + 'px';
  });

/** 内联 @import（只处理相对路径，够用） */
function inlineImports(css, dir, depth) {
  if ((depth || 0) > 3) return css;
  return css.replace(/@import\s+["']([^"']+)["']\s*;/g, (all, rel) => {
    const target = path.resolve(dir, rel);
    if (!fs.existsSync(target)) return '';
    return inlineImports(fs.readFileSync(target, 'utf8'), path.dirname(target), (depth || 0) + 1);
  });
}

/** 小程序标签在 HTML 里是未知元素（默认 inline），必须补上 display，否则布局全错 */
const TAG_FIX = `
view,scroll-view,swiper,swiper-item,block,movable-area,movable-view,cover-view{display:block;}
text{display:inline;}
image{display:inline-block;}
button{display:block;margin:0;padding:0;border:0;background:none;font:inherit;}
/* input / textarea 在小程序里是块级、宽度填充父容器；HTML 里 input 有约 170px 的
   固有宽度，会把 flex 子项顶宽，制造出真机没有的「溢出」。按小程序行为补回来。 */
input,textarea{display:block;width:100%;box-sizing:border-box;font:inherit;}
`;

function buildCss(pageWxss, opts) {
  const o = opts || {};
  const appCss = fs.readFileSync(path.join(MP, 'app.wxss'), 'utf8');
  // page{} 是小程序的根选择器，换成 html,body 才能让背景/字号生效
  const appBody = appCss.replace(/(^|\})\s*page\s*\{/g, '$1 html,body{');
  const tokens = {};
  for (const m of appCss.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  const tokenCss = ':root{' + Object.keys(tokens).map((k) => k + ':' + tokens[k]).join(';') + '}';
  const parts = [tokenCss, appBody, o.extraCss || ''];
  if (pageWxss) parts.push(pageWxss);
  // fixed 元素在 HTML 里相对「窗口」定位（无头 Chrome 窗口 500 宽），在我们锁成
  // 375 的 body 里会被误判成溢出。改成 absolute，让它相对 body 算宽度。
  return rpx2px(TAG_FIX + parts.join('\n')).replace(/position\s*:\s*fixed/g, 'position:absolute');
}

function buildDoc(css, bodyHtml, measureJs) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
html{margin:0;padding:0;}
/* body 锁 375 当「手机屏幕」，position:relative 让页面里原本 fixed 的底栏在探针里
   也按 375 算宽度（否则它相对 500 宽的窗口定位，整行都会被误判成溢出） */
body{margin:0;padding:0;width:${VIEWPORT}px;position:relative;overflow:visible;}
${css}
</style></head><body>${bodyHtml}<script>${measureJs}</script></body></html>`;
}

const MEASURE = (vw) => `
(function () {
  // ⚠ 无头 Chrome 窗口最小 500px，--window-size 不一定生效，所以布局宽度锁在 body 上
  var over = [];
  document.querySelectorAll('*').forEach(function (el) {
    if (el === document.documentElement || el === document.body) return;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > ${vw} + 0.5) {
      over.push({ cls: (el.className || el.tagName).toString().slice(0, 40), right: Math.round(r.right * 10) / 10 });
    }
  });
  var rowsMap = {};
  document.querySelectorAll('.tile').forEach(function (el) {
    var t = Math.round(el.getBoundingClientRect().top);
    rowsMap[t] = (rowsMap[t] || 0) + 1;
  });
  var out = {
    scrollWidth: document.body.scrollWidth,
    tilesPerRow: Object.keys(rowsMap).map(function (k) { return rowsMap[k]; }),
    overflow: over.slice(0, 10)
  };
  var pre = document.createElement('pre');
  pre.textContent = 'PROBE:' + JSON.stringify(out);
  document.body.appendChild(pre);
})();`;

async function render(file) {
  const dom = await run(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--virtual-time-budget=3000',
      '--window-size=' + VIEWPORT + ',1600',
      '--dump-dom',
      'file:///' + file.replace(/\\/g, '/'),
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  );
  const m = /PROBE:(\{[\s\S]*?\})<\/pre>/.exec(dom.stdout || dom);
  if (!m) throw new Error('没拿到测量结果');
  return JSON.parse(m[1]);
}

// ---------------------------------------------------------------- 模式一：组件精测

function tile(hero, win, kda) {
  return `<div class="tile ${win ? 'is-win' : 'is-lose'}"><span class="tile-hero">${hero}</span><span class="tile-res">${
    win ? '胜' : '负'
  } · ${kda}</span></div>`;
}
function row(win, hero, kda, mode, dur, patch, rank, ago) {
  return `<div class="mrow"><div class="mrow-head">
      <span class="mrow-res ${win ? 'is-win' : 'is-lose'}">${win ? '胜利' : '失败'}</span>
      <span class="mrow-hero">${hero}</span><span class="mrow-kda">${kda}</span></div>
    <div class="mrow-sub"><span class="mrow-tag">${mode}</span><span class="mrow-tag">${dur}</span>
      <span class="mrow-tag">${patch}</span><span class="mrow-tag">${rank}</span>
      <span class="mrow-ago">${ago}</span></div></div>`;
}

function deepBody() {
  const heroes = ['巫医', '巫妖', '混沌骑士', '天怒法师', '水晶室女'];
  const tiles = Array.from({ length: 20 }, (_, i) => tile(heroes[i % 5], i % 3 !== 0, '0.' + ((i % 9) + 1))).join('');
  const rows = Array.from({ length: 10 }, (_, i) =>
    row(i % 3 !== 0, heroes[i % 5], '3/' + (i % 9) + '/' + (10 + i), '天梯', '44:14', '7.41', '万古流芳' + ((i % 5) + 1), i + ' 天前')
  ).join('');
  return `
<div class="page-wrap"><div class="pd">
  <div class="block">
    <div class="sec-title">近期战绩<span class="sec-note">OpenDota</span></div>
    <div class="surface stats">
      <div class="cell"><span class="cell-num">60%</span><span class="cell-label">近 200 场胜率</span></div>
      <div class="cell"><span class="cell-num">120 / 80</span><span class="cell-label">胜 / 负</span></div>
      <div class="cell"><span class="cell-num">3.42</span><span class="cell-label">场均 KDA</span></div>
      <div class="cell"><span class="cell-num">44:14</span><span class="cell-label">平均时长</span></div>
      <div class="stats-meta"><span class="stats-meta-i">主号 124801257</span><span class="stats-meta-i">生涯 1200 胜 / 800 负 · 60%</span></div>
      <div class="stats-window"><span class="stats-window-t">近 20 场</span>
        <span class="stats-window-i">GPM 512</span><span class="stats-window-i">场均伤害 31200</span></div>
      <div class="stats-best"><span class="stats-best-t">近 20 场最高</span>
        <span class="stats-best-i">击杀 22</span><span class="stats-best-i">助攻 31</span><span class="stats-best-i">KDA 9.9</span></div>
      <div class="stats-modes">
        <span class="stats-mode">天梯 160 场 · 80%</span><span class="stats-mode">普通 24 场 · 12%</span>
        <span class="stats-mode">加速 10 场 · 5%</span><span class="stats-mode">其他 6 场 · 3%</span></div>
      <div class="stats-heroes">${heroes.map((h) => `<span class="stats-hero">${h} 32 场 · 62%</span>`).join('')}</div>
      <div class="tiles">${tiles}</div>
      <div class="mlist">${rows}<div class="mrow-more">展开更多（已显示 10 / 200 场）</div></div>
    </div>
  </div>
  <div class="block">
    <div class="sec-title">战绩解读</div>
    <div class="surface ai-body">
      <div class="ai-para">1. 🦸 **英雄池与打法特征**：近 100 场里巫医占了四成，偏先手开团型辅助。</div>
      <div class="ai-para">2. 🛠 **需要注意特殊英雄**：最近用过修补匠 3 场、胜率 66%，值得单独准备针对。</div>
      <div class="ai-foot"><span class="ai-foot-hint">从服务器读取，仅供参考</span><span class="ai-rerun">重新读取</span></div>
    </div>
  </div>
</div></div>`;
}

async function probeComponent() {
  const css = buildCss(fs.readFileSync(path.join(MP, 'components', 'player-deep', 'player-deep.wxss'), 'utf8'));
  const file = path.join(TMP, 'deep.html');
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(file, buildDoc(css, deepBody(), MEASURE(VIEWPORT)), 'utf8');
  const r = await render(file);

  console.log('\n[组件精测] player-deep @ 375pt');
  const scroll = r.scrollWidth > VIEWPORT;
  console.log('  页面 scrollWidth = ' + r.scrollWidth + (scroll ? '  ✗ 可以左右滑' : '  ✓ 不横向溢出'));
  const four = r.tilesPerRow.length > 0 && r.tilesPerRow.every((n) => n === 4);
  console.log('  色块每行个数 = ' + JSON.stringify(r.tilesPerRow) + (four ? '  ✓ 4 列' : '  ✗ 不是 4 列'));
  if (r.overflow.length) {
    console.log('  超出右边的元素：');
    r.overflow.forEach((o) => console.log('    ' + o.cls + '  right=' + o.right));
  } else {
    console.log('  没有任何元素超出右边 ✓');
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  return scroll || r.overflow.length > 0 || (r.tilesPerRow.length > 0 && !four) ? 1 : 0;
}

// ---------------------------------------------------------------- 模式二：全页面扫描

const COMPONENT_STUB = {
  // 组件已单独精测，这里换成等宽占位，避免它的 class 与页面同名类互相污染
  'region-picker': '<view style="height:40px;background:#eee;"></view>',
  'player-deep': '<view style="height:40px;background:#eee;"></view>',
};

function wxmlToHtml(src, using, opts) {
  const o = opts || {};
  // 20 个字符且不含空格：接近「真实的长昵称/长英文标题」，比 44 字符的极端值有意义
  const ph = o.stress ? 'LongNicknameNoSpace1' : '示例文本';
  let s = src.replace(/<!--[\s\S]*?-->/g, '');
  // 自定义组件 → 定宽占位
  for (const tag of Object.keys(using || {})) {
    s = s.replace(new RegExp('<' + tag + '\\b[^>]*/>', 'g'), COMPONENT_STUB[tag] || '<view></view>');
    s = s.replace(
      new RegExp('<' + tag + '\\b[^>]*>[\\s\\S]*?</' + tag + '>', 'g'),
      COMPONENT_STUB[tag] || '<view></view>'
    );
  }
  // 指令与事件：整条删掉（wx:else 没有值，所以值部分可选）
  s = s.replace(
    /\s(?:wx:if|wx:elif|wx:else|wx:for|wx:for-item|wx:for-index|wx:key|wx:key|bindtap|bind:tap|catchtap|catch:tap|bindchange|bind:change|bindinput|bind:input|bindconfirm|bind:confirm|bindsubmit|bind:submit|bindscrolltolower|bind:scrolltolower|bindlongpress|bind:longpress|catchtouchmove|data-[\w-]+)(?:="[^"]*")?/g,
    ''
  );
  s = s.replace(/\s(?:hover-class|hover-start-time|hover-stay-time|scroll-x|scroll-y|enable-flex|open-type|form-type|show-info|scroll-into-view|scroll-with-animation|refresher-enabled|lower-threshold|maxlength|placeholder-class)(?:="[^"]*")?/g, '');
  // 插值 → 占位。压力模式只压「纯数据路径」（{{item.title}} / {{info.nickname}}），
  // 像 {{saving ? '保存中…' : '保存'}} 这种固定文案照旧用短占位，否则全是误报。
  s = s.replace(/\{\{([^}]*)\}\}/g, (all, expr) => {
    if (!o.stress) return ph;
    const isPath = /^[\s]*[a-zA-Z_$][\w$]*(\.[\w$]+|\[\d+\])*[\s]*$/.test(expr);
    return isPath ? ph : '示例';
  });
  // block 不是真实节点
  s = s.replace(/<\/?block[^>]*>/g, '');
  // WXML 的 `<textarea />` / `<image />` 自闭合写法在 HTML 里不成立（它们不是
  // void 元素），会一路吞到文件末尾，连测量脚本都被吃掉 —— 必须补上闭合标签。
  s = s.replace(/<([a-zA-Z][\w-]*)\b([^>]*?)\/>/g, '<$1$2></$1>');
  return s;
}

async function probePages(stress) {
  const app = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
  fs.mkdirSync(TMP, { recursive: true });
  // 压力模式：把占位文本换成一段不带空格的长英文 + 长数字，专门测
  // 「没有 ellipsis / word-break 保护的文本会不会把行撑宽」（中文会自然换行，测不出）
  const ph = stress ? 'VeryLongNicknameWithoutAnySpace1234567890' : '示例文本';

  const tasks = app.pages.map(async (p, i) => {
    const wxml = fs.readFileSync(path.join(MP, p + '.wxml'), 'utf8');
    const wxssPath = path.join(MP, p + '.wxss');
    const pageCss = fs.existsSync(wxssPath) ? inlineImports(fs.readFileSync(wxssPath, 'utf8'), path.dirname(wxssPath), 0) : '';
    let using = {};
    try {
      using = JSON.parse(fs.readFileSync(path.join(MP, p + '.json'), 'utf8')).usingComponents || {};
    } catch (e) {
      /* 无所谓 */
    }
    const css = buildCss(pageCss);
    const body = wxmlToHtml(wxml, using, { stress: stress });
    const file = path.join(TMP, 'p' + i + '.html');
    fs.writeFileSync(file, buildDoc(css, body, MEASURE(VIEWPORT)), 'utf8');
    try {
      const r = await render(file);
      return { page: p, scrollWidth: r.scrollWidth, overflow: r.overflow, err: null };
    } catch (e) {
      return { page: p, scrollWidth: 0, overflow: [], err: e.message };
    }
  });

  // 并发 6 个，够快也不至于把机器拖死
  const results = [];
  for (let i = 0; i < tasks.length; i += 6) {
    results.push(...(await Promise.all(tasks.slice(i, i + 6))));
  }

  console.log(
    '\n[全页面扫描] ' + results.length + ' 页 @ 375pt' + (stress ? '（压力：超长英文/数字）' : '（结构级：wx:for 只渲染一份）')
  );
  const bads = results.filter((r) => r.err || r.scrollWidth > VIEWPORT);
  for (const r of results) {
    const flag = r.err ? 'ERR ' : r.scrollWidth > VIEWPORT ? '溢出' : '  ok';
    console.log('  ' + flag + '  ' + r.scrollWidth + '  ' + r.page + (r.err ? '  ' + r.err : ''));
  }
  for (const b of bads) {
    if (!b.overflow.length) continue;
    console.log('\n  ' + b.page + ' 超出右边的元素：');
    b.overflow.forEach((o) => console.log('    ' + o.cls + '  right=' + o.right));
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  return bads.length ? 1 : 0;
}

// 只有这两个页面挂了组件；组件单独测，页面里的占位见 COMPONENT_STUB
async function probeComponents() {
  const list = [
    { name: 'region-picker', dir: path.join(MP, 'components', 'region-picker') },
    { name: 'player-deep', dir: path.join(MP, 'components', 'player-deep') },
  ];
  fs.mkdirSync(TMP, { recursive: true });
  let code = 0;
  console.log('\n[组件结构扫描] @ 375pt');
  for (const c of list) {
    const wxml = fs.readFileSync(path.join(c.dir, c.name + '.wxml'), 'utf8');
    const wxss = fs.readFileSync(path.join(c.dir, c.name + '.wxss'), 'utf8');
    let using = {};
    try {
      using = JSON.parse(fs.readFileSync(path.join(c.dir, c.name + '.json'), 'utf8')).usingComponents || {};
    } catch (e) {
      /* 无所谓 */
    }
    // 组件样式隔离：只拼 app 令牌 + 组件自己的 wxss（不拼页面样式）
    const css = buildCss(inlineImports(wxss, c.dir, 0));
    const file = path.join(TMP, c.name + '.html');
    fs.writeFileSync(file, buildDoc(css, '<view class="page-wrap">' + wxmlToHtml(wxml, using, {}) + '</view>', MEASURE(VIEWPORT)), 'utf8');
    try {
      const r = await render(file);
      const okk = r.scrollWidth <= VIEWPORT && r.overflow.length === 0;
      if (!okk) code = 1;
      console.log('  ' + (okk ? '  ok' : '溢出') + '  ' + r.scrollWidth + '  ' + c.name);
      r.overflow.forEach((o) => console.log('    ' + o.cls + '  right=' + o.right));
    } catch (e) {
      code = 1;
      console.log('  ERR   0  ' + c.name + '  ' + e.message);
    }
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  return code;
}

// ---------------------------------------------------------------- 入口

(async () => {
  if (!chrome) {
    console.log('没找到 Chrome/Edge，跳过测量（静态检查仍然有效）');
    process.exit(0);
  }
  const arg = process.argv.slice(2);
  let code = 0;
  if (arg.includes('--pages')) code = await probePages(false);
  else if (arg.includes('--stress')) code = await probePages(true);
  else if (arg.includes('--components')) code = await probeComponents();
  else code = await probeComponent();
  process.exit(code);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
