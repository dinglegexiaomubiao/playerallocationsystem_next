#!/usr/bin/env node
/**
 * 小程序文案合规扫描：不许出现游戏相关词。
 *
 * 背景（2026-10-28）：审核打电话说「个人主体的小程序不能出现游戏、英雄这些
 * 和游戏有关联的词，只能说是用于个人娱乐、查询比赛、查询战绩、咨询的工具」。
 * 当时小程序里躺着 25 处「开黑」、13 处「英雄」，全是界面文案，一被看到就卡。
 *
 * 为什么要脚本而不是人工检查：
 *   这些词是群友的日常说法，写代码时顺手就打上去了；而且它们散在 22 个文件里，
 *   placeholder、分享标题、showModal 文案、json 的导航栏标题都有，靠 review 必漏。
 *
 * 误报怎么处理：
 *   只检查「会被渲染出来的字符串」——
 *     · .wxml / .json 全文检查
 *     · .js 只查引号内的字面量，跳过注释（代码注释里提到「游戏活动通知」是合理的，
 *       那是微信官方模板名，审核看不到）
 *   真有正当理由要保留某个词，在那一行末尾加 `// wording-ok`。
 */
const fs = require('fs');
const path = require('path');

const BANNED = [
  ['开黑', '改为「组队」（这是游戏黑话，审核点名的一类）'],
  ['英雄', '改为「擅长项」'],
  ['游戏', '去掉；产品定位用「个人娱乐 / 查询比赛 / 查询战绩 / 咨询」'],
  ['冲分', '改为「缺人」之类的中性说法'],
  ['玩家资料', '改为「个人资料」'],
];

const SKIP = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g; // 只在 .js 里剥注释用

const files = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(js|json|wxml|wxss)$/.test(name)) files.push(p);
  }
}
walk('miniprogram');
// 服务端会下发文案给小程序，一样要合规（订阅页的分类名、模板说明都从这里来）
files.push('lib/mp-notify.mjs');

let hits = 0;
const out = [];

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');

  // 把注释「挖空但保留换行」，这样行号不变、注释里的词也不会误报。
  // 逐行剥 /\/\/.*$/ 处理不了跨行块注释（JSDoc 中间那几行），必须整体先处理块注释。
  let body = raw;
  if (/\.(js|mjs|wxss)$/.test(file)) {
    body = body.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''));
    body = body
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');
  } else if (/\.wxml$/.test(file)) {
    body = body.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''));
  }

  const rawLines = raw.split('\n');
  const bodyLines = body.split('\n');

  rawLines.forEach((rawLine, i) => {
    if (/wording-ok/.test(rawLine)) return;
    const line = bodyLines[i] == null ? '' : bodyLines[i];
    for (const [word, advice] of BANNED) {
      if (!line.includes(word)) continue;
      hits++;
      out.push(`${file}:${i + 1}  「${word}」 ${advice}\n    ${rawLine.trim().slice(0, 100)}`);
    }
  });
}

if (hits === 0) {
  console.log('✅ 文案扫描通过：没有游戏相关词（开黑 / 英雄 / 游戏 / 冲分 / 玩家资料）');
  process.exit(0);
}

console.log(`❌ 发现 ${hits} 处游戏相关词：\n`);
for (const line of out) console.log('  ' + line);
console.log('\n提示：确需保留的，在该行末尾加 // wording-ok');
process.exit(1);
