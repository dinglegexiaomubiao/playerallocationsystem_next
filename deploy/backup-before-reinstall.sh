#!/bin/bash
#
# 换系统盘之前的备份脚本（CentOS 7 + 宝塔 环境）
#
# 用法：
#   scp deploy/backup-before-reinstall.sh root@47.115.130.170:/root/
#   ssh root@47.115.130.170 'bash /root/backup-before-reinstall.sh'
#
# 产出：/root/pre-reinstall-YYYYMMDD-HHMMSS.tar.gz
# 下载：scp root@47.115.130.170:/root/pre-reinstall-*.tar.gz ./
#
# ⚠ 这个脚本只管「文件」。换系统盘前更应该做的是在阿里云控制台打一个
#   「云盘快照」—— 那是整盘镜像，能一键回滚，比这里的 tar 包完整得多。
#   快照 + 本脚本双保险，成本几乎为零。

set -u

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="/root/pre-reinstall-$STAMP"
ARCHIVE="/root/pre-reinstall-$STAMP.tar.gz"

mkdir -p "$WORK"
echo "备份目录：$WORK"
echo "----------------------------------------"

step() { echo ""; echo "[$1] $2"; }

# ---------- 1. Nginx 配置（站点 + 反代 + 全局） ----------
step 1 "Nginx 配置与反向代理规则"
if [ -d /www/server/panel/vhost/nginx ]; then
  tar -czf "$WORK/nginx-vhost.tar.gz" -C /www/server/panel/vhost nginx 2>/dev/null \
    && echo "  ✓ nginx-vhost.tar.gz（站点与反代）"
else
  echo "  - 未找到 /www/server/panel/vhost/nginx"
fi

if [ -d /www/server/nginx/conf ]; then
  tar -czf "$WORK/nginx-conf.tar.gz" -C /www/server/nginx conf 2>/dev/null \
    && echo "  ✓ nginx-conf.tar.gz（全局配置）"
fi

# ---------- 2. SSL 证书（重签要审核，优先级最高） ----------
step 2 "SSL 证书"
for d in /www/server/panel/vhost/cert /www/server/panel/vhost/ssl /etc/letsencrypt; do
  if [ -d "$d" ]; then
    name="$(basename "$d")"
    tar -czf "$WORK/ssl-$name.tar.gz" -C "$(dirname "$d")" "$name" 2>/dev/null \
      && echo "  ✓ ssl-$name.tar.gz（$d）"
  fi
done
[ -z "$(ls "$WORK"/ssl-*.tar.gz 2>/dev/null)" ] && echo "  - 未找到证书目录"

# ---------- 3. 网站目录 ----------
step 3 "网站目录 /www/wwwroot"
if [ -d /www/wwwroot ]; then
  SIZE="$(du -sm /www/wwwroot 2>/dev/null | cut -f1)"
  echo "  占用：${SIZE:-?} MB"
  echo "  内容："
  ls -1 /www/wwwroot 2>/dev/null | sed 's/^/    /'
  tar -czf "$WORK/wwwroot.tar.gz" -C /www wwwroot 2>/dev/null \
    && echo "  ✓ wwwroot.tar.gz"
else
  echo "  - 未找到 /www/wwwroot"
fi

# ---------- 4. 宝塔自身的备份 / 数据库导出 ----------
step 4 "宝塔备份与数据库"
if [ -d /www/server/panel/backup ]; then
  tar -czf "$WORK/bt-backup.tar.gz" -C /www/server/panel backup 2>/dev/null \
    && echo "  ✓ bt-backup.tar.gz"
fi
if command -v mysqldump >/dev/null 2>&1; then
  echo "  - 检测到 mysqldump，但 MySQL 服务当前未运行，跳过（如有数据请自行导出）"
fi

# ---------- 5. 环境快照（纯文本，最有用） ----------
step 5 "环境快照 info.txt"
{
  echo "===== 系统 ====="
  cat /etc/redhat-release 2>/dev/null
  uname -a
  echo ""
  echo "===== 内存 ====="
  free -h
  echo ""
  echo "===== 磁盘 ====="
  df -h
  echo ""
  echo "===== 宝塔组件 ====="
  ls -1 /www/server/ 2>/dev/null
  echo ""
  echo "===== Node 版本 ====="
  ls -1 /www/server/nodejs/ 2>/dev/null
  echo ""
  echo "===== 站点与反代目标 ====="
  grep -rn "proxy_pass\|server_name" /www/server/panel/vhost/nginx/ 2>/dev/null
  echo ""
  echo "===== 监听端口 ====="
  netstat -tlnp 2>/dev/null | head -25
  echo ""
  echo "===== crontab ====="
  crontab -l 2>/dev/null
  echo ""
  echo "===== hostname / hosts ====="
  hostname
  cat /etc/hosts
} > "$WORK/info.txt"
echo "  ✓ info.txt"

# ---------- 6. 打包 ----------
step 6 "打包"
tar -czf "$ARCHIVE" -C /root "$(basename "$WORK")" 2>/dev/null
rm -rf "$WORK"

if [ -f "$ARCHIVE" ]; then
  echo ""
  echo "================================================"
  echo "完成：$ARCHIVE"
  ls -lh "$ARCHIVE"
  echo "================================================"
  echo ""
  echo "下一步（在你自己电脑上执行，把文件下载回来）："
  echo "  scp root@47.115.130.170:$ARCHIVE ./"
  echo ""
  echo "⚠ 别忘了还在阿里云控制台给云盘打一个快照。"
else
  echo "打包失败，请检查磁盘空间：df -h"
  exit 1
fi
