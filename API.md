# Datacore MCP API Reference

> Generated from `mcp-server/src/tools.ts` Zod schemas.
> Keep in sync with tools.ts when adding/changing tools.
> Last updated: March 26, 2026 (4 tools, v0.2.0)

## Overview

Datacore exposes 4 MCP tools via stdio transport. All inputs are validated
with Zod schemas at the boundary — invalid input is rejected before any
processing occurs.

| Tool | Purpose | Reads | Writes |
|---|---|---|---|
| `log_event` | Write an event to Bronze | — | JSONL file |
| `search` | Full-text keyword search | Bronze JSONL | — |
| `get_tasks` | Query task board | Bronze JSONL | — |
| `deep_search` | Semantic/hybrid search | Databricks Vector Search | — |

---

## `log_event`

Append a raw event to the local Bronze JSONL store.

**Input schema:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `source` | `string` | Yes | Origin of the event (e.g., `claude.ai`, `openclaw`, `codex-session`) |
| `type` | `string` | Yes | Event type (e.g., `decision`, `action`, `insight`, `conversation`) |
| `content` | `string` | Yes | Event content (min 1 char, sanitized: control chars stripped, max 50K) |
| `context` | `Record<string, unknown>` | No | Structured metadata (project name, session ID, etc.) |

**Behavior:**
- Appends one JSON line to `~/.datacore/bronze/YYYY-MM-DD.jsonl`
- Generates `_event_id` (UUID v4), `_timestamp` (ISO 8601), `_source`
- Content is sanitized: null bytes and control chars stripped, capped at 50,000 chars
- Creates the Bronze directory and daily file if they don't exist

**Example:**
```json
{
  "source": "claude.ai",
  "type": "decision",
  "content": "Chose Databricks Vector Search over local LanceDB for Silver layer",
  "context": { "project": "datacore", "session": "2026-03-26" }
}
```

**Response:** `Logged decision from claude.ai to /path/to/2026-03-26.jsonl`

---

## `search`

Search collected Bronze events using case-insensitive full-text matching.

**Input schema:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | `string` | Yes | — | Search keywords (case-insensitive) |
| `max_results` | `integer` | No | 20 | Max results to return (1–100) |
| `source` | `string` | No | — | Filter by event source |
| `type` | `string` | No | — | Filter by event type |

**Behavior:**
- Reads all Bronze JSONL files (newest first)
- Matches `query` against event `content` field (case-insensitive substring)
- Applies optional `source` and `type` filters
- Returns matching events with 200-char content snippets

**Example:**
```json
{ "query": "databricks vector search", "max_results": 5, "source": "claude.ai" }
```

**Response:** Numbered list of matches with source, type, timestamp, and snippet.

---

## `get_tasks`

Query task board from Bronze events. Tasks are events with type
`task_created`, `task_started`, `task_completed`, etc.

**Input schema:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `status` | `enum` | No | `active` | One of: `active`, `completed`, `failed`, `all` |
| `assigned_to` | `string` | No | — | Filter by assignee |
| `task_type` | `string` | No | — | Filter by task type |
| `task_id` | `string` | No | — | Get full history for one specific task |
| `limit` | `integer` | No | 20 | Max tasks to return (1–50) |

**Two modes:**
- **Board mode** (default): Returns task summary with latest status, assignee, problem
- **History mode** (when `task_id` is provided): Returns full event timeline for one task

**Example (board):**
```json
{ "status": "active", "assigned_to": "codex" }
```

**Example (history):**
```json
{ "task_id": "task-abc-123" }
```

**Response (board):** Task cards with ID, status, assignee, summary, problem.
**Response (history):** Chronological timeline of all events for that task.

---

## `deep_search`

Semantic search over Bronze events using Azure Databricks Vector Search.
Finds events by meaning, not just keywords. Uses `gte-large-en` managed
embeddings for vector similarity.

