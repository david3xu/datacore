# Round 8 — Daemonize Both Session Watchers (launchd)

> Assigned to: Codex or Gemini Pro
> Date: March 21, 2026
> Type: Code + config (two plist files)

## Task

Create launchd plist files so both session watchers run on boot automatically.
Without this, the watchers are scripts you have to remember to start.

**Files to create:**

1. `~/Library/LaunchAgents/com.datacore.codex-session-watcher.plist`
2. `~/Library/LaunchAgents/com.datacore.claude-agent-session-watcher.plist`

**Each plist should:**
- Run the corresponding watcher script via `node`
- Start at login (KeepAlive or RunAtLoad)
- Restart on crash
- Log stdout/stderr to `~/.datacore/logs/`
- Set working directory to `~/Developer/datacore/mcp-server`

**Reference:** OpenClaw's launchd plist at `~/.openclaw/LaunchAgents/ai.openclaw.gateway.plist`

**Also create:** `mcp-server/scripts/install-watchers.sh` — a one-command installer that:
- Copies both plists to ~/Library/LaunchAgents/
- Creates ~/.datacore/logs/ directory
- Loads both agents via `launchctl load`
- Prints status confirmation

## Done when

- [ ] Both watchers start on login without manual intervention
- [ ] `launchctl list | grep datacore` shows both agents
- [ ] Watchers survive a kill (launchd restarts them)
- [ ] Log files appear in ~/.datacore/logs/
- [ ] Log completion via MCP datacore tools
