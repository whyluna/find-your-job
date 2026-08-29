#!/bin/bash
# FindYourJob 数据目录快照备份：~/Backups/findyourjob/<时间戳>/
set -euo pipefail
SRC="$HOME/Library/Application Support/com.findyourjob"
DEST_ROOT="$HOME/Backups/findyourjob"
TS=$(date +%Y%m%d-%H%M%S)
DEST="$DEST_ROOT/$TS"
if [ ! -d "$SRC" ]; then
  echo "数据目录不存在: $SRC"; exit 1
fi
mkdir -p "$DEST"
rsync -a --delete "$SRC/" "$DEST/"
echo "已备份到 $DEST"
# 只保留最近 20 份
ls -1dt "$DEST_ROOT"/*/ 2>/dev/null | tail -n +21 | xargs rm -rf 2>/dev/null || true
