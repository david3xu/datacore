# Datacore MCP Server

Phase 1 local MCP server for datacore.

## Current Scope

- Transport: `stdio`
- Tools:
  - `log_event`
  - `search`
- Storage: local Bronze JSONL files

Default Bronze directory:

```text
~/.datacore/bronze
```

Override with:

```bash
DATACORE_BRONZE_DIR=/path/to/bronze
```

## Run

```bash
cd /Users/291928k/david/Developer/datacore/mcp-server
node src/index.mjs
```

## Smoke Test

```bash
cd /Users/291928k/david/Developer/datacore/mcp-server
node scripts/smoke.mjs
```

## OpenClaw Setup

Add the real `datacore` MCP entry to the active OpenClaw config file:

```bash
cd /Users/291928k/david/Developer/datacore/mcp-server
bash scripts/setup-openclaw.sh server
```

Enable the auto-log hook as a second step:

```bash
cd /Users/291928k/david/Developer/datacore/mcp-server
bash scripts/setup-openclaw.sh autolog
```

Or do both at once:

```bash
cd /Users/291928k/david/Developer/datacore/mcp-server
bash scripts/setup-openclaw.sh all
```

Notes:

- The script writes to `OPENCLAW_CONFIG_PATH` when set, otherwise `~/.openclaw/openclaw.json`
- The OpenClaw gateway should be restarted after config or hook changes
- The auto-log hook is discovered from `/Users/291928k/david/Developer/datacore/hooks`

## OpenClaw Smoke Test

This runs the datacore MCP server through OpenClaw's existing `stdio` MCP
runtime without touching your real `~/.openclaw/openclaw.json`.

```bash
cd /Users/291928k/david/Developer/datacore/mcp-server
./scripts/openclaw-smoke.sh
```

## Auto-Log Smoke Test

This exercises the `datacore-mcp-log` hook end-to-end by calling the hook
handler, writing through the `log_event` MCP tool, then searching the Bronze
store for both the inbound and outbound records.

```bash
cd /Users/291928k/david/Developer/datacore/mcp-server
npm run autolog:smoke
```

## Claude Project Setup

The repo now includes a project-scoped Claude MCP config at
`/Users/291928k/david/Developer/datacore/.mcp.json`.

Check that Claude sees it:

```bash
cd /Users/291928k/david/Developer/datacore
claude mcp list
claude mcp get datacore
```

## MCP Inspector

Launch MCP Inspector against this server:

```bash
cd /Users/291928k/david/Developer/datacore/mcp-server
npm run inspect
```

`npm run inspect` uses `npx @modelcontextprotocol/inspector`, so it may fetch
the Inspector package the first time if it is not already installed.

## Tools

### `log_event`

Input:

```json
{
  "source": "claude.ai",
  "type": "note",
  "content": "Knowledge graph spans all layers",
  "context": {
    "project": "datacore"
  }
}
```

Effect:
- appends one JSON object to `YYYY-MM-DD.jsonl`
- adds `_timestamp`, `_source`, `_event_id`

### `search`

Input:

```json
{
  "query": "knowledge graph",
  "max_results": 10
}
```

Effect:
- reads Bronze JSONL files
- performs case-insensitive text matching
- returns matches with timestamp, source, type, snippet, and file path

## Dependency Note

`package.json` declares the intended MCP SDK dependencies. For this workspace,
the server can also fall back to the sibling `openclaw` checkout if local
`node_modules` have not been installed yet.
