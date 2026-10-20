/**
 * 独立 node 脚本的环境变量加载器。
 *
 * Next.js 只会给页面和 API 路由自动注入 .env.local，用 `node xxx.js` 直接跑的
 * 维护脚本读不到任何变量 —— 这就是当初图省事把连接串写死在脚本里的原因。
 * 这里把「读 .env.local」抽出来，脚本一律走 requireDatabaseUrl()，不再出现明文凭据。
 *
 * 用法：
 *   const { requireDatabaseUrl } = require('./scripts/env');
 *   new Client({ connectionString: requireDatabaseUrl() })
 */

const fs = require('fs');
const path = require('path');

/**
 * 解析 .env.local 并写入 process.env。
 * 已存在的环境变量优先（命令行传入的 DATABASE_URL 会覆盖文件里的值）。
 */
function loadEnv(file = '.env.local') {
  const p = path.join(__dirname, '..', file);
  if (!fs.existsSync(p)) return false;

  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    // 去掉成对的引号（连接串里常有 ?sslmode=require 这类字符，不需要引号）
    if (val.length >= 2 && (val[0] === '"' || val[0] === "'") && val[val.length - 1] === val[0]) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
  return true;
}

/**
 * 取数据库连接串；没有就报错退出并给出怎么配。
 * 绝不回退到任何硬编码地址 —— 那是这次泄漏事故的根源。
 */
function requireDatabaseUrl() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      '缺少 DATABASE_URL。\n' +
        '  方式一：在项目根目录建 .env.local，写入 DATABASE_URL=postgresql://...\n' +
        '  方式二：运行时传入  DATABASE_URL=postgresql://... node import-players.js\n' +
        '（可参考 .env.local.example）'
    );
    process.exit(1);
  }
  return url;
}

module.exports = { loadEnv, requireDatabaseUrl };
