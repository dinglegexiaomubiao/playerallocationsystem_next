/**
 * 生成 lib/itemMapping.js：物品 id → Valve CDN 文件名（slug）
 *
 * 用法（网络能访问 OpenDota 时）：
 *   node scripts/gen-item-mapping.js
 *
 * 为什么要生成本地文件而不是每次跑接口：
 *   渲染一局比赛要翻译 10 人 × 6~9 个物品，实时查接口会拖慢首屏，
 *   而且 OpenDota 挂掉时整页装备都会变成空白。
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'lib', 'itemMapping.js');

(async () => {
  const r = await fetch('https://api.opendota.com/api/constants/items', {
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();

  const map = {};
  let skipped = 0;
  for (const k of Object.keys(data)) {
    const it = data[k];
    if (!it || it.id == null || !it.img) {
      skipped++;
      continue;
    }
    // img 形如 /apps/dota2/images/dota_react/items/blink.png?t=1593393829403
    const m = String(it.img).match(/\/items\/([^./?]+)\.(png|jpg|webp)/i);
    if (!m) {
      skipped++;
      continue;
    }
    map[it.id] = m[1];
  }

  const ids = Object.keys(map)
    .map(Number)
    .sort((a, b) => a - b);

  const lines = ids.map((id) => `  ${id}: '${map[id]}',`);
  const today = new Date().toISOString().slice(0, 10);

  const content = `/**
 * 物品 id → Valve 官方 CDN 文件名（slug）
 *
 * 自动生成，请勿手改。重新生成：node scripts/gen-item-mapping.js
 * 数据源：https://api.opendota.com/api/constants/items
 * 生成日期：${today}，物品 ${ids.length} 个（跳过 ${skipped} 条无图标记录）
 *
 * 用途：拼 https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/{slug}.png
 * 走 /api/item-icon/{slug} 代理，避免国内直连 CDN 的延迟与裂图。
 */
const itemSlugs = {
${lines.join('\n')}
};

/** 代理层用来做白名单校验，避免 /api/item-icon 变成任意 URL 代理 */
export const ITEM_SLUGS = new Set(Object.values(itemSlugs));

export default itemSlugs;
`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, content, 'utf8');
  console.log(`已生成 ${OUT}：${ids.length} 个物品，跳过 ${skipped} 条`);
})().catch((e) => {
  console.error('生成失败:', e.message);
  process.exit(1);
});
