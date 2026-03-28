#!/usr/bin/env bash
set -euo pipefail

# Sync MemoBridge events from Databricks into local Datacore Bronze
# Requires environment variables:
#   DATABRICKS_HOST   (e.g., community.cloud.databricks.com)
#   DATABRICKS_TOKEN  (PAT with SQL permissions)
#   MEMOBRIDGE_TABLE  (default: default.memobridge_events)
#   MEMOBRIDGE_WAREHOUSE (Warehouse ID with SQL compute)
#   MEMOBRIDGE_CATALOG (optional catalog, default "")
#   MEMOBRIDGE_SCHEMA  (optional schema, default "")
#   SYNC_LIMIT        (optional number of rows, default 100)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}" )/.." && pwd)"
BRONZE_DIR="${DATACORE_BRONZE_DIR:-$HOME/.datacore/bronze}"
mkdir -p "$BRONZE_DIR"

: "${DATABRICKS_HOST:?Set DATABRICKS_HOST}"
: "${DATABRICKS_TOKEN:?Set DATABRICKS_TOKEN}"
: "${MEMOBRIDGE_WAREHOUSE:?Set MEMOBRIDGE_WAREHOUSE}"
TABLE="${MEMOBRIDGE_TABLE:-default.memobridge_events}"
SYNC_LIMIT="${SYNC_LIMIT:-100}"
MARKER_FILE="$HOME/.datacore/.memobridge-sync-marker"
LAST_TS="1970-01-01T00:00:00Z"
[[ -f "$MARKER_FILE" ]] && LAST_TS="$(cat "$MARKER_FILE")"

SQL="""
SELECT source, type, content, CAST(timestamp AS STRING) AS timestamp
FROM ${TABLE}
WHERE timestamp > TIMESTAMP '${LAST_TS}'
ORDER BY timestamp ASC
LIMIT ${SYNC_LIMIT}
"""

RESULT=$(curl -s -X POST "https://${DATABRICKS_HOST}/api/2.0/sql/statements/" \
  -H "Authorization: Bearer ${DATABRICKS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "statement": ${SQL@Q},
  "warehouse_id": "${MEMOBRIDGE_WAREHOUSE}",
  "wait_timeout": "30s"
}
EOF
)

STATE=$(echo "$RESULT" | jq -r '.status.state')
if [[ "$STATE" != "SUCCEEDED" ]]; then
  echo "Sync failed: $STATE" >&2
  echo "$RESULT" >&2
  exit 1
fi

ROWS=$(echo "$RESULT" | jq -c '.result.data_array[]?')
LAST_SYNCED="$LAST_TS"
FILE="$BRONZE_DIR/$(date +%Y-%m-%d).jsonl"

for ROW in $ROWS; do
  SOURCE=$(echo "$ROW" | jq -r '.[0] // "memobridge"')
  TYPE=$(echo "$ROW" | jq -r '.[1] // "conversation"')
  CONTENT=$(echo "$ROW" | jq -r '.[2] // ""')
  TS=$(echo "$ROW" | jq -r '.[3] // ""')
  LAST_SYNCED="$TS"
  EVENT_ID=$(uuidgen)
  cat >>"$FILE" <<JSON
{"source":"memobridge-import","type":"conversation","content":${CONTENT@Q},"timestamp":"$TS","context":{"origin":"memobridge","task":"DC-T2"},"_event_id":"$EVENT_ID","_timestamp":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
JSON
  echo "Imported row at $TS from $TABLE"
done

echo "$LAST_SYNCED" > "$MARKER_FILE"
echo "Sync complete. Last timestamp: $LAST_SYNCED"
