#!/usr/bin/env bash
set -euo pipefail

fyj_repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
fyj_built_app="$fyj_repo_dir/src-tauri/target/release/bundle/macos/FindYourJob.app"
fyj_installed_app="/Applications/FindYourJob.app"
fyj_built_exec="$fyj_built_app/Contents/MacOS/find-your-job"
fyj_installed_exec="$fyj_installed_app/Contents/MacOS/find-your-job"

if [[ ! -d "$fyj_built_app" ]]; then
  echo "未找到构建产物：$fyj_built_app" >&2
  exit 1
fi

# 只停止这两个明确路径下的 FindYourJob，不影响其他同名进程。
for fyj_pid in $(pgrep -x find-your-job 2>/dev/null || true); do
  fyj_command="$(ps -p "$fyj_pid" -o command= 2>/dev/null || true)"
  if [[ "$fyj_command" == "$fyj_built_exec" || "$fyj_command" == "$fyj_installed_exec" ]]; then
    kill -TERM "$fyj_pid" 2>/dev/null || true
  fi
done

for _fyj_attempt in {1..50}; do
  fyj_running=false
  for fyj_pid in $(pgrep -x find-your-job 2>/dev/null || true); do
    fyj_command="$(ps -p "$fyj_pid" -o command= 2>/dev/null || true)"
    if [[ "$fyj_command" == "$fyj_built_exec" || "$fyj_command" == "$fyj_installed_exec" ]]; then
      fyj_running=true
      break
    fi
  done
  [[ "$fyj_running" == false ]] && break
  sleep 0.1
done

if [[ "$fyj_running" == true ]]; then
  echo "FindYourJob 仍在运行，已取消替换。请退出应用后重试。" >&2
  exit 1
fi

fyj_stage_dir="$(mktemp -d /Applications/.find-your-job-install.XXXXXX)"
fyj_staged_app="$fyj_stage_dir/FindYourJob.app"
fyj_previous_app="$fyj_stage_dir/previous.app"

cleanup_fyj_stage() {
  if [[ -d "$fyj_previous_app" && ! -d "$fyj_installed_app" ]]; then
    mv "$fyj_previous_app" "$fyj_installed_app"
  fi
  rm -rf -- "$fyj_stage_dir"
}
trap cleanup_fyj_stage EXIT

ditto "$fyj_built_app" "$fyj_staged_app"
codesign --verify --deep --strict "$fyj_staged_app"

if [[ -d "$fyj_installed_app" ]]; then
  mv "$fyj_installed_app" "$fyj_previous_app"
fi
mv "$fyj_staged_app" "$fyj_installed_app"
codesign --verify --deep --strict "$fyj_installed_app"

rm -rf -- "$fyj_previous_app"
rm -rf -- "$fyj_built_app"
trap - EXIT
rm -rf -- "$fyj_stage_dir"

echo "已安装到 ${fyj_installed_app}，并删除构建目录中的 App 副本。"
