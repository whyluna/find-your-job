#!/usr/bin/env bash
set -euo pipefail

pnpm exec tauri "$@"

if [[ "${1:-}" == "build" ]]; then
  bash scripts/install-built-app.sh
fi
