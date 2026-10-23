#!/bin/bash
#
# 一键部署到阿里云服务器（带自动备份 + 构建失败自动回滚）
#
# 用法（在项目根目录执行）：
#   ./deploy/deploy.sh              # 常规更新（代码改动）
#   ./deploy/deploy.sh --deps       # 依赖有变化时（改了 package.json）
#   ./deploy/deploy.sh --skip-build # 跳过本地构建校验，赶时间用
#   ./deploy/deploy.sh --no-backup  # 不备份（省磁盘，不建议）
#   ./deploy/deploy.sh --force      # 跳过服务器磁盘测速（有整机假死风险，慎用）
#
# 它做的事：
#   0. 量一下服务器磁盘写速，被限流就直接拒绝部署（见下）
#   1. 本地打包源码（排除 node_modules / .next / .env.local 等）
#   2. scp 上传到服务器
#   3. 【服务器】把当前正在跑的版本快照到 /www/wwwroot/laroja-backups/<时间戳>/
#        - source.tar.gz  当前源码
#        - .next/         当前构建产物（18M 左右，直接复制，回滚时不用重新 build）
#        - meta.txt       时间 / 部署 commit / pm2 重启次数
#      只保留最近 5 个快照，更早的自动删掉
#   4. 解压新代码 → 构建 → 校验产物完整性 → 重启 PM2 → 健康检查
#   5. 构建失败 / 产物不完整 / 健康检查不过，都会自动用快照回滚
#
# 回滚：./deploy/rollback.sh            # 回到上一次部署前的版本
#       ./deploy/rollback.sh --list     # 看有哪些备份可回
#       ./deploy/rollback.sh 20251021-114530
#
# 为什么不用 git pull：服务器在国内，访问 github.com 超时（实测 git ls-remote 20s 无响应）。
#
# ⚠ 不会覆盖服务器上的 .env.local（打包与快照都排除了它），环境变量安全。

set -euo pipefail

# 服务器地址与密钥支持用环境变量覆盖，便于换机器或多人协作：
#   DEPLOY_HOST=root@1.2.3.4 DEPLOY_KEY=~/.ssh/other ./deploy/deploy.sh
HOST="${DEPLOY_HOST:-root@47.115.130.170}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/id_ed25519_laroja}"
REMOTE_DIR="/www/wwwroot/laroja"
SNAP_ROOT="/www/wwwroot/laroja-backups"
KEEP="${DEPLOY_KEEP:-5}"          # 保留几个历史版本
TAR_NAME="laroja-deploy.tar.gz"
TAR="/tmp/$TAR_NAME"
PM2_APP="laroja-site"
SSH_OPTS="-i $KEY -o StrictHostKeyChecking=no -o BatchMode=yes"

WITH_DEPS=0
SKIP_BUILD=0
NO_BACKUP=0
SKIP_DISK_CHECK=0
for arg in "$@"; do
  case "$arg" in
    --deps) WITH_DEPS=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --no-backup) NO_BACKUP=1 ;;
    --force) SKIP_DISK_CHECK=1 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

# 磁盘写速阈值（MB/s）。正常 222，被限流通常掉到几十。可用环境变量覆盖。
MIN_WRITE_MB="${DEPLOY_MIN_WRITE_MB:-100}"

# 切到项目根目录（脚本可能在 deploy/ 下被调用）
cd "$(dirname "$0")/.."

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'nogit')"

