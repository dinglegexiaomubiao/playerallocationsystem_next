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
  CMT=$(awk '/^commit:/{print $2; exit}' "$d/meta.txt" 2>/dev/null || echo '?')
  DEP=$(awk '/^deploying:/{print $2; exit}' "$d/meta.txt" 2>/dev/null || true)
  if [ -n "$DEP" ]; then
    # 新格式：commit = 快照内容真实版本，可以直接信
    CMT_TXT="commit $CMT"
  elif [ "$CMT" = "unknown" ] || [ -z "$CMT" ]; then
    CMT_TXT="commit 未知（旧格式快照）"
  else
    # 旧格式（2026-10-28 之前）：commit 行记的是「快照之后那次部署」的版本，
    # 和快照内容差一版。显示成 ~ 前缀，避免照着挑版本挑错。
    CMT_TXT="commit ~$CMT（旧格式，实际内容比它早一版）"
  fi
  printf '%s%s  源码 %-6s 产物 %-6s %s\n' "$MARK" "$TS" "$SRC" "$NXT" "$CMT_TXT"
done
echo ""
echo "→ 表示 ./deploy/rollback.sh 不带参数时会回到的版本"
echo "~ 表示该快照的 commit 号不可信（部署脚本早期版本留下的），按时间挑更稳"
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

# 版本标记跟着退回快照对应的版本，否则下次部署做快照时会把旧内容记成新 commit
# （2026-10-28 修：之前 meta.txt 的 commit 一直差一版，就是没人维护这个标记）。
# 旧格式快照无 deploying 行、commit=unknown，此时宁可删掉标记也不写错值。
SNAP_CMT=$(awk '/^commit:/{print $2; exit}' "$SNAP/meta.txt" 2>/dev/null || true)
SNAP_DEP=$(awk '/^deploying:/{print $2; exit}' "$SNAP/meta.txt" 2>/dev/null || true)
if [ -n "$SNAP_CMT" ] && [ "$SNAP_CMT" != "unknown" ] && [ -n "$SNAP_DEP" ]; then
  echo "$SNAP_CMT" > .deploy-version
  echo "  → 版本标记 .deploy-version = $SNAP_CMT"
else
  rm -f .deploy-version
  echo "  ⚠ 该快照不知道真实版本，已清除 .deploy-version（下次快照会记 unknown）"
fi

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
