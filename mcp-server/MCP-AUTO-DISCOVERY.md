# How MCP Auto-Discovery Works in Claude Products

> Why `datacore:log_event` and `datacore:search` appeared automatically
> in this Claude.ai conversation — and how to replicate it everywhere.
> Date: March 21, 2026

## The Magic File: `.mcp.json`

One file at the project root makes MCP tools available to any Claude product:

```json
// datacore/.mcp.json
{
  "mcpServers": {
    "datacore": {
      "command": "node",
      "args": ["./mcp-server/scripts/run-server.mjs"]
    }
  }
}
```

When a Claude product loads a project containing `.mcp.json`, it:
1. Reads the file
2. Spawns each MCP server as a local subprocess (stdio transport)
3. Discovers the server's tools via `tools/list`
4. Makes those tools available to the AI in the conversation

No manual setup. No config editing. Just drop `.mcp.json` in your repo.

## How Each Claude Product Discovers MCP Servers


### Claude.ai (Web App) — Project-Scoped

**How we discovered this works:**
On March 21, 2026, GPT-5.4 via OpenClaw created `.mcp.json` in the
datacore project root. When Claude.ai loaded this project's files,
it automatically spawned the MCP server and made `datacore:log_event`
and `datacore:search` available as tools. No one configured anything.

**Mechanism:**
- Claude.ai Projects can include project files (uploaded or referenced)
- When project files include `.mcp.json`, Claude spawns the MCP servers
- The server runs on Anthropic's infrastructure (not your local machine)
- Tools appear as `servername:toolname` (e.g., `datacore:log_event`)
- The server's `command` must be available in the execution environment

