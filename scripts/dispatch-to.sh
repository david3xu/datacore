#!/usr/bin/env bash
# dispatch-to.sh — Wake and focus a GUI AI agent via AppleScript.
# Part of R18: enables autonomous multi-agent dispatch.
# Usage: dispatch-to.sh <agent> [options] [message]
# Agents: claude-desktop, codex, gemini
# Example: dispatch-to.sh claude-desktop --force "Review task GOLD-PHASE-1"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MCP_SERVER_DIR="$(cd "$(dirname "$SCRIPT_DIR")/mcp-server" && pwd)"

usage() {
  cat <<'USAGE'
Usage: dispatch-to.sh <agent> [options] [message]

Agents:
  claude-desktop | claude
  codex | code | vscode
  gemini | antigravity | chrome

Options:
  --force           Bypass the in-progress task guard
  --dry-run         Do not run AppleScript, just print/log intent
  --message-file F  Read briefing text from file F
  --help            Show this help

If no message is provided, the BRIEFING environment variable is used when set.
Examples:
  dispatch-to.sh claude-desktop "Review GOLD-PHASE-1"
  dispatch-to.sh gemini --force "Build circuit breaker tests"
  dispatch-to.sh codex --dry-run --message-file briefing.txt
USAGE
  exit 1
}

ensure_tool() {
  if ! command -v "$1" &>/dev/null; then
    echo "❌ Required tool '$1' not found" >&2
    exit 1
  fi
}

log_dispatch() {
  local status="$1"
  local detail="$2"
  if ! command -v node &>/dev/null; then
    return
  fi
  (
    cd "$MCP_SERVER_DIR" && \
    node --input-type=module - <<'NODE' -- "$status" "$detail" "$CANONICAL_AGENT" "$MESSAGE"
import { callDatacoreTool } from './dist/client.js';
const [status, detail, agent, message] = process.argv.slice(2);
const content = [`RPA dispatch to ${agent}: ${status}.`, detail].filter(Boolean).join(' ').trim();
try {
  await callDatacoreTool({
    name: 'log_event',
    arguments: {
      source: 'openclaw',
      type: 'dispatch',
      content,
      context: {
        agent,
        status,
        message,
      },
    },
  });
} catch (error) {
  console.error('Failed to log dispatch:', error?.message ?? error);
  process.exit(0);
}
NODE
  ) >/dev/null 2>&1 || true
}

CLIPBOARD_BACKUP=""
CLIPBOARD_TRAP_REGISTERED=0
prepare_clipboard() {
  local data="$1"
  if [[ -z "$data" ]]; then
    return 0
  fi
  ensure_tool pbcopy
  ensure_tool pbpaste
  CLIPBOARD_BACKUP="$(mktemp)"
  pbpaste >"$CLIPBOARD_BACKUP" 2>/dev/null || true
  printf "%s" "$data" | pbcopy
  if [[ $CLIPBOARD_TRAP_REGISTERED -eq 0 ]]; then
    trap restore_clipboard EXIT
    CLIPBOARD_TRAP_REGISTERED=1
  fi
}

restore_clipboard() {
  if [[ -n "$CLIPBOARD_BACKUP" && -f "$CLIPBOARD_BACKUP" ]]; then
    pbcopy <"$CLIPBOARD_BACKUP" 2>/dev/null || true
    rm -f "$CLIPBOARD_BACKUP"
    CLIPBOARD_BACKUP=""
  fi
}

FORCE_DISPATCH=0
DRY_RUN=0
MESSAGE=""
MESSAGE_FILE=""

