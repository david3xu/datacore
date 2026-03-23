#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCLAW_DIR="$(cd "$SCRIPT_DIR/../../../openclaw" && pwd)"
TSX_LOADER="$OPENCLAW_DIR/node_modules/tsx/dist/loader.mjs"

node --import "$TSX_LOADER" "$SCRIPT_DIR/openclaw-smoke.ts"
