# Connecting AI Apps to Datacore

> How to connect each AI tool to the datacore MCP server.
> Per-app setup instructions, current status, and blockers.
> Updated: March 23, 2026

## Current Status

| AI App | Status | Transport | Auto-logs? |
|---|---|---|---|
| **Claude.ai (Projects)** | ✅ Working | stdio via `.mcp.json` | AI calls tools when relevant |
| **Claude Desktop** | ✅ Working | stdio via config file | AI calls tools when relevant |
| **OpenClaw** | ✅ Working | stdio via hook | ✅ Auto-captures all messages |
| **Codex (OpenAI)** | ✅ Configured | stdio via `~/.codex/config.toml` | AI calls tools when relevant |
| **MCP Inspector** | ✅ Verified | stdio manual | Manual testing only |
| **VS Code / Cursor** | 🟡 Ready | stdio config file | AI calls tools when relevant |
| **Gemini / Antigravity** | ✅ Working | File watcher (R9) + `.mcp.json` | gemini-session-watcher.mjs auto-ingests + MCP tools available |
| **ChatGPT** | ⬜ Not planned | Needs remote HTTP | Not on the team currently |
| **M365 Copilot** | ⬜ Not planned | Needs Copilot Studio | Not on the team currently |

Legend: ✅ Working | 🟡 Ready (just needs config) | 🔴 Blocked (needs work)


## Prerequisite (one-time)

```bash
cd ~/Developer/datacore/mcp-server
npm install       # install dependencies
npm run smoke     # verify server works
```

---

## ✅ Claude.ai (Projects) — WORKING

**How it connects:** `.mcp.json` at project root, auto-discovered.

**Setup:** Already done. The file exists at two levels:
- `~/Developer/.mcp.json` — all projects get datacore tools
- `~/Developer/datacore/.mcp.json` — datacore project specifically

**What you see:** `datacore:log_event` and `datacore:search` appear
as available tools in the conversation.

**How to verify:** Ask Claude to call `datacore:search` with any query.

**Limitation:** Server runs in Claude's container, not your Mac.
Writes go to the container's `~/.datacore/bronze/`, which may be
a different filesystem than your local Mac. For project-scoped use
this works because the tools operate on the container's local storage.


---

## ✅ OpenClaw — WORKING

**How it connects:** MCP server entry in `openclaw.json` + auto-log hook.

**Setup:** Already done by `setup-openclaw.sh all`:
- MCP server registered in `~/.openclaw/openclaw.json`
- Auto-log hook at `hooks/datacore-mcp-log/handler.js`
- Hook captures ALL inbound + outbound messages automatically

**What you get:** Every OpenClaw conversation (Telegram, Discord, WebChat)
automatically writes `message_preprocessed` and `message_sent` events
to Bronze. No AI decision needed — it happens at the platform level.

**How to verify:**
```bash
# Send a message through OpenClaw, then:
cat ~/.datacore/bronze/$(date +%Y-%m-%d).jsonl | grep "openclaw" | tail -1
```

**This is the gold standard** for data collection — no reliance on
the AI remembering to log. The hook captures everything.

---

## ✅ Claude Desktop — WORKING

**How it connects:** Config file on your Mac, stdio transport.

**Status:** Already configured and running! Found process:
`Claude.app/Contents/Helpers/disclaimer node .../datacore/mcp-server/src/index.mjs`

**Config location:**
`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "datacore": {
      "command": "node",
      "args": ["/Users/291928k/david/Developer/datacore/mcp-server/src/index.mjs"],
      "env": {
        "DATACORE_BRONZE_DIR": "/Users/291928k/.datacore/bronze"
      }
    }
  }
}
```

**Advantage over Claude.ai:** Server runs on YOUR Mac with access to
your local filesystem. Writes go to your real `~/.datacore/bronze/`.

---

## ✅ Codex (OpenAI) — CONFIGURED

**How it connects:** TOML config file at `~/.codex/config.toml`, stdio transport.

**Status:** Configured March 21, 2026. Restart Codex app to pick up.

**Config added to `~/.codex/config.toml`:**
```toml
[mcp_servers.datacore]
command = "node"
args = ["/Users/291928k/david/Developer/datacore/mcp-server/scripts/run-server.mjs"]
```

**Verify:** In Codex TUI, type `/mcp` to see connected servers.