**Limitations:**
- Server runs in Claude's container, not your Mac
- File paths are relative to the project root in the container
- The server only has access to files within the project scope
- Node.js must be available (it is in Claude's container)
- No access to your local filesystem directly (use Desktop Commander for that)

### Claude Desktop (macOS/Windows App) — Config File

**Config location:**
```
macOS:   ~/Library/Application Support/Claude/claude_desktop_config.json
Windows: %APPDATA%\Claude\claude_desktop_config.json
```

**Example config:**
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


**Mechanism:**
- Claude Desktop reads the config file at startup
- Spawns each server as a local subprocess on YOUR machine
- Server has full access to your local filesystem
- Tools appear in the tools menu (hammer icon)
- Restart required after config changes

**Also supports:**
- Desktop Extensions (`.mcpb` packages) — one-click install from directory
- Remote MCP servers (Connectors) — HTTP-based, cloud-hosted
- Settings → Extensions for extension management
- Settings → Connectors for remote server management

### Claude Code (CLI) — Three Scopes

**Scope hierarchy (highest priority first):**

| Scope | File | Shared? | Use case |
|---|---|---|---|
| **local** (default) | `~/.claude.json` under project path | No | Personal dev servers |
| **project** | `.mcp.json` in project root | Yes (git) | Team-shared servers |
| **user** | `~/.claude.json` top-level | No | Cross-project servers |

**The `.mcp.json` file is the project scope** — committed to git, shared
with the team. Every developer who clones the repo gets the same MCP servers.

**CLI management:**
```bash
# Add a server (local scope by default)
claude mcp add datacore -- node ./mcp-server/scripts/run-server.mjs

# Add with specific scope
claude mcp add datacore --scope project -- node ./mcp-server/scripts/run-server.mjs

# List servers
claude mcp list

# Check server health
claude mcp get datacore

# Import from Claude Desktop config
claude mcp add-from-claude-desktop
```


### Claude Agent SDK (Programmatic)

**Auto-loads `.mcp.json` from project root:**
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// .mcp.json is loaded automatically
for await (const message of query({
  prompt: "Search datacore for azure accounts",
  options: {
    allowedTools: ["mcp__datacore__*"]
  }
})) { /* ... */ }
```

**Or configure inline:**
```typescript
for await (const message of query({
  prompt: "Log this event",
  options: {
    mcpServers: {
      datacore: {
        command: "node",
        args: ["./mcp-server/scripts/run-server.mjs"]
      }
    }
  }
})) { /* ... */ }
```

### VS Code / Cursor

**VS Code:** MCP config at `.vscode/mcp.json` or discovered from Claude Desktop.
**Cursor:** MCP config at `.cursor/mcp.json`.

Both follow the same `mcpServers` format. The `.mcp.json` at project root
is also supported by some clients — the format is becoming a de facto standard.


## Summary: Where MCP Servers Are Configured

| Client | Config file | Transport | Runs on |
|---|---|---|---|
| **Claude.ai Projects** | `.mcp.json` in project files | stdio | Claude's container |
| **Claude Desktop** | `claude_desktop_config.json` | stdio / HTTP | Your Mac |
| **Claude Code** | `.mcp.json` + `~/.claude.json` | stdio | Your Mac |
| **Claude Agent SDK** | `.mcp.json` or inline code | stdio / HTTP | Your server |
| **VS Code** | `.vscode/mcp.json` | stdio | Your Mac |
| **Cursor** | `.cursor/mcp.json` | stdio | Your Mac |
| **OpenClaw** | `openclaw.json` (mcporter) | stdio | Your Mac |

## Why This Matters for Datacore

The `.mcp.json` file is a **single point of configuration** that makes
the datacore MCP server available across multiple AI tools without
per-tool setup. Drop it in the repo, and every Claude product that
loads the project gets the tools automatically.

This is how the datacore vision scales: one MCP server, one config
file, every AI tool reads and writes to the same data layer.

## The `.mcp.json` Format (De Facto Standard)

```json
{
  "mcpServers": {
    "<server-name>": {
      "command": "<executable>",
      "args": ["<arg1>", "<arg2>"],
      "env": {
        "<ENV_VAR>": "<value>"
      }
    }
  }
}
```

- `command` — the executable to run (must be in PATH or absolute)
- `args` — arguments passed to the command
- `env` — optional environment variables for the server process
- Server communicates via stdio (stdin/stdout as JSON-RPC 2.0)
- Host spawns the server as a child process and manages its lifecycle

## Key Gotchas

1. **stdio servers must not write to stdout** — `console.log()` corrupts
   the JSON-RPC stream. Use `console.error()` for logging.

2. **Restart required** — Claude Desktop needs a full restart after
   config changes. Claude Code picks up `.mcp.json` changes on next session.

3. **Path resolution** — relative paths in `.mcp.json` resolve from
   the project root. Use absolute paths in `claude_desktop_config.json`.

4. **One server process per client** — each Claude product spawns its
   own instance. They don't share a server process. Data is shared
   through the Bronze JSONL files on disk, not through the server.

5. **Dependencies must be installed** — the server won't start if
   `node_modules` doesn't exist. Run `npm install` in `mcp-server/`
   before connecting any client.

---

*This document was written after discovering that `.mcp.json` automatically
made datacore tools available in a Claude.ai project conversation —
without any manual configuration. The discovery itself is an example of
why documentation matters: the mechanism is barely documented in official
sources, and GPT-5.4 created the file without explaining why it would work.*

## MCP Tool Annotations

When you view a tool in the MCP Inspector, you see badges describing
the tool's behavior. These help AI hosts decide whether to ask for
user confirmation before calling.

**Current state:** GPT-5.4 did NOT set any annotations in the code.
The Inspector shows **MCP spec defaults** for both tools:

| Annotation | Default | Meaning |
|---|---|---|
| **Read-only** | ✗ (false) | Assumed to write unless told otherwise |
| **Destructive** | ✓ (true) | Assumed destructive unless told otherwise |
| **Idempotent** | ✗ (false) | Assumed non-idempotent unless told otherwise |
| **Open-world** | ✓ (true) | Assumed to touch external systems |

**Problem:** Both `log_event` and `search` show identical badges.
But `search` is read-only and non-destructive — the defaults are wrong
for it. This is a code improvement to make:

| Annotation | `log_event` (correct) | `search` (should be) |
|---|---|---|
| **Read-only** | ✗ (writes to JSONL) | ✓ (only reads) |
| **Destructive** | ✓ (appends to files) | ✗ (no state change) |
| **Idempotent** | ✗ (creates new event each call) | ✓ (same query = same results) |
| **Open-world** | ✓ (filesystem) | ✓ (filesystem) |

**Why annotations matter for AI hosts:**
- Claude sees "Read-only: ✓" → safe to call without confirmation
- Claude sees "Destructive: ✓" → may ask before calling
- Correct annotations = AI uses tools more confidently and appropriately

**Note (March 21, 2026):** Claude initially claimed the SDK "inferred"
these annotations from tool behavior. This was wrong — they are spec
defaults. Corrected after checking the SDK source code. This is why
we verify claims against source before publishing.

## MCP Protocol Handshake

Visible in MCP Inspector's History panel:

```
1. initialize     → Client sends capabilities, server responds with its own
2. tools/list     → Client asks "what tools do you have?"
                    Server responds with tool schemas
3. tools/call     → Client calls a tool with arguments
                    Server executes, returns result
```

JSON-RPC 2.0 over stdio. Same handshake happens when Claude.ai connects
via `.mcp.json` — you just don't see it in the chat interface.

## MCP Inspector Tabs (the full protocol surface)

All visible at `localhost:6274` when connected:

| Tab | MCP Primitive | Datacore status | Phase |
|---|---|---|---|
| **Tools** | Actions AI can call | ✅ `log_event` + `search` | 1 (now) |
| **Resources** | Read-only data (URI-based) | Empty | 3 |
| **Prompts** | Reusable templates | Empty | 4 |
| **Apps** | Interactive UI widgets | Empty | Future |
| **Tasks** | Long-running async ops | Empty | Future |
| **Ping** | Server health check | ✅ Works | Built-in |
| **Sampling** | Server asks AI to generate | Empty | Future |
| **Elicitations** | Server asks user for input | Empty | Future |
| **Roots** | Project directories | Empty | Future |
| **Auth** | OAuth configuration | Empty (stdio) | 2 (HTTP) |
| **Metadata** | Server info + capabilities | ✅ v0.1.0 | Built-in |

Each tab is a capability in the MCP spec. The foundation (Tools) is
working. Everything else is additive — implement as the project grows.
