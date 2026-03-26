#!/bin/bash
# daily-sync.sh — Full pipeline: export → upload → trigger Auto Loader
# Run daily via launchd or manually.
# Requires: az login, DATABRICKS_HOST, DATABRICKS_TOKEN

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$HOME/.datacore/logs"
LOG_FILE="$LOG_DIR/daily-sync.log"
mkdir -p "$LOG_DIR"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" | tee -a "$LOG_FILE"; }

# retry_curl — exponential backoff with full jitter.
# Usage: retry_curl [curl args...]
# Retries on non-zero exit code or HTTP 5xx / 429.
# Base: 2s  Cap: 60s  Max attempts: 5
retry_curl() {
  local attempt=1
  local max_attempts=5
  local base=2
  local cap=60
  local http_code output tmpfile

  while [ "$attempt" -le "$max_attempts" ]; do
    tmpfile=$(mktemp)
    http_code=$(curl -s -o "$tmpfile" -w "%{http_code}" "$@")
    output=$(cat "$tmpfile")
    rm -f "$tmpfile"

    # Success: 2xx or 3xx
    if echo "$http_code" | grep -qE '^[23]'; then
      echo "$output"
      return 0
    fi

    # Non-retriable: 4xx (caller error)
    if echo "$http_code" | grep -qE '^4' && [ "$http_code" != "429" ]; then
      log "  curl: non-retriable HTTP $http_code on attempt $attempt"
      echo "$output"
      return 1
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
      # Full jitter: delay = random(0, min(cap, base * 2^attempt))
      local window=$(( base * (1 << attempt) ))
      [ "$window" -gt "$cap" ] && window=$cap
      local delay=$(( RANDOM % (window + 1) ))
      log "  curl: HTTP ${http_code} — retry $attempt/$max_attempts in ${delay}s"
      sleep "$delay"
    else
      log "  curl: HTTP ${http_code} — all $max_attempts attempts exhausted"
      echo "$output"
      return 1
    fi

    attempt=$(( attempt + 1 ))
  done
}


log "=== Daily sync started ==="

# Step 1: Export per-day JSONL
log "Step 1: Export Bronze → per-day JSONL"
node "$SCRIPT_DIR/export-daily.mjs" 2>&1 | tee -a "$LOG_FILE"

# Step 2: Upload to ADLS Gen2
log "Step 2: Upload to ADLS Gen2"
bash "$SCRIPT_DIR/upload-to-adls.sh" 2>&1 | tee -a "$LOG_FILE"

# Step 3: Trigger Databricks Job (Auto Loader notebook)
log "Step 3: Trigger Databricks Auto Loader"

if [ -z "$DATABRICKS_HOST" ] || [ -z "$DATABRICKS_TOKEN" ]; then
  log "ERROR: DATABRICKS_HOST and DATABRICKS_TOKEN must be set"
  exit 1
fi

# Check if job exists, create if not
JOB_NAME="datacore-daily-ingest"
JOB_ID=$(retry_curl "$DATABRICKS_HOST/api/2.1/jobs/list?name=$JOB_NAME" \
  -H "Authorization: Bearer $DATABRICKS_TOKEN" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
jobs = d.get('jobs', [])
print(jobs[0]['job_id'] if jobs else '')
" 2>/dev/null)

if [ -z "$JOB_ID" ]; then
  log "  Creating Databricks Job: $JOB_NAME"
  
  # Upload notebook to workspace first
  NOTEBOOK_PATH="/Users/291928k@curtin.edu.au/datacore/03-autoloader-ingest"
  NOTEBOOK_FILE="$SCRIPT_DIR/../../notebooks/03-autoloader-ingest.py"
  
  CONTENT=$(base64 < "$NOTEBOOK_FILE")
  retry_curl -X POST "$DATABRICKS_HOST/api/2.0/workspace/mkdirs" \
    -H "Authorization: Bearer $DATABRICKS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"path\": \"/Users/291928k@curtin.edu.au/datacore\"}" > /dev/null

  retry_curl -X POST "$DATABRICKS_HOST/api/2.0/workspace/import" \
    -H "Authorization: Bearer $DATABRICKS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"path\": \"$NOTEBOOK_PATH\",
      \"format\": \"SOURCE\",
      \"language\": \"PYTHON\",
      \"content\": \"$CONTENT\",
      \"overwrite\": true
    }" > /dev/null
  log "  Uploaded notebook to $NOTEBOOK_PATH"

  # Find our cluster
  CLUSTER_ID=$(retry_curl "$DATABRICKS_HOST/api/2.0/clusters/list" \
    -H "Authorization: Bearer $DATABRICKS_TOKEN" \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d.get('clusters', []):
    if c.get('custom_tags', {}).get('project') == 'datacore':
        print(c['cluster_id']); break
" 2>/dev/null)

  # Create the Job
  JOB_ID=$(retry_curl -X POST "$DATABRICKS_HOST/api/2.1/jobs/create" \
    -H "Authorization: Bearer $DATABRICKS_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\": \"$JOB_NAME\",
      \"existing_cluster_id\": \"$CLUSTER_ID\",
      \"notebook_task\": {
        \"notebook_path\": \"$NOTEBOOK_PATH\"
      },
      \"max_retries\": 1,
      \"timeout_seconds\": 1800
    }" | python3 -c "import sys,json; print(json.load(sys.stdin).get('job_id',''))")
  
  log "  Created Job ID: $JOB_ID (cluster: $CLUSTER_ID)"
fi

# Trigger the Job
log "  Triggering Job $JOB_ID"
RUN_ID=$(retry_curl -X POST "$DATABRICKS_HOST/api/2.1/jobs/run-now" \
  -H "Authorization: Bearer $DATABRICKS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"job_id\": $JOB_ID}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('run_id',''))")
log "  Run ID: $RUN_ID"

# Wait for Job to complete (polls every 30s, max 20 min)
for i in $(seq 1 40); do
  sleep 30
  STATE=$(retry_curl "$DATABRICKS_HOST/api/2.1/jobs/runs/get?run_id=$RUN_ID" \
    -H "Authorization: Bearer $DATABRICKS_TOKEN" \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
state = d.get('state', {})
life = state.get('life_cycle_state', '?')
result = state.get('result_state', '')
print(f'{life}|{result}')
")
  LIFECYCLE=$(echo "$STATE" | cut -d'|' -f1)
  RESULT=$(echo "$STATE" | cut -d'|' -f2)
  
  if [ "$LIFECYCLE" = "TERMINATED" ]; then
    if [ "$RESULT" = "SUCCESS" ]; then
      log "  Job completed: SUCCESS (${i}x30s)"
    else
      log "  Job completed: $RESULT (${i}x30s)"
    fi
    break
  fi
  echo "  [$i] $LIFECYCLE..."
done

log "=== Daily sync complete ==="
