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
    /**
     * 每日汇总推送（小程序订阅消息）。
     *
     * ⚠ 和网站是**两个进程**，用途完全不同：
     *   网站常驻、接请求；这个只在 cron 触发时跑一次然后退出。
     *   所以 autorestart: false —— 设成 true 的话它跑完退出会被 pm2
     *   当成崩溃重启，一天几百次，还会重复发汇总。
     *
     * cron_restart 用的是**服务器本地时间**（这台机器是东八区），
     * 20:00 是「大家吃完饭、晚上开黑前」的那个点，太早没人看，太晚当天的局已经开始了。
     *
     * 装它（不会影响已经在跑的那个 app）：
     *   pm2 start deploy/ecosystem.config.js --only laroja-digest
     *   pm2 save
     */
    {
      name: 'laroja-digest',
      script: 'scripts/mp-digest.cjs',
      cwd: '/www/wwwroot/laroja',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false,
      cron_restart: '0 20 * * *',
      // 汇总只读库 + 调微信接口，内存很小；限一下防止意外的长任务吃内存
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        DATABASE_SSL: 'off',
        NODE_OPTIONS: '--max-old-space-size=384',
      },
      error_file: './logs/digest-error.log',
      out_file: './logs/digest-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
