#!/usr/bin/env node
/**
 * 每日汇总推送（PM2 cron，每天 20:00 一次）。
 *
 * 为什么是 cron 而不是「有人发帖时立刻广播」：
 * 个人主体的小程序只有**一次性订阅**，一次授权 = 一条消息。如果有人半夜发
 * 三条开黑就立刻播三条，全群所有人的额度当场清零，之后一整天什么也收不到。
 * 压成每天一条，一条额度换三类的信息，这是额度最省的用法。
 *
 * 「有人报名了我的招募」不走这里 —— 那条是定向、有时效，在报名接口里即时发。
 *
 * 用法：
 *   node scripts/mp-digest.cjs               # 正常发（cron 用这个）
 *   node scripts/mp-digest.cjs --dry-run     # 只统计 + 写站内信，不消耗额度
 *   node scripts/mp-digest.cjs --since=2026-10-28T00:00:00+08:00
 *
 * 环境变量从 .env.local 读（pm2 起的进程不会自动带 Next 的 env）——
 * 没有 MP_SECRET 也能跑，结果是全部落到「跳过」并记日志，站内信照写。
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

// 优先用 Next 自己的加载器（它会处理 .env.local / .env.production 的优先级），
// 项目里就有这个依赖，不必再引 dotenv。
try {
  require('@next/env').loadEnvConfig(ROOT, false);
} catch (e) {
  console.warn('[warn] 没加载到 @next/env，回退手解析 .env.local:', e.message);
  const fs = require('fs');
  const file = path.join(ROOT, '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('--dryrun');
const sinceArg = (args.find((a) => a.startsWith('--since=')) || '').slice('--since='.length);
const force = args.includes('--force');

function stamp() {
  // 用服务器本地时间（东八区），好跟 pm2 日志前缀那一列对上；
  // toISOString() 是 UTC，同一行会出现两个差 8 小时的时间，排查时特别容易看错。
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

(async () => {
  console.log(`[${stamp()}] 开始跑每日汇总${dryRun ? '（dry-run，不消耗额度）' : ''}`);

  let pool = null;
  try {
    const db = await import('../lib/db.js');
    pool = db.pool || (db.default && db.default.pool) || null;

    const { runDigest, mpConfigured } = await import('../lib/mp-notify.mjs');

    // 到点才跑。
    //
    // 为什么需要这道闸：pm2 每次 `pm2 start` / 重启都会**立刻执行一次** cron app，
    // 所以每次部署都会白跑一次汇总 —— 部署在下午 4 点，全群就在 4 点收到「每日汇总」，
    // 而晚上 20:00 那次的窗口只剩 4 小时，下午发的帖子反而进不了当天那条。
    // 用「当前小时 >= 约定小时」直接挡掉，比在库里判断「今天发过没」干净得多：
    // 后者一旦判断失误就会**吞掉当天的内容**，前者最多是晚发一会儿。
    const runHour = Number(process.env.MP_DIGEST_HOUR || 20);
    const nowHour = new Date().getHours();
    if (!force && !sinceArg && Number.isFinite(runHour) && nowHour < runHour) {
      console.log(
        `[${stamp()}] 现在 ${nowHour} 点，还没到 ${runHour} 点，跳过（pm2 启动/重启会触发一次，属正常）。`
      );
      return;
    }

    const cfg = mpConfigured();
    if (!cfg.canPush && !dryRun) {
      console.warn(
        '[warn] 微信通道没配齐（缺 ' +
          [
            cfg.missing.appid ? 'MP_APPID' : '',
            cfg.missing.secret ? 'MP_SECRET' : '',
            cfg.missing.templates.length ? '模板 id:' + cfg.missing.templates.join('/') : '',
          ]
            .filter(Boolean)
            .join('、') +
          '），本次只会写站内信。'
      );
    }

    const report = await runDigest({
      dryRun,
      force,
      since: sinceArg ? new Date(sinceArg) : null,
    });

    const c = report.counts || {};
    console.log(
      `[${stamp()}] 窗口 ${report.from} → ${report.until}\n` +
        `  新增：开黑 ${c.party || 0} · 活动 ${c.activity || 0} · 赛事 ${c.tournament || 0}（共 ${c.total || 0}）\n` +
        `  收件人 ${report.recipients || 0} · 站内信 ${report.inbox || 0} · 推送成功 ${report.pushed || 0}`
    );
    const skipped = Object.entries(report.skipped || {});
    if (skipped.length) {
      console.log('  跳过：' + skipped.map(([k, v]) => `${k}=${v}`).join(' '));
    }
    if (report.reason === 'no_new') console.log('  这段时间没有新内容，什么都没发。');
    if ((report.errors || []).length) console.warn('  部分统计失败：' + report.errors.join('；'));

    // 有跳过 + 有内容 = 有人本该收到却没收到（额度/绑定问题），用非 0 退出码
    // 让 pm2 / 监控能看出来；no_new 属于正常，不报警。
    const worthAttention =
      c.total > 0 && report.recipients > 0 && report.pushed === 0 && !dryRun;
    if (worthAttention) {
      console.warn('  ⚠ 有内容、有收件人，但一条都没发出去 —— 去后台「推送记录」看跳过原因。');
    }
  } catch (e) {
    console.error('[error] 汇总失败:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    // 不关连接池进程会挂着不退，pm2 会当成常驻进程
    if (pool && typeof pool.end === 'function') {
      try {
        await pool.end();
      } catch (e) {
        /* 忽略 */
      }
    }
  }
})();
