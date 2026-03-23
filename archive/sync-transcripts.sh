#!/bin/bash
# sync-transcripts.sh — Called by Claude at start of each session
# Copies raw conversation transcripts from Claude container to Mac
# Claude runs: bash_tool reads /mnt/transcripts/ → writes to this directory
#
# This script just lists what we have locally so Claude knows what's new.
# Claude handles the actual copy (container → Mac) using its tools.

TRANSCRIPT_DIR="/Users/291928k/david/Developer/datacore/sample-data/claude/transcripts"
mkdir -p "$TRANSCRIPT_DIR"

echo "=== Local transcripts ==="
if ls "$TRANSCRIPT_DIR"/*.txt 1>/dev/null 2>&1; then
  ls -lh "$TRANSCRIPT_DIR"/*.txt
else
  echo "  (none yet)"
fi
