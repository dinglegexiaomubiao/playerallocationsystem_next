#!/bin/bash
#
# 一键部署到阿里云服务器（带自动备份 + 构建失败自动回滚）
#
# 用法（在项目根目录执行）：
#   ./deploy/deploy.sh              # 常规更新（代码改动）
#   ./deploy/deploy.sh --deps       # 依赖有变化时（改了 package.json）
#   ./deploy/deploy.sh --skip-build # 跳过本地构建校验，赶时间用
#   ./deploy/deploy.sh --no-backup  # 不备份（省磁盘，不建议）
#
# 它做的事：
#   1. 本地打包源码（排除 node_modules / .next / .env.local 等）
#   2. scp 上传到服务器
#   3. 【服务器】把当前正在跑的版本快照到 /www/wwwroot/laroja-backups/<时间戳>/
#        - source.tar.gz  当前源码
#        - .next/         当前构建产物（135M 左右，直接复制，回滚时不用重新 build）
#        - meta.txt       时间 / 部署 commit / pm2 重启次数
#      只保留最近 5 个快照，更早的自动删掉
#   4. 解压新代码 → 构建 → 重启 PM2 → 健康检查
#   5. 如果构建失败，自动用刚才的快照回滚，站点不会挂着白屏
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
SERVER_BUILD=0
SKIP_DISK_CHECK=0
for arg in "$@"; do
  case "$arg" in
    --deps) WITH_DEPS=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    --no-backup) NO_BACKUP=1 ;;
    --server-build) SERVER_BUILD=1 ;;
    --force) SKIP_DISK_CHECK=1 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

# 磁盘写速阈值（MB/s）。正常 220~240，被限流时常常掉到几十。可用环境变量覆盖。
MIN_WRITE_MB="${DEPLOY_MIN_WRITE_MB:-100}"

# 产物从哪来：
#   local（默认）—— 本地构建好，产物传上去直接用。服务器只解压 + 原子切换，构建窗口≈0。
#     为什么默认这个：线上是 2 核 / 1.7G，服务器端构建要 5.4 分钟（本地只要 13 秒），
#     那 5.4 分钟里 next-server 抢不到 CPU，2026-10-23 实测一次部署产生 28 个 504 + 137 个
#     499（用户等不及主动断开）。本地产物传上去体积只有 2.8M，上传期间线上一个字都不动。
#   --server-build —— 回退到「在服务器上构建」。改动了原生依赖、或产物跨平台跑不起来时用。
BUILD_MODE=local
[ "$SERVER_BUILD" -eq 1 ] && BUILD_MODE=server
NEXT_TAR_NAME="laroja-next.tar.gz"
NEXT_TAR="/tmp/$NEXT_TAR_NAME"

# 切到项目根目录（脚本可能在 deploy/ 下被调用）
cd "$(dirname "$0")/.."

COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'nogit')"

echo "========================================"
echo " 部署到 $HOST"
echo " 版本 commit: $COMMIT"
echo " 时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"

# ---------- 0. 服务器磁盘测速（前置闸门）----------
# 2026-10-23 的教训：服务器全量构建打满云盘 BPS，内核进入无限 I/O 等待（启动参数
# nvme_core.io_timeout=4294967295 意味着请求永不超时，只会一直排队），整机假死 20 分钟
# —— ssh 发不出 banner、nginx 返回 000，只能去阿里云控制台重启，站点 502。
# 现在默认走「本地构建 + 传产物」，服务器不再跑 build，I/O 峰值小了很多；
# 但快照仍要复制产物，被限流时照样会卡，所以这道闸门保留。
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
    echo "    此时任何大 I/O 都会把内核拖进无限等待，sshd/nginx 一起死，只能重启机器。"
    echo "    等 30 分钟到几小时、额度恢复后再试。"
    echo "    确认要现在上：./deploy/deploy.sh --force（风险自负）"
    exit 1
  fi
  echo "  ✓ 写速 ${SPEED_MB}MB/s（≥ ${MIN_WRITE_MB}MB/s）"
fi

