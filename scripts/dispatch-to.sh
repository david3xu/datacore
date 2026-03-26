#!/usr/bin/env bash
# dispatch-to.sh — Wake and focus a GUI AI agent via AppleScript.
# Part of R18: enables autonomous multi-agent dispatch.
# Usage: dispatch-to.sh <agent> [message]
# Agents: claude-desktop, codex, gemini
# Example: dispatch-to.sh claude-desktop "Review task GOLD-PHASE-1"

set -euo pipefail

AGENT="${1:-}"
MESSAGE="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATACORE_LOG="${SCRIPT_DIR}/../../mcp-server/scripts/run-server.mjs"

# ── Logging ──────────────────────────────────────────────────

log_dispatch() {
  local status="$1"
  local detail="$2"
  # Log to Bronze if datacore is available
  if command -v node &>/dev/null; then
    cd "$(dirname "$SCRIPT_DIR")/mcp-server" 2>/dev/null && \
    node -e "
      import { appendEvent } from './dist/store.js';
      await appendEvent({
        source: 'openclaw',
        type: 'dispatch',
        content: 'RPA dispatch to ${AGENT}: ${status}. ${detail}',
        context: { agent: '${AGENT}', status: '${status}', message: process.argv[2] || '' }
      });
    " -- "$detail" 2>/dev/null || true
  fi
}

# ── Usage ────────────────────────────────────────────────────

usage() {
  echo "Usage: dispatch-to.sh <agent> [message]"
  echo "Agents: claude-desktop, codex, gemini"
  echo ""
  echo "Examples:"
  echo "  dispatch-to.sh claude-desktop 'Review GOLD-PHASE-1'"
  echo "  dispatch-to.sh gemini 'Build the circuit breaker tests'"
  echo "  dispatch-to.sh codex 'Fix formatting in store.ts'"
  exit 1
}

[ -z "$AGENT" ] && usage

# ── Agent dispatchers ────────────────────────────────────────

dispatch_claude_desktop() {
  local app_name="Claude"
  local is_running
  is_running=$(osascript -e "tell application \"System Events\" to return (exists process \"$app_name\")" 2>/dev/null)

  if [ "$is_running" = "false" ]; then
    echo "Launching $app_name..."
    open -a "$app_name"
    sleep 3
  fi

  echo "Activating $app_name..."
  osascript -e "tell application \"$app_name\" to activate"
  sleep 1

  if [ -n "$MESSAGE" ]; then
    echo "Sending message to $app_name..."
    osascript <<APPLESCRIPT
      tell application "System Events"
        tell process "$app_name"
          set frontmost to true
          delay 0.5
          keystroke "n" using command down
          delay 1
          keystroke "$MESSAGE"
          delay 0.3
          keystroke return
        end tell
      end tell
APPLESCRIPT
    echo "Message sent: $MESSAGE"
  fi

  log_dispatch "success" "Claude Desktop activated${MESSAGE:+ with message}"
  echo "✅ Claude Desktop dispatched"
}

dispatch_codex() {
  local app_name="Code"
  local is_running
  is_running=$(osascript -e "tell application \"System Events\" to return (exists process \"$app_name\")" 2>/dev/null)

  if [ "$is_running" = "false" ]; then
    echo "Launching VS Code..."
    open -a "Visual Studio Code"
    sleep 3
  fi

  echo "Activating VS Code..."
  osascript -e "tell application \"Visual Studio Code\" to activate"
  sleep 1

  if [ -n "$MESSAGE" ]; then
    echo "Opening Codex terminal with message..."
    osascript <<APPLESCRIPT
      tell application "System Events"
        tell process "Code"
          set frontmost to true
          delay 0.5
          -- Open integrated terminal
          keystroke "\`" using control down
          delay 1
          keystroke "echo 'TASK: $MESSAGE'"
          delay 0.3
          keystroke return
        end tell
      end tell
APPLESCRIPT
    echo "Message sent to Codex terminal: $MESSAGE"
  fi

  log_dispatch "success" "Codex (VS Code) activated${MESSAGE:+ with message}"
  echo "✅ Codex dispatched"
}

dispatch_gemini() {
  local app_name="Google Chrome"
  local gemini_url="https://gemini.google.com"
  local is_running
  is_running=$(osascript -e "tell application \"System Events\" to return (exists process \"$app_name\")" 2>/dev/null)

  if [ "$is_running" = "false" ]; then
    echo "Launching Chrome..."
    open -a "$app_name" "$gemini_url"
    sleep 3
  else
    echo "Activating Chrome..."
    osascript -e "tell application \"$app_name\" to activate"
    sleep 1
    # Open Gemini in a new tab
    osascript <<APPLESCRIPT
      tell application "Google Chrome"
        activate
        set newTab to make new tab at end of tabs of window 1
        set URL of newTab to "$gemini_url"
      end tell
APPLESCRIPT
    sleep 2
  fi

  if [ -n "$MESSAGE" ]; then
    echo "Typing message to Gemini..."
    osascript <<APPLESCRIPT
      tell application "System Events"
        tell process "Google Chrome"
          set frontmost to true
          delay 1
          keystroke "$MESSAGE"
          delay 0.3
          keystroke return
        end tell
      end tell
APPLESCRIPT
    echo "Message sent to Gemini: $MESSAGE"
  fi

  log_dispatch "success" "Gemini (Chrome) activated${MESSAGE:+ with message}"
  echo "✅ Gemini dispatched"
}

# ── Main ─────────────────────────────────────────────────────

echo "🚀 Dispatching to: $AGENT"
[ -n "$MESSAGE" ] && echo "📝 Message: $MESSAGE"
echo ""

case "$AGENT" in
  claude-desktop|claude)
    dispatch_claude_desktop
    ;;
  codex|code|vscode)
    dispatch_codex
    ;;
  gemini|antigravity|chrome)
    dispatch_gemini
    ;;
  *)
    echo "❌ Unknown agent: $AGENT"
    usage
    ;;
esac
