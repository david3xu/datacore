#!/bin/bash
# upload-to-adls.sh — Sync exported daily JSONL files to ADLS Gen2 landing zone
# Uses az storage blob commands (already authenticated via az login)
# Only uploads new/changed files (azcopy sync)

set -e

STORAGE_ACCOUNT="datacore3kcfne4phgzua"
CONTAINER="landing"
REMOTE_DIR="bronze"
LOCAL_DIR="$HOME/.datacore/export/daily"
LOG_DIR="$HOME/.datacore/logs"

mkdir -p "$LOG_DIR"

echo "=== Upload to ADLS Gen2 ==="
echo "  Local:  $LOCAL_DIR"
echo "  Remote: abfss://$CONTAINER@$STORAGE_ACCOUNT.dfs.core.windows.net/$REMOTE_DIR/"

# Get storage key
STORAGE_KEY=$(az storage account keys list \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "rg-datacore" \
  --query '[0].value' -o tsv)

# Upload only new/changed files
UPLOADED=0
SKIPPED=0

for f in "$LOCAL_DIR"/*.jsonl; do
  BASENAME=$(basename "$f")
  REMOTE_PATH="$REMOTE_DIR/$BASENAME"
  
  # Check if remote file exists and has same size
  REMOTE_SIZE=$(az storage blob show \
    --container-name "$CONTAINER" \
    --name "$REMOTE_PATH" \
    --account-name "$STORAGE_ACCOUNT" \
    --account-key "$STORAGE_KEY" \
    --query "properties.contentLength" -o tsv 2>/dev/null || echo "0")
  LOCAL_SIZE=$(wc -c < "$f" | tr -d ' ')

  if [ "$REMOTE_SIZE" = "$LOCAL_SIZE" ]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  az storage blob upload \
    --container-name "$CONTAINER" \
    --name "$REMOTE_PATH" \
    --file "$f" \
    --account-name "$STORAGE_ACCOUNT" \
    --account-key "$STORAGE_KEY" \
    --overwrite true \
    --only-show-errors > /dev/null

  UPLOADED=$((UPLOADED + 1))
  echo "  ↑ $BASENAME ($LOCAL_SIZE bytes)"
done

echo ""
echo "  Uploaded: $UPLOADED"
echo "  Skipped:  $SKIPPED (already in sync)"
echo ""

# Log the sync
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) uploaded=$UPLOADED skipped=$SKIPPED" >> "$LOG_DIR/adls-sync.log"
