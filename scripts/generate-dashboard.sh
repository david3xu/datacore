#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" )/.." && pwd)"
BRONZE_DIR="${DATACORE_BRONZE_DIR:-$HOME/.datacore/bronze}"
OUTPUT_DIR="$ROOT_DIR/docs/dashboard"
OUTPUT_FILE="$OUTPUT_DIR/tasks.json"

if [[ ! -d "$BRONZE_DIR" ]]; then
  echo "Bronze directory not found: $BRONZE_DIR" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
node "$ROOT_DIR/scripts/generate-dashboard.mjs" "$BRONZE_DIR" "$OUTPUT_FILE"
