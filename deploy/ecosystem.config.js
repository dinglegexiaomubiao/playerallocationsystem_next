/**
 * PM2 配置：把 Next.js 以单进程方式跑在阿里云服务器上。
 *
 * 用法（在服务器项目目录下）：
 *   pm2 start deploy/ecosystem.config.js
 *   pm2 save
 *   pm2 startup          # 按提示执行它输出的那条命令，实现开机自启
 *
 * ⚠ 必须 instances: 1
 *   本项目的限流（lib/rate-limit.js）、列表缓存（lib/list-cache.js）、
 *   AI 分析缓存、图片内存缓存全部是「单进程内存」实现。
 *   开 cluster 多实例会导致：限流各算各的、缓存互相看不到、刚改的数据在
 *   另一个实例上读不到。redis 没引入之前，只能用单实例。
 *
 * ⚠ 数据库地址用内网
 *   同地域 ECS + RDS 走内网，延迟 1ms 以内。用公网地址会绕一圈，白迁。
 */
module.exports = {
  apps: [
    {
      name: 'laroja-site',
      // 直接用 next 的可执行入口，避免依赖全局 npm
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      // 宝塔面板的网站目录约定
      cwd: '/www/wwwroot/laroja',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      // 2G 内存的机器上，限制单进程堆大小，避免和 PostgreSQL 抢内存被 OOM Killer 干掉
      max_memory_restart: '450M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // 同机 PostgreSQL 不开 SSL；不设这个会连不上
        DATABASE_SSL: 'off',
        NODE_OPTIONS: '--max-old-space-size=512',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
