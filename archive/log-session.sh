#!/bin/bash
# ⚠️ DEPRECATED — This script writes to sample-data/claude/ which is
# NOT searchable by the datacore MCP server.
# Use the MCP server instead:
#   cd ~/Developer/datacore/mcp-server
#   node -e "import {logEventViaMcp} from './src/client.mjs'; \
#     await logEventViaMcp({source:'cli',type:'note',content:'msg'}); \
#     process.exit(0);"
echo "⚠️  WARNING: log-session.sh is DEPRECATED. Data goes to wrong store."
echo "   Use datacore MCP tools instead. See mcp-server/CONNECT-GUIDE.md"
echo "   Continuing anyway for backward compatibility..."
echo ""

# log-session.sh — Append an event to today's Claude session log
# Usage: ./log-session.sh <type> "message"
# Types: decision, action, insight, problem, note
# Example: ./log-session.sh decision "Knowledge graph spans all layers"

SAMPLE_DIR="/Users/291928k/david/Developer/datacore/sample-data/claude"
TODAY=$(date +%Y-%m-%d)
FILE="$SAMPLE_DIR/session-${TODAY}.jsonl"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TYPE="${1:-note}"
shift
MESSAGE="$*"


if [ -z "$MESSAGE" ]; then
  echo "Usage: ./log-session.sh <type> \"message\""
  echo "Types: decision, action, insight, problem, note, session_start, session_end"
  exit 1
fi

mkdir -p "$SAMPLE_DIR"

# If file doesn't exist, create with session_start
if [ ! -f "$FILE" ]; then
  echo "{\"timestamp\":\"${TIMESTAMP}\",\"type\":\"session_start\",\"source\":\"claude.ai\"}" >> "$FILE"
fi

# Escape quotes in message for valid JSON
MESSAGE_ESCAPED=$(echo "$MESSAGE" | sed 's/"/\\"/g')

echo "{\"timestamp\":\"${TIMESTAMP}\",\"type\":\"${TYPE}\",\"content\":\"${MESSAGE_ESCAPED}\"}" >> "$FILE"
echo "✓ [${TYPE}] logged to session-${TODAY}.jsonl"