AGENT="${1:-}" || true
[[ -z "$AGENT" ]] && usage
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE_DISPATCH=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --message-file)
      MESSAGE_FILE="${2:-}"
      shift
      ;;
    --help|-h)
      usage
      ;;
    --)
      shift
      [[ $# -gt 0 ]] && MESSAGE+="${MESSAGE:+ }$*" && break
      ;;
    *)
      MESSAGE+="${MESSAGE:+ }$1"
      ;;
  esac
  shift || true
done

if [[ -n "$MESSAGE_FILE" ]]; then
  [[ -f "$MESSAGE_FILE" ]] || { echo "❌ Message file not found: $MESSAGE_FILE" >&2; exit 1; }
  MESSAGE="$(cat "$MESSAGE_FILE")"
fi

if [[ -z "$MESSAGE" && -n "${BRIEFING:-}" ]]; then
  MESSAGE="$BRIEFING"
fi

MESSAGE_PRESENT=0
[[ -n "$MESSAGE" ]] && MESSAGE_PRESENT=1

CANONICAL_AGENT=""
DATACORE_AGENT=""
case "$AGENT" in
  claude-desktop|claude)
    CANONICAL_AGENT="claude-desktop"
    DATACORE_AGENT="claude-desktop"
    ;;
  codex|code|vscode)
    CANONICAL_AGENT="codex"
    DATACORE_AGENT="codex"
    ;;
  gemini|antigravity|chrome)
    CANONICAL_AGENT="gemini"
    DATACORE_AGENT="gemini"
    ;;
  *)
    echo "❌ Unknown agent: $AGENT" >&2
    usage
    ;;
esac

check_agent_busy() {
  local target="$1"
  [[ "$FORCE_DISPATCH" -eq 1 ]] && return 0
  if ! command -v node &>/dev/null; then
    echo "⚠️  node not available; skipping busy check" >&2
    return 0
  fi
  local output status
  set +e
  output=$(cd "$MCP_SERVER_DIR" 2>/dev/null && node --input-type=module - <<'NODE' -- "$target"
import { callDatacoreTool } from './dist/client.js';
const target = process.argv[2];
try {
  const result = await callDatacoreTool({
    name: 'get_tasks',
    arguments: { assigned_to: target, status: 'in_progress', limit: 5 },
  });
  const tasks = result?.structuredContent?.tasks ?? [];
  if (tasks.length > 0) {
    const summary = tasks
      .map((task) => `- ${task.id}: ${task.summary ?? task.content ?? ''}`)
      .join('\n');
    console.log(summary);
    process.exit(10);
  }
  process.exit(0);
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(11);
}
NODE)
  status=$?
  set -e
  if [[ $status -eq 10 ]]; then
    echo "⚠️  ${target} already has in-progress tasks:" >&2
    echo "$output" >&2
    echo "    Use --force to override." >&2
    exit 2
  elif [[ $status -ne 0 ]]; then
    echo "⚠️  Unable to verify task status (node exit $status). Continuing." >&2
  fi
}

check_agent_busy "$DATACORE_AGENT"

echo "🚀 Dispatching to: $CANONICAL_AGENT"
[[ -n "$MESSAGE" ]] && { echo "📝 Message:"; echo "$MESSAGE"; }
[[ $FORCE_DISPATCH -eq 1 ]] && echo "⚡️ Force dispatch enabled"
[[ $DRY_RUN -eq 1 ]] && echo "🔬 Dry-run mode (no AppleScript keystrokes)"
echo ""

app_is_running() {
  local process_name="$1"
  osascript -e "tell application \"System Events\" to return (exists process \"$process_name\")" 2>/dev/null
}

activate_app() {
  local app_name="$1"
  osascript -e "tell application \"$app_name\" to activate"
}

with_clipboard_message() {
  if [[ -z "$MESSAGE" ]]; then
    return 0
  fi
  prepare_clipboard "$MESSAGE"
}

finish_clipboard() {
  if [[ -n "$MESSAGE" ]]; then
    restore_clipboard
  fi
}

maybe_launch_app() {
  local app_name="$1"
  local process_name="${2:-$1}"
  if [[ "$(app_is_running "$process_name")" == "false" ]]; then
    echo "Launching $app_name..."
    open -a "$app_name" || return 1
    sleep 3
  fi
  echo "Activating $app_name..."
  activate_app "$app_name"
  sleep 1
}