echo "========================================"
echo " 部署到 $HOST"
echo " 版本 commit: $COMMIT"
echo " 时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# ---------- 0. 服务器磁盘测速（部署前置闸门）----------
# 2026-10-23 的教训：全量构建打满云盘 BPS，内核进入无限 I/O 等待（启动参数
# nvme_core.io_timeout=4294967295 意味着请求永不超时），整机假死 20 分钟 ——
# ssh 发不出 banner、nginx 返回 000，只能去阿里云控制台重启，站点 502。
# 所以部署前先量写速：被限流就直接拒绝，别等构建跑到一半才发现。
# 应急用 --force 跳过（等于接受整机假死的风险）。
if [ "$SKIP_DISK_CHECK" -eq 0 ]; then
  echo ""
  echo "[0/5] 服务器磁盘测速（阈值 ${MIN_WRITE_MB}MB/s）"
  SPEED_RAW=$(ssh $SSH_OPTS "$HOST" '
    OUT=$(dd if=/dev/zero of=/tmp/laroja-iotest bs=1M count=100 oflag=direct 2>&1 | tail -1)
    rm -f /tmp/laroja-iotest
    echo "$OUT" | sed -E "s/.* ([0-9.]+) ([kMG]B)\/s.*/\1 \2/"
  ' 2>/dev/null || echo '')
  SPEED_VAL=$(echo "$SPEED_RAW" | awk '{print $1}')
  SPEED_UNIT=$(echo "$SPEED_RAW" | awk '{print $2}')
  case "$SPEED_UNIT" in
    GB) SPEED_MB=$(awk "BEGIN{printf \"%.0f\", ${SPEED_VAL:-0}*1024}") ;;
    MB) SPEED_MB=$(awk "BEGIN{printf \"%.0f\", ${SPEED_VAL:-0}}") ;;
    kB) SPEED_MB=$(awk "BEGIN{printf \"%.0f\", ${SPEED_VAL:-0}/1024}") ;;
    *)  SPEED_MB=0 ;;
  esac

  if [ "$SPEED_MB" -lt "$MIN_WRITE_MB" ]; then
    echo "  ✗ 磁盘写速 ${SPEED_MB}MB/s（原始输出：${SPEED_RAW:-取不到}）"
    echo ""
    echo "    低于阈值 ${MIN_WRITE_MB}MB/s，云盘很可能正被限流（阿里云 SysDiskBPS 报警）。"
    echo "    此时构建会打满 I/O，内核把所有进程挂起，sshd/nginx 一起死，只能重启机器。"
    echo "    等 30 分钟到几小时、额度恢复后再试。"
    echo "    确认要现在上：./deploy/deploy.sh --force（风险自负）"
    exit 1
  fi
  echo "  ✓ 写速 ${SPEED_MB}MB/s（≥ ${MIN_WRITE_MB}MB/s）"
fi

# ---------- 1. 本地构建校验 ----------
if [ "$SKIP_BUILD" -eq 0 ]; then
  echo ""
  echo "[1/5] 本地构建校验（发现语法/类型错误，避免传坏代码上去）"
  if ! npm run build > /tmp/laroja-local-build.log 2>&1; then
    echo "  ✗ 本地构建失败，已中止。日志尾部："
    tail -20 /tmp/laroja-local-build.log
    exit 1
  fi
  echo "  ✓ 构建通过"
else
  echo ""
  echo "[1/5] 跳过本地构建校验"
fi

# ---------- 2. 打包 ----------
echo ""
echo "[2/5] 打包源码"
tar -czf "$TAR" \
  --exclude=node_modules --exclude=.next --exclude=.cache \
  --exclude=.git --exclude=.workbuddy --exclude=.env.local \
  --exclude=logs --exclude='*.log' \
  --exclude='./测试的数据.json' --exclude='./测试的数据.txt' --exclude='./测试的数据.xlsx' \
  . 2>/dev/null
echo "  ✓ $(du -h "$TAR" | cut -f1) → $TAR"

# ---------- 3. 上传 ----------
echo ""
echo "[3/5] 上传"
scp -i "$KEY" -o StrictHostKeyChecking=no -q "$TAR" "$HOST:/tmp/$TAR_NAME"
echo "  ✓ 已上传到 $HOST:/tmp/$TAR_NAME"

