# How to Enable Auto-Logging for GUI AI Apps

> Updated: March 22, 2026
> Status: PROVEN WORKING for Antigravity + Claude Desktop chat

## Three Capture Strategies

```
STRATEGY 1 — FILE WATCHERS (100% automatic, no AI decision)
  Codex CLI        → codex-session-watcher.mjs         ✅ daemonized
  Claude Code      → claude-agent-session-watcher.mjs   ✅ daemonized
  Gemini CLI       → gemini-session-watcher.mjs         ✅ daemonized
  OpenClaw         → hook handler.js                    ✅ auto with gateway

STRATEGY 2 — INSTRUCTED LOGGING (~80-90%, AI follows instructions)
  Antigravity      → ~/.gemini/GEMINI.md + MCP          ✅ PROVEN
  Claude Desktop   → Project instructions + MCP         ✅ PROVEN
  Claude Code      → ~/.claude/CLAUDE.md + MCP          ✅ instructions set

STRATEGY 3 — TRANSCRIPT DOWNLOAD (100%, delayed)
  Claude.ai        → download after compaction           ⚠️ manual
```

## Antigravity (Gemini IDE) — PROVEN ✅

**How it works:**
- Global instructions: `~/.gemini/GEMINI.md` (loaded for ALL sessions)
- MCP config: `~/.gemini/antigravity/mcp_config.json`
- Both tools enabled: log_event + search (set to "Always allow")

**Proof:** User asked "do you know Perth?" → AI called log_event → event
appeared in Bronze with `source: "gemini"`, `type: "conversation"`.

## Claude Desktop Chat — PROVEN ✅

**How it works:**
- MCP connected via claude_desktop_config.json (datacore server)
- Tools set to "Always allow" in Customize → Connectors
- Instructions via: Claude Desktop Projects (recommended) or inline prompt

**For permanent auto-logging:**
1. Click Projects in sidebar
2. Create project "All Conversations"
3. Add project instruction: "After every response, call the datacore MCP
   log_event tool with source 'claude-desktop', type 'conversation',
   content containing the user's message and your response. Mandatory."
4. Start all new chats from this project

**Proof:** User asked "do you know Perth?" and "what the house price?" →
AI called log_event for both → events in Bronze with `source: "claude-desktop"`.

## Claude Desktop Agent Mode

**How it works:**
- Global instructions: `~/.claude/CLAUDE.md`
- MCP already configured
- Also captured by claude-agent-session-watcher (Strategy 1)

Agent mode gets DOUBLE capture: file watcher (100%) + instructed logging (~90%).

## Claude Cowork (desktop app) — WORKING ✅

**How it works:**
- MCP tools available via `.mcp.json` auto-discovery in mounted Developer folder
- Both `log_event` and `search` tools are callable
- Source: `claude-cowork`

**Note:** Claude Cowork runs in a sandboxed VM but CAN reach the datacore MCP server
through the mounted workspace. Tools must be discovered at start of session.

## Claude.ai (web)

**No auto-capture possible.** Cloud-hosted, no local files.
- During session: AI calls log_event when it decides to (Silver quality)
- After session: transcript download → ingest to Bronze (true Bronze)
