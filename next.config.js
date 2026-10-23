/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.1.96'],
  /**
   * 生产部署时构建到独立目录（.next-build），构建完再原子 mv 成 .next。
   * 为什么：旧进程正在读 .next，原地 build 会让「构建期间访问的用户」拿到 500
   * （2026-10-23 那次部署实测 11 个 GET / 500）。
   * 本地开发 / 本地 build 不设这个变量，仍然用默认 .next，行为不变。
   */
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

module.exports = nextConfig;
