#!/usr/bin/env bash
set -e

echo "Installing Datacore Session Watchers..."

PLIST_CODEX="com.datacore.codex-session-watcher.plist"
PLIST_CLAUDE="com.datacore.claude-agent-session-watcher.plist"
PLIST_GEMINI="com.datacore.gemini-session-watcher.plist"

PLIST_DIR="$HOME/Library/LaunchAgents"
LOGS_DIR="$HOME/.datacore/logs"

# Ensure log directory exists
echo "Ensuring log directory exists at $LOGS_DIR..."
mkdir -p "$LOGS_DIR"

# Copy plists to LaunchAgents
echo "Copying plist files to $PLIST_DIR..."
cp "$PLIST_CODEX" "$PLIST_DIR/"
cp "$PLIST_CLAUDE" "$PLIST_DIR/"
cp "$PLIST_GEMINI" "$PLIST_DIR/"

# Unload existing services if they are running, ignore errors if not
echo "Unloading existing services (if any)..."
launchctl unload "$PLIST_DIR/$PLIST_CODEX" 2>/dev/null || true
launchctl unload "$PLIST_DIR/$PLIST_CLAUDE" 2>/dev/null || true
launchctl unload "$PLIST_DIR/$PLIST_GEMINI" 2>/dev/null || true

# Load the plists
echo "Loading and starting services..."
launchctl load "$PLIST_DIR/$PLIST_CODEX"
launchctl load "$PLIST_DIR/$PLIST_CLAUDE"
launchctl load "$PLIST_DIR/$PLIST_GEMINI"

# Verify status
echo "---"
echo "Installation complete. Checking running status (PID should be present):"
launchctl list | grep datacore || echo "WARNING: No datacore services found running."
echo "---"
echo "To view logs in real time:"
echo "tail -f ~/.datacore/logs/codex.log"
echo "tail -f ~/.datacore/logs/claude-agent.log"
echo "tail -f ~/.datacore/logs/gemini.log"