# ---------- 1. 本地构建 ----------
# 这一步不只是「校验」：BUILD_MODE=local 时，它产出的 .next 就是最终上线的产物，
# 服务器不会再构建一次。所以本地构建失败必须中止（半成品不能上线）。
if [ "$SKIP_BUILD" -eq 0 ]; then
  echo ""
  if [ "$BUILD_MODE" = "local" ]; then
    echo "[1/5] 本地构建（产物将直接上传，服务器不再构建）"
  else
    echo "[1/5] 本地构建校验（服务器会重新构建）"
  fi
  if ! NODE_OPTIONS= npm run build > /tmp/laroja-local-build.log 2>&1; then
    echo "  ✗ 本地构建失败，已中止。日志尾部："
    tail -20 /tmp/laroja-local-build.log
    exit 1
  fi
  if [ "$BUILD_MODE" = "local" ] && [ ! -f .next/BUILD_ID ]; then
    echo "  ✗ 构建没有产出 BUILD_ID，产物不完整，已中止"
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
  --exclude=.next-build --exclude=.next-prev \
  --exclude=.git --exclude=.workbuddy --exclude=.env.local \
  --exclude=logs --exclude='*.log' \
  --exclude='./测试的数据.json' --exclude='./测试的数据.txt' --exclude='./测试的数据.xlsx' \
  . 2>/dev/null
echo "  ✓ $(du -h "$TAR" | cut -f1) → $TAR"

# 产物也一起打包（只取运行必需的 server/static；cache 是 build 缓存，38M 且 next start 不用）
if [ "$BUILD_MODE" = "local" ]; then
  rm -f "$NEXT_TAR"
  tar -czf "$NEXT_TAR" --exclude=./cache --exclude=./dev -C .next . 2>/dev/null
  if [ ! -s "$NEXT_TAR" ]; then
    echo "  ✗ 产物打包失败，已中止"
    exit 1
  fi
  echo "  ✓ 构建产物 $(du -h "$NEXT_TAR" | cut -f1) → $NEXT_TAR"
fi

# ---------- 3. 上传 ----------
echo ""
echo "[3/5] 上传"
scp -i "$KEY" -o StrictHostKeyChecking=no -q "$TAR" "$HOST:/tmp/$TAR_NAME"
echo "  ✓ 已上传到 $HOST:/tmp/$TAR_NAME"
if [ "$BUILD_MODE" = "local" ]; then
  scp -i "$KEY" -o StrictHostKeyChecking=no -q "$NEXT_TAR" "$HOST:/tmp/$NEXT_TAR_NAME"
  echo "  ✓ 已上传产物到 $HOST:/tmp/$NEXT_TAR_NAME"
fi

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

# 快照要压几十 M 源码 + 复制约 14M 产物，是部署里最重的一次 I/O。
# 降优先级跑，保证 ssh/nginx 始终抢得到带宽（同第 2 节事故的教训）。
NICE="nice -n 15"
if command -v ionice > /dev/null 2>&1; then
  NICE="nice -n 15 ionice -c 2 -n 7"
fi

# 1) 源码快照（排除依赖/产物/密钥）
$NICE tar -czf "$SNAP/source.tar.gz" \
  --exclude=./node_modules --exclude=./.next --exclude=./.git \
  --exclude=./.next-build --exclude=./.next-prev \
  --exclude=./.cache --exclude=./.env.local --exclude=./logs --exclude='*.log' \
  . 2>/dev/null

# 2) 构建产物快照：回滚时直接换上就能跑，不用重新 build
#    ⚠ 必须排除 .next/cache（40M）：那是 Turbopack 的构建加速缓存，next start 不读、
#    回滚也用不上。不排除的话每次白复制 40M，5 个快照白占 200M 磁盘。
#    ⚠ 也不用硬链接 cp -al：切换时虽然用 mv，但服务器构建模式会原地覆盖 BUILD_ID /
#    build-manifest.json，硬链接会让快照跟着被改，回滚拿到半新半旧的东西。
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

# ---------- 5. 服务器：解压 → 落地产物 → 原子切换 → 重启（失败不动线上） ----------
echo ""
if [ "$BUILD_MODE" = "local" ]; then
  echo "[5/5] 服务器落地产物并重启"
