#!/bin/bash
#
# 回滚到历史版本（配合 deploy.sh 的自动快照）
#
# 用法（在项目根目录执行）：
#   ./deploy/rollback.sh              # 回滚到「上一次部署前」的版本（最近快照）
#   ./deploy/rollback.sh --list       # 列出所有可回滚的版本
#   ./deploy/rollback.sh 20251021-114530
#
# 为什么快：deploy.sh 备份时把 .next（构建产物，135M）一起复制了，
# 回滚直接换目录，不需要重新 npm run build，通常 5~10 秒内站点恢复。
#
# 不会动 .env.local（快照时已排除），数据库也不受影响。
# 注意：.next 与源码会回到旧版，node_modules 不会（除非你事后自己 npm ci）。

set -euo pipefail

HOST="${DEPLOY_HOST:-root@47.115.130.170}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_laroja}"
REMOTE_DIR="/www/wwwroot/laroja"
SNAP_ROOT="/www/wwwroot/laroja-backups"
PM2_APP="laroja-site"
SSH_OPTS="-i $KEY -o StrictHostKeyChecking=no -o BatchMode=yes"
WANT="${1:-}"

# ---------- 列出备份 ----------
if [ "$WANT" = "--list" ] || [ "$WANT" = "-l" ]; then
  ssh $SSH_OPTS "$HOST" "bash -s -- '$SNAP_ROOT'" <<'LIST'
SNAP_ROOT="$1"
if [ ! -d "$SNAP_ROOT" ]; then
  echo "还没有任何备份（从没跑过新版 deploy.sh）"
  exit 0
fi
LAST=$(cat "$SNAP_ROOT/LAST" 2>/dev/null || echo '')
echo "备份目录：$SNAP_ROOT"
echo ""
for d in $(ls -1dt "$SNAP_ROOT"/*/ 2>/dev/null); do
  TS=$(basename "$d")
  MARK="  "
  [ "$TS" = "$LAST" ] && MARK="→ "
  SRC=$(du -sh "$d/source.tar.gz" 2>/dev/null | cut -f1 || echo '-')
  NXT=$(du -sh "$d/.next" 2>/dev/null | cut -f1 || echo '无')
  CMT=$(grep '^commit:' "$d/meta.txt" 2>/dev/null | awk '{print $2}' || echo '?')
  printf '%s%s  源码 %-6s 产物 %-6s commit %s\n' "$MARK" "$TS" "$SRC" "$NXT" "$CMT"
done
echo ""
echo "→ 表示 ./deploy/rollback.sh 不带参数时会回到的版本"
LIST
  exit 0
fi

# ---------- 执行回滚 ----------
echo "========================================"
echo " 回滚 $HOST"
echo "========================================"

ssh $SSH_OPTS "$HOST" \
  "bash -s -- '$SNAP_ROOT' '$REMOTE_DIR' '$PM2_APP' '$WANT'" <<'ROLLBACK'
set -e
SNAP_ROOT="$1"; REMOTE_DIR="$2"; PM2_APP="$3"; WANT="$4"

if [ -z "$WANT" ]; then
  WANT=$(cat "$SNAP_ROOT/LAST" 2>/dev/null || true)
fi
if [ -z "$WANT" ]; then
  echo "没有备份可用，先用新版 deploy.sh 部署一次才会产生备份。"
  exit 1
fi

SNAP="$SNAP_ROOT/$WANT"
if [ ! -d "$SNAP" ]; then
  echo "找不到备份：$SNAP"
  echo "可用版本："
  ls -1dt "$SNAP_ROOT"/*/ 2>/dev/null | xargs -r -n1 basename
  exit 1
fi

echo "目标版本：$WANT"
sed 's/^/  /' "$SNAP/meta.txt" 2>/dev/null || true
echo ""

cd "$REMOTE_DIR"

health() {
  curl -s -o /dev/null -w '%{http_code}' -k https://127.0.0.1 \
    -H 'Host: dota.playerallocationsystem.online' || echo '000'
}
echo "  → 回滚前站点返回 $(health)"

# 先停服务，避免半新半旧的 .next 被读到
pm2 stop "$PM2_APP" > /dev/null 2>&1 || true

if [ -d "$SNAP/.next" ]; then
  rm -rf .next
  cp -a "$SNAP/.next" .next
  echo "  → 已恢复构建产物"
else
  echo "  ⚠ 该版本没有 .next 快照，改为用旧源码重新构建"
fi

tar -xzf "$SNAP/source.tar.gz"
echo "  → 已恢复源码"

if [ ! -d .next ]; then
  echo "  → 重新构建（约 30 秒）"
  NODE_OPTIONS=--max-old-space-size=1024 npm run build > /tmp/laroja-build.log 2>&1 || {
    echo "  ✗ 构建失败，日志尾部："
    tail -30 /tmp/laroja-build.log
    exit 1
  }
fi

pm2 restart "$PM2_APP" --update-env > /dev/null 2>&1 || pm2 start "$PM2_APP" > /dev/null 2>&1 || true
sleep 3

CODE="000"
for i in 1 2 3; do
  CODE=$(health)
  [ "$CODE" = "200" ] && break
  sleep 3
done

if [ "$CODE" = "200" ]; then
  echo "  ✓ 回滚完成，站点返回 200"
else
  echo "  ⚠ 站点返回 $CODE，检查：pm2 logs $PM2_APP --lines 50"
fi
ROLLBACK

echo ""
echo "========================================"
echo " ✓ 回滚结束  $(date '+%H:%M:%S')"
echo "========================================"