# ---------- 4. 服务器：快照当前版本 ----------
# 注意：必须在解压新代码「之前」做，否则备份下来的就是新代码。
echo ""
if [ "$NO_BACKUP" -eq 1 ]; then
  echo "[4/5] 跳过备份（--no-backup）"
else
  echo "[4/5] 备份当前线上版本"
  # 引号 heredoc + 位置参数：远端脚本里所有 $ 都是「远端变量」，不需要层层转义
  ssh $SSH_OPTS "$HOST" "bash -s -- '$SNAP_ROOT' '$KEEP' '$COMMIT' '$REMOTE_DIR'" <<'SNAPSHOT'
set -e
SNAP_ROOT="$1"; KEEP="$2"; COMMIT="$3"; REMOTE_DIR="$4"
cd "$REMOTE_DIR"

TS=$(date +%Y%m%d-%H%M%S)
SNAP="$SNAP_ROOT/$TS"
mkdir -p "$SNAP"

# 快照要压 38M 源码 + 复制约 14M 产物（已排除 40M 的 Turbopack 缓存），
# 是这次部署里第二个 I/O 高峰（第一个是构建）。同样降优先级，保证 ssh/nginx
# 始终抢得到带宽。
NICE="nice -n 15"
if command -v ionice > /dev/null 2>&1; then
  NICE="nice -n 15 ionice -c 2 -n 7"
fi

# 1) 源码快照（排除依赖/产物/密钥）
$NICE tar -czf "$SNAP/source.tar.gz" \
  --exclude=./node_modules --exclude=./.next --exclude=./.git \
  --exclude=./.cache --exclude=./.env.local --exclude=./logs --exclude='*.log' \
  . 2>/dev/null

# 2) 构建产物快照：回滚时不用重新 build，直接换上就能跑
#    ⚠ 必须排除 .next/cache（40M）：那是 Turbopack 的构建加速缓存，next start 不读、
#    回滚也用不上。不排除的话每次部署白复制 40M，5 个快照白占 200M 磁盘。
#    ⚠ 不能改用硬链接 cp -al：构建会原地覆盖 BUILD_ID / build-manifest.json 这些
#    同名文件，硬链接会让快照跟着一起被改，回滚时拿到半新半旧的东西。
if [ -d .next ]; then
  if command -v rsync > /dev/null 2>&1; then
    $NICE rsync -a --exclude=/cache .next/ "$SNAP/.next/"
  else
    $NICE cp -a .next "$SNAP/.next"
    rm -rf "$SNAP/.next/cache"
  fi
fi

# 3) 元信息
RESTARTS=$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const p=a.find(x=>x.name==="laroja-site");console.log(p?p.pm2_env.restart_time:"?")}catch(e){console.log("?")}})' 2>/dev/null || echo '?')
{
  echo "time:        $TS"
  echo "commit:      $COMMIT"
  echo "source:      $(du -sh "$SNAP/source.tar.gz" | cut -f1)"
  echo "next:        $(du -sh "$SNAP/.next" 2>/dev/null | cut -f1 || echo '-')"
  echo "pm2_restarts:$RESTARTS"
} > "$SNAP/meta.txt"

# 4) 记录「最近一次快照」，回滚脚本默认用它
echo "$TS" > "$SNAP_ROOT/LAST"

# 5) 只保留最近 KEEP 个，超出的删掉（只删自己备份目录里的东西）
ls -1dt "$SNAP_ROOT"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -rf "$old"
done

echo "  ✓ 快照 $TS（$(du -sh "$SNAP/source.tar.gz" | cut -f1) 源码 + $(du -sh "$SNAP/.next" 2>/dev/null | cut -f1 || echo '无产物') 产物）"
echo "  ✓ 当前保留 $(ls -1d "$SNAP_ROOT"/*/ 2>/dev/null | wc -l) 个历史版本"
SNAPSHOT
fi

# ---------- 5. 服务器：解压 → 构建 → 重启（失败自动回滚） ----------
echo ""
echo "[5/5] 服务器构建并重启"