else
  echo "[5/5] 服务器构建并重启"
fi

ssh $SSH_OPTS "$HOST" \
  "bash -s -- '$REMOTE_DIR' '$SNAP_ROOT' '$PM2_APP' '$TAR_NAME' '$WITH_DEPS' '$BUILD_MODE' '$NEXT_TAR_NAME'" <<'REMOTE'
set -e
REMOTE_DIR="$1"; SNAP_ROOT="$2"; PM2_APP="$3"; TAR_NAME="$4"; WITH_DEPS="$5"; BUILD_MODE="$6"; NEXT_TAR_NAME="$7"
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

# 5.2.5 备份当前静态产物
# 为什么要留：微信 / QQ 内置浏览器会把 HTML 缓存很久，用户手里那一页仍然引用旧 hash 的
# chunk。新构建会把旧文件删掉，于是它 404 → React 起不来 → 「页面看得见但按钮全按不动」。
# 2026-10-23 10:48 那次就是这么发生的（16 次 chunk 404 + 11 次 500）。
if [ -d .next/static ]; then
  rm -rf /tmp/laroja-static-prev
  cp -a .next/static /tmp/laroja-static-prev
  echo "  → 已备份上一版静态产物（$(du -sh /tmp/laroja-static-prev | cut -f1)）"
fi

# 5.3 准备新产物（NEW_DIR）
# ⚠ 绝不能原地 build：旧进程正在读 .next，`next build` 会边写边删，读到半成品的请求直接 500。
#   2026-10-23 10:48 那次部署就产生 11 个 `GET / 500` + 4 个 502 —— 用户看到的就是「报错 500」。
#   所以不管是下载产物还是服务器构建，一律先落到独立目录，最后再用 mv 原子切换。
NEW_DIR=".next-build"
rm -rf "$NEW_DIR"

