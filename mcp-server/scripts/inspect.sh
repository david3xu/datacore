#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_LAUNCHER="${SCRIPT_DIR}/run-server.mjs"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required to launch MCP Inspector." >&2
  exit 1
fi

cd "${SCRIPT_DIR}/.."
exec npx @modelcontextprotocol/inspector node "${SERVER_LAUNCHER}"