dispatch_claude_desktop() {
  local app_name="Claude"
  if [[ $DRY_RUN -eq 1 ]]; then
    log_dispatch "dry-run" "Claude Desktop"
    echo "[dry-run] Would activate $app_name"
    return 0
  fi
  maybe_launch_app "$app_name"
  with_clipboard_message
  osascript <<APPLESCRIPT
    tell application "System Events"
      tell process "$app_name"
        set frontmost to true
        delay 0.5
        keystroke "n" using command down
        delay 1
        if "$MESSAGE_PRESENT" is "1" then
          keystroke "v" using command down
          delay 0.3
          keystroke return
        end if
      end tell
    end tell
APPLESCRIPT
  finish_clipboard
  log_dispatch "success" "Claude Desktop activated"
  echo "✅ Claude Desktop dispatched"
}

dispatch_codex() {
  local app_name="Visual Studio Code"
  if [[ $DRY_RUN -eq 1 ]]; then
    log_dispatch "dry-run" "Codex"
    echo "[dry-run] Would activate $app_name"
    return 0
  fi
  maybe_launch_app "$app_name" "Code"
  with_clipboard_message
  osascript <<APPLESCRIPT
    tell application "System Events"
      tell process "Code"
        set frontmost to true
        delay 0.5
        keystroke "/clear"
        delay 0.2
        keystroke return
        delay 0.8
        if "$MESSAGE_PRESENT" is "1" then
          keystroke "v" using command down
          delay 0.3
          keystroke return
        end if
      end tell
    end tell
APPLESCRIPT
  finish_clipboard
  log_dispatch "success" "Codex activated"
  echo "✅ Codex dispatched"
}

dispatch_gemini() {
  local antigravity="Antigravity"
  local chrome="Google Chrome"
  local use_chrome=0
  if ! osascript -e "id of application \"$antigravity\"" >/dev/null 2>&1; then
    use_chrome=1
  fi
  local label="Gemini (Antigravity)"
  [[ $use_chrome -eq 1 ]] && label="Gemini (Chrome)"
  if [[ $DRY_RUN -eq 1 ]]; then
    log_dispatch "dry-run" "$label"
    echo "[dry-run] Would activate $label"
    return 0
  fi

  if [[ $use_chrome -eq 1 ]]; then
    local gemini_url="https://gemini.google.com"
    maybe_launch_app "$chrome"
    osascript <<APPLESCRIPT
      tell application "Google Chrome"
        activate
        make new tab at end of tabs of window 1 with properties {URL:"$gemini_url"}
      end tell
APPLESCRIPT
    sleep 2
    with_clipboard_message
    osascript <<APPLESCRIPT
      tell application "System Events"
        tell process "Google Chrome"
          set frontmost to true
          delay 0.5
          if "$MESSAGE_PRESENT" is "1" then
            keystroke "v" using command down
            delay 0.3
            keystroke return
          end if
        end tell
      end tell
APPLESCRIPT
    finish_clipboard
    log_dispatch "success" "Gemini (Chrome) activated"
    echo "✅ Gemini dispatched (Chrome)"
  else
    maybe_launch_app "$antigravity"
    with_clipboard_message
    osascript <<APPLESCRIPT
      tell application "System Events"
        tell process "$antigravity"
          set frontmost to true
          delay 0.5
          keystroke "l" using command down
          delay 0.5
          if "$MESSAGE_PRESENT" is "1" then
            keystroke "v" using command down
            delay 0.3
            keystroke return
          end if
        end tell
      end tell
APPLESCRIPT
    finish_clipboard
    log_dispatch "success" "Gemini (Antigravity) activated"
    echo "✅ Gemini dispatched (Antigravity)"
  fi
}

case "$CANONICAL_AGENT" in
  claude-desktop)
    dispatch_claude_desktop
    ;;
  codex)
    dispatch_codex
    ;;
  gemini)
    dispatch_gemini
    ;;
  *)
    echo "❌ Unsupported agent: $CANONICAL_AGENT" >&2
    exit 1
    ;;
esac
