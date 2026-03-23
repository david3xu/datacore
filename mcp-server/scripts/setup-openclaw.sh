#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEV_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
OPENCLAW_DIR="${DEV_DIR}/openclaw"
TSX_LOADER="${OPENCLAW_DIR}/node_modules/tsx/dist/loader.mjs"
SCRIPT_PATH="${SCRIPT_DIR}/setup-openclaw.ts"

if [[ ! -f "${TSX_LOADER}" ]]; then
  echo "OpenClaw tsx loader not found at ${TSX_LOADER}" >&2
  exit 1
fi

exec node --import "${TSX_LOADER}" "${SCRIPT_PATH}" "$@"