**Input schema:**

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | `string` | Yes | — | Natural language search query |
| `num_results` | `integer` | No | 5 | Max results (1–20) |
| `source` | `string` | No | — | Filter by event source |
| `type` | `string` | No | — | Filter by event type |
| `mode` | `enum` | No | `hybrid` | `hybrid` (keyword+semantic) or `semantic` (vector only) |

**Behavior:**
- Calls Databricks Vector Search REST API
- Protected by circuit breaker (3 failures → 30s backoff)
- 4xx errors (bad request, auth) do not trip the circuit breaker
- 5xx errors and timeouts do trip the circuit breaker
- When circuit is OPEN, throws `CircuitOpenError` immediately

**Requires:** `DATABRICKS_HOST` and `DATABRICKS_TOKEN` environment variables.

**Example:**
```json
{ "query": "how did we decide on the Silver layer architecture", "num_results": 3 }
```

**Response:** Ranked results with source, type, timestamp, and content.

**Error cases:**
- Missing env vars → returns setup instructions (not an error)
- Circuit open → throws `CircuitOpenError` with backoff timer
- API 4xx → throws error, does NOT count as failure
- API 5xx → throws error, counts toward circuit breaker threshold

---

## `get_facts`

Query Gold entities — structured facts extracted from Bronze events.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| entity_type | string | no | — | Filter: decision, fact, project, tool |
| project | string | no | — | Filter by project name (partial match) |
| tag | string | no | — | Filter by tag (partial match) |
| query | string | no | — | Keyword search in summary and data |

**Example:**
```json
{ "entity_type": "decision", "project": "datacore" }
```

Returns `{ entities: GoldEntity[], total: number }`.

---

## `add_entity`

Create or update a Gold entity. Upserts by summary+project (SHA-256 content hash).

| Parameter | Type | Required | Description |
|---|---|---|---|
| entity_type | string | yes | Entity type (decision, fact, project, tool, or custom) |
| summary | string | yes | One-sentence summary |
| project | string | no | Project this entity belongs to |
| tags | string[] | no | Tags for filtering |
| source_events | string[] | no | Bronze event IDs that inform this entity |
| data | object | no | Structured entity data |

**Example:**
```json
{ "entity_type": "decision", "summary": "Use Databricks over LanceDB", "project": "datacore" }
```

Returns `{ entity_id, file_path, action: "created" | "updated" }`.

---

## `get_questions`

Query async questions between AI agents (R14 protocol).
Agents post questions via `log_event(type="question")`, others answer via `log_event(type="answer")`.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| directed_to | string | no | — | Filter: who the question is aimed at |
| status | string | no | "open" | "open", "answered", or "all" |
| task_id | string | no | — | Filter by task context |
| limit | number | no | 10 | Max results |

**Question event format** (logged via `log_event`):
```json
{
  "source": "gemini", "type": "question",
  "content": "Should entity_type be enum or free string?",
  "context": { "thread_id": "q-2026-03-26-001", "task_id": "GOLD-PHASE-1",
               "asked_by": "gemini", "directed_to": "claude-desktop", "status": "open" }
}
```

**Answer event format:**
```json
{
  "source": "claude-desktop", "type": "answer",
  "content": "Free string. Validate at display time.",
  "context": { "thread_id": "q-2026-03-26-001", "answered_by": "claude-desktop", "status": "answered" }
}
```

Returns `{ total, questions: QuestionSummary[] }`.

---

## Connection

Transport: **stdio** (stdin/stdout JSON-RPC)
Protocol: MCP (Model Context Protocol)
Server name: `datacore`
Version: `0.2.0`

**Claude Desktop config** (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "datacore": {
      "command": "node",
      "args": ["/path/to/datacore/mcp-server/dist/server.js"],
      "env": {
        "DATACORE_BRONZE_DIR": "/Users/you/.datacore/bronze",
        "DATABRICKS_HOST": "https://your-workspace.azuredatabricks.net",
        "DATABRICKS_TOKEN": "dapi..."
      }
    }
  }
}
```
