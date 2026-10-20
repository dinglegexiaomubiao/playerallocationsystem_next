#!/bin/bash
#
# 每日数据库备份。同机部署时这是唯一的容灾手段，别省。
#
# 安装到 crontab（每天凌晨 3 点）：
#   crontab -e
#   0 3 * * * /bin/bash /www/wwwroot/laroja/deploy/backup-db.sh >> /www/backup/laroja/backup.log 2>&1
#
# 手动跑一次验证：
#   bash deploy/backup-db.sh
#
# 建议再加一步异地备份（本机磁盘挂了备份也没了）：
#   用 ossutil / rclone 把 $BACKUP_DIR 同步到 OSS，几行命令的事。

set -euo pipefail

APP_DIR="/www/wwwroot/laroja"
BACKUP_DIR="/www/backup/laroja"
KEEP_DAYS=14

# 宝塔装的 PostgreSQL 客户端路径，按实际版本改（ls /www/server/pgsql/bin/pg_dump）
PG_DUMP="/www/server/pgsql/bin/pg_dump"
[ -x "$PG_DUMP" ] || PG_DUMP="$(command -v pg_dump || echo /usr/bin/pg_dump)"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$APP_DIR/.env.local" ]; then
  echo "[$(date '+%F %T')] 失败：找不到 $APP_DIR/.env.local" >&2
  exit 1
fi

DB_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env.local" | head -1 | cut -d= -f2-)"
if [ -z "$DB_URL" ]; then
  echo "[$(date '+%F %T')] 失败：.env.local 里没有 DATABASE_URL" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/laroja-$STAMP.sql.gz"

echo "[$(date '+%F %T')] 开始备份 -> $OUT"
"$PG_DUMP" "$DB_URL" --no-owner --no-privileges --clean --if-exists | gzip > "$OUT"

# 空文件说明导出失败，不能让坏备份覆盖掉好备份的保留位
if [ ! -s "$OUT" ]; then
  echo "[$(date '+%F %T')] 失败：备份文件为空" >&2
  rm -f "$OUT"
  exit 1
fi

# 清理过期备份
find "$BACKUP_DIR" -name 'laroja-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[$(date '+%F %T')] 完成：$SIZE"

# 恢复方法（万一要用）：
#   gunzip -c /www/backup/laroja/laroja-YYYYMMDD-HHMMSS.sql.gz | psql "$DB_URL"
