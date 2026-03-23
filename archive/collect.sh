#!/bin/bash
# collect.sh — Gather all local data sources into sample-data/ for upload to ADLS Gen2
# Run from: ~/Developer/datacore/
# After running: use upload.sh to push to Azure

set -e
SAMPLE_DIR="$(cd "$(dirname "$0")" && pwd)/sample-data"
DEV_DIR="/Users/291928k/david/Developer"

echo "=== Collecting data sources into $SAMPLE_DIR ==="
echo ""

# 1. OpenClaw sessions (JSONL)
echo "--- OpenClaw sessions ---"
mkdir -p "$SAMPLE_DIR/openclaw"
cp ~/.openclaw/agents/main/sessions/*.jsonl "$SAMPLE_DIR/openclaw/" 2>/dev/null && \
  echo "  Copied $(ls "$SAMPLE_DIR/openclaw/"*.jsonl | wc -l | tr -d ' ') session files" || \
  echo "  No JSONL sessions found"

# Copy config audit log too (rich event data)
cp ~/.openclaw/logs/config-audit.jsonl "$SAMPLE_DIR/openclaw/" 2>/dev/null && \
  echo "  Copied config-audit.jsonl" || true


# 2. Git commits (all projects)
echo "--- Git commits ---"
mkdir -p "$SAMPLE_DIR/git"
for repo in openclaw azure-conflux blog datacore buildinpublic; do
  REPO_PATH="$DEV_DIR/$repo"
  if [ -d "$REPO_PATH/.git" ]; then
    git -C "$REPO_PATH" log --all \
      --format='{"hash":"%H","author":"%an","date":"%aI","message":"%s","repo":"'"$repo"'"}' \
      > "$SAMPLE_DIR/git/${repo}-commits.json"
    LINES=$(wc -l < "$SAMPLE_DIR/git/${repo}-commits.json" | tr -d ' ')
    echo "  $repo: $LINES commits"
  fi
done

# 3. Claude transcripts (manual step — user needs to export from claude.ai)
echo "--- Claude transcripts ---"
mkdir -p "$SAMPLE_DIR/claude"
if [ -d "/mnt/transcripts" ] && ls /mnt/transcripts/*.txt >/dev/null 2>&1; then
  cp /mnt/transcripts/*.txt "$SAMPLE_DIR/claude/"
  echo "  Copied $(ls "$SAMPLE_DIR/claude/"*.txt | wc -l | tr -d ' ') transcript files"
else
  echo "  NOTE: Claude transcripts not found at /mnt/transcripts/"
  echo "  Export from claude.ai → Settings → Export data"
  echo "  Place .txt files in $SAMPLE_DIR/claude/"
fi


# 4. LinkedIn/DEV.to content metadata
echo "--- Content metadata ---"
mkdir -p "$SAMPLE_DIR/content"
cp "$DEV_DIR/buildinpublic/linkedin/post-log.md" "$SAMPLE_DIR/content/" 2>/dev/null && \
  echo "  Copied LinkedIn post log" || true

# 5. Project docs (decisions, research, design docs)
echo "--- Project docs ---"
mkdir -p "$SAMPLE_DIR/docs"
for doc in decisions.md workflow.md project-map.md data-layers.md backlog.md; do
  cp "$DEV_DIR/docs/$doc" "$SAMPLE_DIR/docs/" 2>/dev/null && \
    echo "  Copied $doc" || true
done

# Summary
echo ""
echo "=== Collection complete ==="
echo ""
find "$SAMPLE_DIR" -type f | wc -l | xargs echo "Total files:"
du -sh "$SAMPLE_DIR" | awk '{print "Total size:", $1}'
echo ""
echo "Next: ./upload.sh to push to ADLS Gen2"
