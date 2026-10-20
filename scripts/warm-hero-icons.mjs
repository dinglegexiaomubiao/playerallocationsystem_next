/**
 * 预热英雄头像缓存：把 126 张英雄立绘一次性抓到 .cache/heroes/。
 *
 * 为什么需要它：打开英雄选择弹窗时前端会同时请求 126 张图，
 * 首次部署（缓存为空）下这些请求会一起回源 Valve CDN，实测会有相当一部分
 * 超时后才陆续到达，表现为「弹窗里的头像慢慢才出现」。
 * 在服务器上跑一次这个脚本，之后运行期就全是磁盘命中，11ms 一张。
 *
 * 用法（项目根目录）：
 *   node scripts/warm-hero-icons.mjs
 *   node scripts/warm-hero-icons.mjs --force   # 忽略已有缓存，全部重抓
 *
 * 只写 .cache/（已在 .gitignore 里），不会往仓库里塞图片。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import imageCache from '../lib/image-cache.js';
import heroSlugByName from '../lib/heroSlugs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'heroes');
const CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes';

const FORCE = process.argv.includes('--force');
const CONCURRENCY = 6;

const slugs = Array.from(new Set(Object.values(heroSlugByName)));
const total = slugs.length;

console.log(`英雄立绘预热：${total} 个英雄 → ${CACHE_DIR}${FORCE ? '（强制重抓）' : ''}`);

if (!FORCE) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

let done = 0;
let cached = 0;
let fetched = 0;
const failed = [];

async function handle(slug) {
  const file = path.join(CACHE_DIR, slug);
  if (!FORCE && fs.existsSync(file) && fs.statSync(file).size > 1024) {
    cached += 1;
    return;
  }
  const img = await imageCache.getImage('heroes', slug, `${CDN}/${slug}.png`);
  if (img) fetched += 1;
  else failed.push(slug);
}

const queue = slugs.slice();
async function worker() {
  while (queue.length) {
    const slug = queue.shift();
    try {
      await handle(slug);
    } catch (error) {
      failed.push(slug);
    }
    done += 1;
    if (done % 10 === 0 || done === total) {
      process.stdout.write(`\r  进度 ${done}/${total}（命中 ${cached} / 新抓 ${fetched} / 失败 ${failed.length}）`);
    }
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
console.log(`\n完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  已缓存 ${cached}，新抓取 ${fetched}，失败 ${failed.length}`);
if (failed.length) {
  console.log('  失败清单（可重跑本脚本补齐）：');
  console.log('   ', failed.join(', '));
  process.exitCode = 1;
}