if [ "$BUILD_MODE" = "local" ]; then
  # 5.3a 用本地构建好的产物
  # 好处不只是快：服务器 2 核，自己 build 要 5.4 分钟，那段时间 next-server 抢不到 CPU，
  # 实测一次部署产生 28 个 504 + 137 个 499。改用上传产物后构建窗口直接归零。
  if [ ! -s "/tmp/$NEXT_TAR_NAME" ]; then
    echo "  ✗ 没找到上传的产物包 /tmp/$NEXT_TAR_NAME，线上未动"
    exit 1
  fi
  mkdir -p "$NEW_DIR"
  tar -xzf "/tmp/$NEXT_TAR_NAME" -C "$NEW_DIR"
  rm -f "/tmp/$NEXT_TAR_NAME"
  if [ ! -f "$NEW_DIR/BUILD_ID" ]; then
    echo "  ✗ 上传的产物不完整（缺 BUILD_ID），线上未动"
    rm -rf "$NEW_DIR"
    exit 1
  fi
  echo "  → 产物已解压（BUILD_ID $(cat "$NEW_DIR/BUILD_ID")）"

  # ⚠ Turbopack 把 pg / xlsx / nodemailer 这类外部包写成 <包名>-<哈希> 的虚拟名，
  #   并在产物里放一个 node_modules 符号链接指向「构建机的绝对路径」。
  #   在 Windows 上构建时那个链接长这样：pg-587764f78a6c7a9c -> /e/lzf/.../node_modules/pg
  #   传到 Linux 就是死链，API 全部 500（Cannot find module 'pg-587764f78a6c7a9c'）。
  #   这里改写成相对链接，指回服务器自己装好的 node_modules。
  if [ -d "$NEW_DIR/node_modules" ]; then
    FIXED=0
    for d in "$NEW_DIR"/node_modules/*; do
      [ -L "$d" ] || continue
      tgt=$(readlink "$d" | tr '\\' '/')
      pkg=$(basename "$tgt")
      rm -f "$d"
      ln -s "../../node_modules/$pkg" "$d"
      FIXED=$((FIXED + 1))
    done
    # 链接改完必须真的能解析，否则上线就是一片 500
    for d in "$NEW_DIR"/node_modules/*; do
      [ -L "$d" ] || continue
      if [ ! -f "$d/package.json" ]; then
        echo "  ✗ 外部模块 $(basename "$d") 无法解析到 node_modules，线上未动"
        echo "    可改用 --server-build 重新部署"
        rm -rf "$NEW_DIR"
        exit 1
      fi
    done
    echo "  → $FIXED 个外部模块链接已指回 node_modules"
  fi
else
  # 5.3b 回退方案：在服务器上构建（慢，但原生依赖/跨平台出问题时的保底）
  echo "  → 服务器构建模式（约 5 分钟，这期间服务仍可用但会变慢）"
  BUILD_OK=1
  NODE_OPTIONS=--max-old-space-size=1024 NEXT_DIST_DIR="$NEW_DIR" npm run build > /tmp/laroja-build.log 2>&1 || BUILD_OK=0
  # BUILD_ID 是「构建真的产出了完整产物」的铁证，光看退出码不够（postscript 失败也会非 0）
  [ -f "$NEW_DIR/BUILD_ID" ] || BUILD_OK=0
  if [ "$BUILD_OK" != "1" ]; then
    echo "  ✗ 服务器构建失败，日志尾部："
    tail -30 /tmp/laroja-build.log
    # 关键：这次 .next 完全没被碰过，站点还在正常跑，不需要回滚也不需要重启
    rm -rf "$NEW_DIR"
    echo "  ✓ 线上产物未被触碰，站点仍返回 $(health)（源码已更新，下次成功后生效）"
    exit 1
  fi
  echo "  → 构建完成"
fi

# 5.3.1 把上一版独有的 chunk 合并进新产物（-n 不覆盖新版同名文件）
# 这样还开着旧页面的用户也能把 JS 加载完、水合成功，不必等自己手动刷新。
if [ -d /tmp/laroja-static-prev ]; then
  mkdir -p "$NEW_DIR/static"
  cp -an /tmp/laroja-static-prev/. "$NEW_DIR/static/" 2>/dev/null || true
  rm -rf /tmp/laroja-static-prev
fi
# 只留两周内的：更老的 chunk 不可能还有活跃页面在引用，没必要一直占空间
find "$NEW_DIR/static" -type f -mtime +14 -delete 2>/dev/null || true
echo "  → 静态产物 $(du -sh "$NEW_DIR/static" | cut -f1)（含上一版 chunk，旧页面不会 404）"

# 5.3.2 原子切换：rename 是瞬间的，旧进程手里的 inode 不受影响，
# 真正会 5xx 的窗口只剩「切换 → pm2 restart 完成」这一两秒（原来有二十秒）
rm -rf .next-prev
# set -e 下别写 `[ -d .next ] && mv ...`：条件为假时整句返回 1 会直接退出脚本
if [ -d .next ]; then mv .next .next-prev; fi
mv "$NEW_DIR" .next
rm -rf .next-prev
echo "  → 产物已切换"

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
  echo "  ✗ 站点返回 $CODE"
  # 切换后仍不健康 = 新产物在运行时炸了（外部模块没指回 node_modules、缺环境变量、
  # 代码 bug）。这时线上已经是坏的，必须退回快照 —— 只打一行警告等于把 502 留在
  # 线上等人发现（2026-10-23 就这么躺了二十分钟）。
  if [ -n "$SNAP" ] && [ -d "$SNAP/.next" ]; then
    echo "  ↺ 自动回滚到 $SNAP ..."
    pm2 stop "$PM2_APP" > /dev/null 2>&1 || true
    rm -rf .next
    cp -a "$SNAP/.next" .next
    tar -xzf "$SNAP/source.tar.gz"
    pm2 restart "$PM2_APP" --update-env > /dev/null 2>&1 || pm2 start "$PM2_APP" > /dev/null 2>&1 || true
    sleep 4
    echo "  ✓ 已回滚，站点返回 $(health)"
    echo "    排查日志：pm2 logs $PM2_APP --lines 50"
  else
    echo "  ⚠ 没有可用快照，请手动回滚：./deploy/rollback.sh"
    echo "    日志：pm2 logs $PM2_APP --lines 50"
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