ssh $SSH_OPTS "$HOST" \
  "bash -s -- '$REMOTE_DIR' '$SNAP_ROOT' '$PM2_APP' '$TAR_NAME' '$WITH_DEPS'" <<'REMOTE'
set -e
REMOTE_DIR="$1"; SNAP_ROOT="$2"; PM2_APP="$3"; TAR_NAME="$4"; WITH_DEPS="$5"
cd "$REMOTE_DIR"

SNAP=""
if [ -s "$SNAP_ROOT/LAST" ]; then
  SNAP="$SNAP_ROOT/$(cat "$SNAP_ROOT/LAST")"
fi

health() {
  curl -s -o /dev/null -w '%{http_code}' -k https://127.0.0.1 \
    -H 'Host: dota.playerallocationsystem.online' || echo '000'
}

# 5.1 解压新代码
# tar 解压只覆盖、不删除：本地删掉的文件（尤其是 pages/api 下的路由）会继续留在服务器上，
# 照样被构建进产物、照样能被外部访问。
# 注意：`tar -tzf .` 列出的路径带 `./` 前缀，必须先剥掉再和 find 的结果比，
# 否则清单匹配为空 —— 会把源码目录整个清空（2026-10-21 踩过一次，站点直接 500）。
tar -tzf "/tmp/$TAR_NAME" | sed 's|^\./||' | grep -E '^(pages|lib|components|hooks|styles|utils)/' | sort -u > /tmp/laroja-manifest.txt
MANIFEST_COUNT=$(wc -l < /tmp/laroja-manifest.txt)
tar -xzf "/tmp/$TAR_NAME"
rm -f "/tmp/$TAR_NAME"
if [ "$MANIFEST_COUNT" -lt 20 ]; then
  echo "  ⚠ 源码清单只有 $MANIFEST_COUNT 条，疑似解析异常，跳过残留清理"
else
  for d in pages lib components hooks styles utils; do
    [ -d "$d" ] || continue
    find "$d" -type f | sort > /tmp/laroja-disk.txt
    comm -13 /tmp/laroja-manifest.txt /tmp/laroja-disk.txt | while read -r f; do
      [ -n "$f" ] && rm -f "$f" && echo "  → 删除本地已移除的残留 $f"
    done
  done
fi
rm -f /tmp/laroja-manifest.txt /tmp/laroja-disk.txt
echo "  → 代码已更新"

# 5.2 依赖
if [ "$WITH_DEPS" = "1" ]; then
  echo "  → 安装依赖"
  npm ci --no-audit --no-fund 2>&1 | tail -3
fi

# 5.3 构建；失败就回滚，绝不留一个跑不起来的站点
# ⚠ 必须降优先级跑（2026-10-23 踩过）：这台是低规格 ECS，云盘 BPS 有上限。
#   全量构建的并发读写会把 SysDiskBPS 打满（阿里云会发 StoragePerformanceReachLimit
#   报警），随后系统进入 I/O 等待 —— sshd 连 banner 都发不出来、nginx 直接 000，
#   整机假死，只能去控制台重启，站点 502 二十分钟。
#   nice + ionice 让构建礼让交互进程，至少能保住 ssh 和 nginx 的 I/O。
BUILD_CMD="env NODE_OPTIONS=--max-old-space-size=1024 npm run build"
if command -v ionice > /dev/null 2>&1; then
  BUILD_CMD="nice -n 15 ionice -c 2 -n 7 $BUILD_CMD"
else
  BUILD_CMD="nice -n 15 $BUILD_CMD"
