# Datacore MCP Server — Quick Start

> Get the datacore MCP server running and connected to your AI tools.
> Time: ~5 minutes if dependencies are already installed.
> Prerequisite: Node.js 22+

## What This Is

A local MCP server that any AI app can connect to. Two tools:
- `log_event` — write any event to the Bronze data store
- `search` — full-text search across all collected events

Data lives at `~/.datacore/bronze/YYYY-MM-DD.jsonl` (one file per day).

## Install

```bash
cd ~/Developer/datacore/mcp-server
npm install
```

Verify:
```bash
npm run smoke
# Expected: "datacore MCP smoke test passed"
```

## Connect to Claude.ai (Project-scoped)

The repo includes `.mcp.json` at the project root. When this project
is loaded in Claude, the MCP server is automatically available.

```json
// datacore/.mcp.json (already exists)
{
  "mcpServers": {
    "datacore": {
      "command": "node",
      "args": ["./mcp-server/scripts/run-server.mjs"]
    }
  }
}
```


Once connected, Claude sees `datacore:log_event` and `datacore:search`
as available tools. Claude can call them directly during conversation.

**Verified working:** March 21, 2026 — Claude.ai called `log_event`
and `search` live inside this project conversation.

## Connect to Claude Desktop (local stdio)

Edit Claude Desktop config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

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

Restart Claude Desktop. The datacore tools appear in the tools menu.

## Connect to OpenClaw

Option 1 — Setup script (configures OpenClaw + optional auto-log hook):
```bash
cd ~/Developer/datacore/mcp-server
bash scripts/setup-openclaw.sh all
```

Option 2 — Manual: add to `~/.openclaw/openclaw.json` under MCP config.

The auto-log hook (`hooks/datacore-mcp-log/handler.js`) automatically
captures every OpenClaw inbound/outbound message to Bronze.

## Test with MCP Inspector

```bash
cd ~/Developer/datacore/mcp-server
npm run inspect
# Opens browser at localhost:6274
```

In the Inspector UI:
1. **Transport Type:** STDIO (default)
2. **Command:** `node`
3. **Arguments:** `/Users/291928k/david/Developer/datacore/mcp-server/scripts/run-server.mjs`
4. Click **Connect** → status shows "Connected"
5. Click **Tools** tab → you'll see `log_event` and `search`
6. Click a tool → fill in JSON → click **Run** → see response

This is the raw debugging view — no AI interpretation, just the
MCP protocol request and response. Use it to verify tools work
before connecting to any AI client.


## Using the Tools

### log_event — Write to Bronze

Any connected AI can call this to record events:

```json
{
  "source": "claude.ai",
  "type": "decision",
  "content": "MCP server is Phase 1, not Phase 4",
  "context": { "project": "datacore", "reason": "data collection is the foundation" }
}
```

Types used so far: `decision`, `action`, `insight`, `problem`, `note`,
`milestone`, `session_start`, `session_end`

Events are appended to `~/.datacore/bronze/YYYY-MM-DD.jsonl` with
auto-generated `_timestamp`, `_source`, and `_event_id` (UUID).

### search — Read from Bronze

```json
{
  "query": "azure account",
  "max_results": 10
}
```

Returns matching events with source, timestamp, type, snippet, and file path.
Case-insensitive full-text search across all JSONL files.

## Data Location

```
~/.datacore/bronze/
├── 2026-03-21.jsonl    ← today's events
├── 2026-03-22.jsonl    ← tomorrow's events
└── ...                 ← one file per day, append-only
```

Override with: `DATACORE_BRONZE_DIR=/custom/path`

## What's NOT Here Yet (Future Phases)

- Remote HTTP transport (needed for Claude.ai web without project scope)
- `add_entity` tool (Silver/knowledge graph — Phase 3)
- `add_fact` tool (Gold/curated answers — Phase 4)
- ADLS Gen2 backend (Azure sync — Phase 2)
- Resources primitive (stable read-only data)
- Auth/security (needed when HTTP transport added)

## Architecture Context

See `DESIGN.md` for the full vision: datacore is the shared memory layer
for multiple AI agents. See `CODE-REVIEW.md` for the code quality assessment.
See `MCP-DECISION-MEMO.md` for verified MCP research decisions.
