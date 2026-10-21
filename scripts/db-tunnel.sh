#!/bin/bash
#
# 本地开发连线上库：把服务器的 127.0.0.1:5432 映射到本地 15432。
#
# 为什么需要这个：线上 Postgres 只监听服务器自己的回环地址，安全组也没放行 5432，
# 所以本地不能直连，只能走 SSH 隧道。
#
# 用法：
#   npm run db:tunnel          # 前台占用，Ctrl+C 断开
#   DEPLOY_HOST=root@1.2.3.4 TUNNEL_PORT=25432 bash scripts/db-tunnel.sh
#
# 配套的 .env.local：
#   DATABASE_URL=postgresql://laroja:<密码>@127.0.0.1:15432/laroja
#   DATABASE_SSL=off      （隧道内是明文回环，不需要 SSL）
#
# ⚠ 这是一条**直通生产库**的通道：本地跑写入脚本会真的改线上数据。
#   跑迁移、批量导入、测试脚本前先想清楚，或者先 `pm2 stop laroja-site` + 备份。

set -euo pipefail

KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_laroja}"
HOST="${DEPLOY_HOST:-root@47.115.130.170}"
PORT="${TUNNEL_PORT:-15432}"

if [ ! -f "$KEY" ]; then
  echo "找不到密钥 $KEY（可用 DEPLOY_KEY 指定）" >&2
  exit 1
fi

echo "隧道: 本地 $PORT → $HOST:127.0.0.1:5432"
echo "说明: 连的是线上库，写入会直接生效。Ctrl+C 断开。"
echo ""

# ExitOnForwardFailure: 端口被占用时立刻失败，而不是假装连上了
# ServerAliveInterval: 网络抖动时自动保活，否则查询会卡死
exec ssh -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o StrictHostKeyChecking=no \
  -i "$KEY" \
  -L "$PORT:127.0.0.1:5432" \
  "$HOST"
