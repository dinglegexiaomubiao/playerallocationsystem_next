/**
 * 把内部踩坑表同步成团队共享版 docs/pitfalls.md
 *
 * 为什么要脱敏：原文件里有一段「后台 cookie 怎么签」的具体算法，
 * 连 AUTH_SECRET 在哪儿取的都写了 —— 那是可以直接用来伪造管理员会话的说明。
 * 共享版只说「在哪、去看代码」，不给算法。
 *
 * 以后改了内部版，重跑这个脚本即可：
 *   node scripts/sync-pitfalls-doc.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '.workbuddy', 'memory', 'notes', 'pitfalls.md');
const OUT = path.join(ROOT, 'docs', 'pitfalls.md');

const src = fs.readFileSync(SRC, 'utf8');
const lines = src.split('\n');

// ---- 1. 脱敏：替换「后台 cookie 自己签」那一条（原文件里固定占 4 行）----
const anchor = lines.findIndex((l) => l.includes('后台 cookie 自己签'));
if (anchor < 0) {
  console.error('✗ 找不到脱敏锚点「后台 cookie 自己签」，源文件结构变了，检查后再跑');
  process.exit(1);
}
lines.splice(
  anchor,
  4,
  '- **后台会话是自签 cookie，密钥在服务器 `.env.local` 的 `AUTH_SECRET`**。',
  '  签名算法不在这份共享文档里展开 —— 写出来等于给出伪造管理员会话的方法。',
  '  需要时看 `lib/auth.js`。注意本地与线上的 `AUTH_SECRET` 不同源，本地签的线上无效。'
);

let out = lines.join('\n');

// ---- 2. 换标题，加共享版说明 ----
const TITLE = '# 踩过的坑（会反复遇到）';
const NEW_HEADER = [
  '# 踩坑记录（团队共享版）',
  '',
  '> 按「症状 → 原因 → 怎么判 → 怎么修」组织。碰到线上异常、部署失败、样式错乱，',
  '> 先扫一遍标题再往下查 —— 这里大部分坑都踩过两次以上。',
  '>',
  '> ⚠ 这份是**共享版**：涉及密钥、`AUTH_SECRET`、cookie 签名算法的内容都做了省略，',
  '> 完整版只在开发者的本地上下文里维护。改这里时顺手在群里说一声，',
  '> 免得两边认知不一致 —— 2026-10-23 那两次事故都是信息不对称引起的。',
  '',
  '排查顺序：先分「代码问题」还是「环境/部署问题」。线上整站无响应一律先 ping +',
  '端口探测（见第 2 节），本地接口全 500 一律先查数据库隧道（见第 4 节）。',
].join('\n');

if (!out.includes(TITLE)) {
  console.error('✗ 找不到原标题，源文件结构变了');
  process.exit(1);
}
out = out.replace(TITLE, NEW_HEADER);

// ---- 3. 去掉原文件里紧跟标题的那两行「排查顺序建议」（已并入新头部）----
out = out.replace(
  /排查顺序建议：\*\*先分「代码问题」还是「环境\/部署问题」\*\*。线上整站无响应一律先 ping \+\n端口探测（见第 2 节），本地接口全 500 一律先查数据库隧道（见第 4 节）。\n/,
  ''
);

// 去掉替换后留下的多余空行（原文件在标题与第一条之间有一空行 + 分隔线）
out = out.replace('隧道（见第 4 节）。\n\n\n---', '隧道（见第 4 节）。\n\n---');

// ---- 3. 自检：确认敏感内容没漏出去 ----
// ⚠ 必须在落盘之前。写完了再检查等于没检查 —— 文件已经被污染，而且脚本退出后
// 那份带密钥的文档就躺在仓库里等着被提交。
const LEAK_PATTERNS = [
  'hmacSha256(payload,key)',
  "base64url({n:'dom'",
  'key=sha256(secret)',
  'dd_session=',
];
const leaks = LEAK_PATTERNS.filter((k) => out.includes(k));
if (leaks.length) {
  console.error('✗ 共享版里仍有敏感内容，未写入文件：' + leaks.join(' / '));
  console.error('  要么把它们从源文件里删掉，要么在脚本里加脱敏规则。');
  process.exit(1);
}

// ---- 4. 落盘 ----
fs.writeFileSync(OUT, out, 'utf8');

console.log('✓ docs/pitfalls.md 已生成');
console.log('  源文件 ' + src.length + ' 字符 → 共享版 ' + out.length + ' 字符');
console.log('  已脱敏，无签名算法残留');
