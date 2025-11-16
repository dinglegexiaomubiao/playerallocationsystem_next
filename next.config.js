/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // 使用webpack而不是turbopack
    turbo: false
  }
  // 移除可能导致问题的webpack配置
};

module.exports = nextConfig;