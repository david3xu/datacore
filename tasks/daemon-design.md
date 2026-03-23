# Daemonization Design: Session Watchers as launchd Agents

> Brain (Claude) design doc for R8 implementation
> Date: March 21, 2026

## Problem

codex-session-watcher.mjs (R6) and claude-desktop-session-watcher.mjs (R7)
work but require manual `node scripts/watcher.mjs` to run. They should
start automatically on login, restart on failure, and run silently.

## Pattern: Follow OpenClaw's launchd approach

OpenClaw already runs as a launchd agent at:
`~/Library/LaunchAgents/ai.openclaw.gateway.plist`

Key properties from OpenClaw's plist:
- `RunAtLoad: true` — starts on login
- `KeepAlive: true` — restarts on crash
- `ThrottleInterval: 1` — min 1s between restarts
- Logs to `~/.openclaw/logs/`
- Uses absolute path to node binary

## Design: Two plist files


### Plist 1: Codex Session Watcher

File: `~/Library/LaunchAgents/dev.datacore.codex-watcher.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.datacore.codex-watcher</string>
  <key>Comment</key>
  <string>Datacore: auto-ingest Codex sessions to Bronze</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/291928k/david/Developer/datacore/mcp-server/scripts/codex-session-watcher.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/291928k/david/Developer/datacore/mcp-server</string>
  <key>StandardOutPath</key>
  <string>/Users/291928k/.datacore/logs/codex-watcher.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/291928k/.datacore/logs/codex-watcher.err.log</string>
</dict>
</plist>
```

### Plist 2: Claude Agent Session Watcher

File: `~/Library/LaunchAgents/dev.datacore.claude-agent-watcher.plist`

Same structure, different paths:
- Label: `dev.datacore.claude-agent-watcher`
- Script: `.../claude-agent-session-watcher.mjs`
- Logs: `~/.datacore/logs/claude-agent-watcher.log`


## Install / Management Commands

```bash
# Create log directory
mkdir -p ~/.datacore/logs

# Install (copy plist files)
cp dev.datacore.codex-watcher.plist ~/Library/LaunchAgents/
cp dev.datacore.claude-agent-watcher.plist ~/Library/LaunchAgents/

# Start
launchctl load ~/Library/LaunchAgents/dev.datacore.codex-watcher.plist
launchctl load ~/Library/LaunchAgents/dev.datacore.claude-agent-watcher.plist

# Stop
launchctl unload ~/Library/LaunchAgents/dev.datacore.codex-watcher.plist
launchctl unload ~/Library/LaunchAgents/dev.datacore.claude-agent-watcher.plist

# Check status
launchctl list | grep datacore

# View logs
tail -f ~/.datacore/logs/codex-watcher.log
tail -f ~/.datacore/logs/claude-agent-watcher.log
```

## Design Decisions

**ThrottleInterval: 5** (not 1 like OpenClaw)
- Watchers are polling-based, not request-serving
- If they crash, waiting 5s before restart is fine
- Reduces log spam from rapid crash loops

**KeepAlive: true**
- Watchers should always be running
- If node crashes (OOM, unhandled error), launchd restarts

**WorkingDirectory: mcp-server/**
- Both watchers import from `../src/client.mjs`
- Must be in mcp-server/ for relative imports to resolve

**No EnvironmentVariables needed**
- Both watchers use hardcoded defaults for session root and state paths
- Override via env vars if needed (DATACORE_CODEX_SESSION_DIR, etc.)

## Implementation as R8

R8 should be a simple task:
1. Create the two plist files in `mcp-server/launchd/`
2. Create an install script: `mcp-server/scripts/install-watchers.sh`
3. Script creates log dir, copies plists, loads them
4. Verify both watchers appear in `launchctl list`

This is a 15-minute task for Codex or Gemini.

---

*Designed by Claude (brain). Reference: OpenClaw's plist at
~/Library/LaunchAgents/ai.openclaw.gateway.plist*
