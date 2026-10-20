#!/bin/bash
#
# 一键部署到阿里云服务器
#
# 用法（在项目根目录执行）：
#   ./deploy/deploy.sh              # 常规更新（代码改动）
#   ./deploy/deploy.sh --deps       # 依赖有变化时（改了 package.json）
#   ./deploy/deploy.sh --skip-build # 跳过本地构建校验，赶时间用
#
# 它做的事：
#   1. 本地打包源码（排除 node_modules / .next / .env.local 等）
#   2. scp 上传到服务器
#   3. 服务器上解压 → 构建 → 重启 PM2
#
# 为什么不用 git pull：服务器在国内，访问 github.com 超时（实测 git ls-remote 20s 无响应）。
#
# ⚠ 不会覆盖服务器上的 .env.local（打包时已排除），环境变量安全。

set -euo pipefail

# 服务器地址与密钥支持用环境变量覆盖，便于换机器或多人协作：
#   DEPLOY_HOST=root@1.2.3.4 DEPLOY_KEY=~/.ssh/other ./deploy/deploy.sh
HOST="${DEPLOY_HOST:-root@47.115.130.170}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_laroja}"
REMOTE_DIR="/www/wwwroot/laroja"
TAR_NAME="laroja-deploy.tar.gz"
TAR="/tmp/$TAR_NAME"
PM2_APP="laroja-site"

WITH_DEPS=0
SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --deps) WITH_DEPS=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

# 切到项目根目录（脚本可能在 deploy/ 下被调用）
cd "$(dirname "$0")/.."

echo "========================================"
echo " 部署到 $HOST"
echo " 时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# ---------- 1. 本地构建校验 ----------
if [ "$SKIP_BUILD" -eq 0 ]; then
  echo ""
  echo "[1/4] 本地构建校验（发现语法/类型错误，避免传坏代码上去）"
  if ! npm run build > /tmp/laroja-local-build.log 2>&1; then
    echo "  ✗ 本地构建失败，已中止。日志尾部："
    tail -20 /tmp/laroja-local-build.log
    exit 1
  fi
  echo "  ✓ 构建通过"
else
  echo ""
  echo "[1/4] 跳过本地构建校验"
fi

# ---------- 2. 打包 ----------
echo ""
echo "[2/4] 打包源码"
tar -czf "$TAR" \
  --exclude=node_modules --exclude=.next --exclude=.cache \
  --exclude=.git --exclude=.workbuddy --exclude=.env.local \
  --exclude=logs --exclude='*.log' \
  --exclude='./测试的数据.json' --exclude='./测试的数据.txt' --exclude='./测试的数据.xlsx' \
  . 2>/dev/null
echo "  ✓ $(du -h "$TAR" | cut -f1) → $TAR"

# ---------- 3. 上传并解压 ----------
echo ""
echo "[3/4] 上传并解压"
scp -i "$KEY" -o StrictHostKeyChecking=no -q "$TAR" "$HOST:/tmp/$TAR_NAME"
ssh -i "$KEY" -o StrictHostKeyChecking=no -o BatchMode=yes "$HOST" \
  "cd '$REMOTE_DIR' && tar -xzf '/tmp/$TAR_NAME' && rm -f '/tmp/$TAR_NAME'"
rm -f "$TAR"
echo "  ✓ 已解压到 $REMOTE_DIR"

# ---------- 4. 服务器构建 + 重启 ----------
echo ""
echo "[4/4] 服务器构建并重启"
ssh -i "$KEY" -o StrictHostKeyChecking=no -o BatchMode=yes "$HOST" bash -s <<REMOTE
set -e
cd '$REMOTE_DIR'

if [ "$WITH_DEPS" -eq 1 ]; then
  echo "  → 安装依赖"
  npm ci --no-audit --no-fund 2>&1 | tail -3
fi

echo "  → 构建（约 10-30 秒）"
NODE_OPTIONS=--max-old-space-size=1024 npm run build > /tmp/laroja-build.log 2>&1 || {
  echo "  ✗ 服务器构建失败，保留旧版本运行。日志："
  tail -30 /tmp/laroja-build.log
  exit 1
}

echo "  → 重启 PM2"
pm2 restart $PM2_APP --update-env > /dev/null 2>&1
sleep 3

echo "  → 健康检查"
CODE=\$(curl -s -o /dev/null -w '%{http_code}' -k https://127.0.0.1 -H 'Host: dota.playerallocationsystem.online')
if [ "\$CODE" = "200" ]; then
  echo "  ✓ 站点返回 200"
else
  echo "  ⚠ 站点返回 \$CODE，请检查 pm2 logs $PM2_APP"
fi
REMOTE

echo ""
echo "========================================"
echo " ✓ 部署完成  $(date '+%H:%M:%S')"
echo " https://dota.playerallocationsystem.online"
echo "========================================"
