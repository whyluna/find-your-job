#!/bin/bash
# FindYourJob 数据目录快照备份：~/Backups/findyourjob/<时间戳>/
# SQLite 使用在线 backup API，即使应用正在运行也不会复制出撕裂的 WAL 快照。
set -euo pipefail
SRC="$HOME/Library/Application Support/com.findyourjob"
DEST_ROOT="$HOME/Backups/findyourjob"
TS=$(date +%Y%m%d-%H%M%S)
DEST="$DEST_ROOT/$TS"
if [ ! -d "$SRC" ]; then
  echo "数据目录不存在: $SRC"; exit 1
fi
mkdir -p "$DEST"
sqlite3 "$SRC/findyourjob.db" ".backup '$DEST/findyourjob.db'"
rsync -a \
  --exclude 'findyourjob.db' \
  --exclude 'findyourjob.db-wal' \
  --exclude 'findyourjob.db-shm' \
  "$SRC/" "$DEST/"
integrity="$(sqlite3 "$DEST/findyourjob.db" 'PRAGMA integrity_check;')"
if [ "$integrity" != "ok" ]; then
  echo "备份数据库完整性检查失败: $integrity" >&2
  exit 1
fi
echo "已备份到 $DEST"
# 只保留最近 20 份
count=0
while IFS= read -r old_backup; do
  count=$((count + 1))
  if [ "$count" -gt 20 ]; then
    rm -rf -- "$old_backup"
  fi
done < <(find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??????-??????' -print | sort -r)