**Note:** Codex is OpenAI's product, NOT Claude Code. It uses TOML config,
not JSON. Some users report MCP connection issues (GitHub issue #3441) —
if tools don't appear, check `codex mcp list` from the CLI.

---

## 🟡 VS Code / Cursor — READY (2 minutes)

**How it connects:** MCP config file in workspace settings.

**VS Code setup:**
Create `.vscode/mcp.json` in any project:
```json
{
  "mcpServers": {
    "datacore": {
      "command": "node",
      "args": ["/Users/291928k/david/Developer/datacore/mcp-server/scripts/run-server.mjs"]
    }
  }
}
```

**Cursor setup:**
Create `.cursor/mcp.json` with the same content.


VS Code also supports auto-discovery from Claude Desktop config.
Enable in Settings: `chat.mcp.discovery.enabled`.

---

## 🔴 ChatGPT — BLOCKED (needs remote deployment)

**Blocker:** ChatGPT only connects to remote MCP servers over HTTPS.
Our server is local stdio only.

**What's needed:**
1. Add Streamable HTTP transport to the MCP server
2. Deploy to a public HTTPS endpoint (Azure App Service, Cloudflare Workers, or ngrok for dev)
3. Configure OAuth 2.1 for authentication
4. Add as a connector in ChatGPT

**Timeline:** Phase 2 (after local usage proves the tools are valuable).

---

## ✅ Gemini — WORKING (via file watcher, R9)

**Method:** `gemini-session-watcher.mjs` watches `~/.gemini/tmp/*/chats/` and auto-ingests all sessions to Bronze. ID-based dedup prevents duplicates.

**Setup:** Already daemonized via launchd (installed by `install-watchers.sh` in R8).

**Stats:** 449 messages from 11 sessions ingested on first run. Captures all Gemini conversations automatically.

**Note:** This uses file watching, not native MCP client support from Google. If Google ships stable MCP integration in future, we could add direct tool-based logging too.


---

## 🔴 M365 Copilot — BLOCKED (needs license + remote deployment)

**Blocker:** Two requirements not met:
1. Full Microsoft 365 Copilot license (Curtin has Premium but admin controls Frontier)
2. Remote MCP server deployed (Copilot Studio needs Streamable HTTP)

**Paths:**
- **Copilot Studio:** Create custom connector pointing to our MCP server URL
- **Declarative Agent:** Package as MCP plugin for M365 Copilot (preview)
- **Graph API:** Bypass Copilot entirely, pull M365 data via Graph API into Bronze

**Timeline:** Phase 4 (after remote deployment is working for ChatGPT).

See `MCP-DECISION-MEMO.md` for verified details on Microsoft's MCP support.

---

## How Each Connection Type Works

```
LOCAL STDIO (Claude Desktop, Claude Code, OpenClaw, VS Code, Cursor):
  Config file → host spawns server as child process → JSON-RPC over stdin/stdout
  ✅ No network, no auth, server runs on your Mac
  ✅ Full access to local filesystem (~/.datacore/bronze/)

PROJECT STDIO (Claude.ai Projects):
  .mcp.json in project files → Claude spawns server in container → JSON-RPC
  ✅ Automatic, zero config
  ⚠️ Server runs in Claude's container, not your Mac

REMOTE HTTP (ChatGPT, M365 Copilot, Gemini — future):
  Deploy server to HTTPS endpoint → client connects over internet → JSON-RPC
  ✅ Any client anywhere can connect
  ⚠️ Needs deployment, auth (OAuth 2.1), public URL
```


## ⚠️ Deprecated: log-session.sh

The `log-session.sh` script writes to `sample-data/claude/session-*.jsonl`
which is a **different store** than the MCP server's `~/.datacore/bronze/`.

**Do NOT use `log-session.sh` for new logging.** Use MCP tools instead:

| Old way (deprecated) | New way (use this) |
|---|---|
| `./log-session.sh decision "msg"` | Claude calls `datacore:log_event` |
| Manual shell script | Automatic via MCP protocol |
| Writes to `sample-data/` | Writes to `~/.datacore/bronze/` |
| Not searchable by MCP | Searchable by `datacore:search` |
| One-off events | Integrated with all AI apps |

41 events from the old session log have been migrated into Bronze.
No data was lost, but future events must go through MCP.

## Related Docs

| Doc | Purpose |
|---|---|
| `docs/why-mcp.md` | Full logic chain: problem → protocol → datacore |
| `docs/mcp-config.md` | Where `.mcp.json` lives, how to test, 4 test methods |
| `mcp-server/MCP-AUTO-DISCOVERY.md` | How auto-discovery works in each Claude product |
| `mcp-server/QUICKSTART.md` | Install, connect, tool usage reference |
| `mcp-server/CODE-REVIEW.md` | Code quality assessment by Claude |
| `mcp-server/MCP-DECISION-MEMO.md` | Verified MCP research decisions |
| `mcp-server/CODEX-TASKS.md` | Task specs for delegating to Codex/OpenClaw |
