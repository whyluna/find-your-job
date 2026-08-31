#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "build" ]]; then
  # 个人本机构建安装使用 ad-hoc 签名；正式发布流水线通过环境变量使用 Developer ID。
  pnpm exec tauri "$@" --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'
  bash scripts/install-built-app.sh
else
  pnpm exec tauri "$@"
fi