fi
echo "  → 构建命令：$BUILD_CMD"
if ! sh -c "$BUILD_CMD" > /tmp/laroja-build.log 2>&1; then
  echo "  ✗ 服务器构建失败，日志尾部："
  tail -30 /tmp/laroja-build.log
  if [ -n "$SNAP" ] && [ -d "$SNAP/.next" ]; then
    echo "  ↺ 自动回滚到 $SNAP ..."
    pm2 stop "$PM2_APP" > /dev/null 2>&1 || true
    rm -rf .next
    cp -a "$SNAP/.next" .next
    tar -xzf "$SNAP/source.tar.gz"
    pm2 restart "$PM2_APP" --update-env > /dev/null 2>&1 || pm2 start "$PM2_APP" > /dev/null 2>&1 || true
    sleep 4
    echo "  ✓ 已回滚，站点返回 $(health)"
  else
    echo "  ⚠ 没有可用快照，请手动处理：cd $REMOTE_DIR && pm2 restart $PM2_APP"
  fi
  exit 1
fi
echo "  → 构建完成"

# 5.3.1 产物完整性检查（2026-10-23 的教训）
# 构建被中断（例如整机 I/O 假死后重启）会留下一个没有 BUILD_ID、server/pages 为空的
# .next。pm2 照样能启动，但立刻崩溃循环，线上是 502，而脚本上一版还会打印「部署完成」。
# 所以构建成功不等于产物可用，必须验一下再重启。
if [ ! -s .next/BUILD_ID ] || [ -z "$(ls .next/server/pages 2>/dev/null)" ]; then
  echo "  ✗ 构建产物不完整（BUILD_ID 或 server/pages 缺失）"
  if [ -n "$SNAP" ] && [ -d "$SNAP/.next" ]; then
    echo "  ↺ 自动回滚到 $SNAP ..."
    pm2 stop "$PM2_APP" > /dev/null 2>&1 || true
    rm -rf .next
    cp -a "$SNAP/.next" .next
    tar -xzf "$SNAP/source.tar.gz"
    pm2 restart "$PM2_APP" --update-env > /dev/null 2>&1 || pm2 start "$PM2_APP" > /dev/null 2>&1 || true
    sleep 4
    echo "  ✓ 已回滚，站点返回 $(health)"
  else
    echo "  ⚠ 没有可用快照，请手动处理：cd $REMOTE_DIR && pm2 restart $PM2_APP"
  fi
  exit 1
fi
echo "  → 产物完整（BUILD_ID $(cat .next/BUILD_ID)，$(ls .next/server/pages | wc -l) 个页面）"

# 5.4 重启
pm2 restart "$PM2_APP" --update-env > /dev/null 2>&1
sleep 3

# 5.5 健康检查（给 3 次机会，Next 冷启动偶尔慢）
CODE="000"
for i in 1 2 3; do
  CODE=$(health)
  [ "$CODE" = "200" ] && break
  sleep 3
done

if [ "$CODE" = "200" ]; then
  echo "  ✓ 站点返回 200"
else
  # 健康检查失败也要回滚到底，别留一个 502 的站点在线上等人发现
  echo "  ✗ 站点返回 $CODE"
  if [ -n "$SNAP" ] && [ -d "$SNAP/.next" ]; then
    echo "  ↺ 自动回滚到 $SNAP ..."
    pm2 stop "$PM2_APP" > /dev/null 2>&1 || true
    rm -rf .next
    cp -a "$SNAP/.next" .next
    tar -xzf "$SNAP/source.tar.gz"
    pm2 restart "$PM2_APP" --update-env > /dev/null 2>&1 || pm2 start "$PM2_APP" > /dev/null 2>&1 || true
    sleep 4
    echo "  ✓ 已回滚，站点返回 $(health)"
  else
    echo "  ⚠ 没有可用快照，日志：pm2 logs $PM2_APP --lines 50"
  fi
  exit 1
fi
REMOTE

echo ""
echo "========================================"
echo " ✓ 部署完成  $(date '+%H:%M:%S')"
echo " https://dota.playerallocationsystem.online"
if [ "$NO_BACKUP" -eq 0 ]; then
  echo " 出问题随时回滚：./deploy/rollback.sh"
fi
echo "========================================"
