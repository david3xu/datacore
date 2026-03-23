# MCP Server Code Review

> Reviewer: Claude (brain role)
> Author: GPT-5.4 via OpenClaw (hands role)
> Date: March 21, 2026
> Verdict: **7.5/10 — ship-worthy with minor fixes**

## What Was Built

GPT-5.4 built the Phase 1 datacore MCP server in a single OpenClaw session.
The code was discovered by Claude during a subsequent Claude.ai session —
this discovery gap is itself proof of why datacore needs to exist.

### Files Created

| File | Lines | Purpose |
|---|---|---|
| `src/index.mjs` | 74 | MCP server entry: registers `log_event` + `search` tools |
| `src/bronze-store.mjs` | 159 | JSONL storage: append events, full-text search |
| `src/runtime-deps.mjs` | 47 | SDK resolver with openclaw fallback |
| `src/client.mjs` | 129 | Programmatic client for calling tools from other code |
| `src/paths.mjs` | 24 | Path resolution helpers |
| `scripts/smoke.mjs` | 84 | End-to-end test (start server, call tools, assert, cleanup) |
| `scripts/run-server.mjs` | 3 | Thin launcher wrapper |
| `package.json` | 20 | Dependencies: SDK v1.27.1 + Zod v4.3.6 |
| `README.md` | 155 | Setup, usage, tool docs, OpenClaw integration |
| `.mcp.json` | 8 | Claude Code/Desktop auto-discovery config |

Also created:
| File | Lines | Purpose |
|---|---|---|
| `hooks/datacore-mcp-log/handler.js` | 103 | OpenClaw hook: auto-captures inbound/outbound messages |
| `hooks/datacore-mcp-log/HOOK.md` | ? | Hook documentation |


## Architecture Decisions (all correct)

### 1. stdio transport first ✅
Matches MCP spec best practice. Local, simple, no auth needed.
Claude Desktop and OpenClaw both support stdio. Remote HTTP is Phase 2.

### 2. JSONL append-only Bronze store ✅
One file per day (`YYYY-MM-DD.jsonl`). Append-only, never modify.
Matches our Medallion Bronze principle: preserve everything raw.
`DATACORE_BRONZE_DIR` env var allows test isolation.

### 3. UUID event IDs + ISO timestamps ✅
Every event gets `_event_id` (UUID) and `_timestamp` (ISO 8601).
These are added by the server, not the caller — guarantees consistency.

### 4. Separate client library ✅
`client.mjs` exposes `logEventViaMcp()` and `searchViaMcp()` for
programmatic access. Supports shared sessions (reuse connection)
and one-shot sessions (connect, call, disconnect). Forward-thinking
for when other code needs to call datacore without being an MCP host.

### 5. OpenClaw hook system ✅ (the gem)
`hooks/datacore-mcp-log/handler.js` intercepts OpenClaw's message
events and pipes them to datacore via the MCP client library.
This solves the "AI won't auto-log" problem — logging happens at
the platform level, not by the AI deciding to call `log_event`.

Captures both directions:
- `preprocessed` → inbound user messages
- `sent` → outbound agent responses

With rich context: channelId, conversationId, from, to, provider,
surface, transcript, group info. This is exactly the metadata
needed for the knowledge graph later.


## Code Quality Assessment

### Clean patterns observed

- **No `console.log` in server** — critical for stdio transport where
  stdout is the protocol channel. Only `console.error` in the hook
  for error reporting. This is correct.

- **Proper error handling** — `bronze-store.mjs` handles ENOENT (dir
  doesn't exist yet), JSON parse errors (corrupted lines), and empty
  queries. Search returns `parseErrors` count so callers know if data
  was skipped.

- **Smoke test is genuine end-to-end** — creates temp dir, starts
  server as subprocess, calls both tools, asserts results, cleans up.
  Not a unit test pretending to be integration — actually exercises
  the stdio transport and JSON-RPC protocol.

- **Snippet builder is thoughtful** — shows 50 chars before and 80
  chars after the match, with ellipsis markers. Good for AI consumers
  who need context around search hits.

- **Tool schemas use Zod properly** — `z.string().min(1)` prevents
  empty strings, `z.number().int().min(1).max(100)` bounds the search
  limit, `z.record(z.string(), z.unknown()).optional()` for flexible
  context. The MCP SDK generates JSON Schema from these automatically.

### `structuredContent` in tool results

Both tools return `structuredContent` alongside `content` (text array).
This is a newer MCP feature — not all clients support it. The text
fallback ensures compatibility. The structured data is a bonus for
clients that can parse it. Correct approach: include both.


## Issues Found

### Issue 1 — `runtime-deps.mjs` fallback is fragile (medium risk)

**What:** The module resolver tries local `node_modules` first, then
falls back to the sibling `openclaw` checkout's `node_modules`. This
avoids `npm install` during development but creates a hidden dependency.

**Why it matters:** If OpenClaw updates its SDK version, the datacore
server silently picks up a different version. The Zod export chain
(`zodModule.z ?? zodModule.default?.z ?? ...`) suggests the author
wasn't sure which module format would be loaded — a sign of untested
path combinations.

**Also:** It imports client modules (`sdk/client/index.js`,
`sdk/client/stdio.js`) even though the server entry point
(`index.mjs`) doesn't use them. The client imports are only needed
by `client.mjs` and the hook. Top-level await on unused imports
adds startup latency.

**Recommendation:** Run `npm install` and treat local deps as the
primary path. Keep the fallback as a developer convenience but don't
rely on it for production. Consider lazy-importing client modules
only when `client.mjs` is loaded.

**Severity:** Medium — works now but will cause confusing bugs later.

### Issue 2 — Search is O(n) full scan (acceptable for Phase 1)

**What:** `searchEvents()` reads every JSONL file, parses every line,
does string matching on each. Files are sorted newest-first (good for
recency), but there's no indexing, caching, or early termination
across files.

**Why it matters:** For hundreds of events this is instant. For tens
of thousands it will noticeably slow down. Each search re-reads all
files from disk.

**Recommendation:** Acceptable for Phase 1. When this becomes slow,
the fix is the Azure backend (Databricks Delta tables with proper
indexing). Don't optimize the local JSONL search — migrate instead.

**Severity:** Low — won't matter until there's significant data volume.


### Issue 3 — SDK version pinning (low risk)

**What:** `package.json` declares `@modelcontextprotocol/sdk: ^1.27.1`.
The TypeScript SDK v2 is releasing Q1 2026 with new package names
(`@modelcontextprotocol/server` instead of `@modelcontextprotocol/sdk`).

**Why it matters:** The `^1.27.1` range means `npm install` will get
the latest 1.x, which is fine. The v1 import paths (`sdk/server/mcp.js`)
will keep working — Anthropic committed to 6 months of v1 support
after v2 ships.

**Recommendation:** Leave as-is. Migrate to v2 package names when
the codebase needs v2 features (Streamable HTTP, new auth).

**Severity:** Low — no action needed now.

### Issue 4 — Dependencies not installed (blocker for testing)

**What:** `node_modules/` doesn't exist. The smoke test reportedly
passed using the openclaw fallback, but we haven't verified this
ourselves.

**Recommendation:** Run `npm install` before any further work. This
is the first thing to do next.

**Severity:** High for testing, trivial to fix.

### Issue 5 — No graceful shutdown handling

**What:** The server connects to stdio transport and runs. There's no
`SIGINT`/`SIGTERM` handler, no cleanup on exit. For a stdio server
that's process-managed (Claude Desktop spawns and kills it), this is
less critical than for a long-running HTTP server.

**Recommendation:** Add basic signal handling for clean shutdown. Not
urgent — the process lifecycle is managed by the host.

**Severity:** Low.

### Issue 6 — No tool annotations set (low risk, easy fix)

**What:** Neither tool has MCP annotations (`readOnlyHint`,
`destructiveHint`, `idempotentHint`, `openWorldHint`). The MCP
Inspector shows spec defaults for both tools — identical badges.

**Why it matters:** The `search` tool should declare `readOnlyHint: true`
and `destructiveHint: false`. Without this, AI hosts treat `search`
the same as `log_event` — potentially asking for confirmation on
a read-only operation. Correct annotations let AI hosts call
read-only tools more freely.

**Fix:** Add annotations to both tool registrations in `index.mjs`.
Example for search:
```javascript
server.tool(
  "search",
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  "Search collected Bronze events...",
  { ... schema ... },
  async handler
);
```

**Severity:** Low — tools work without annotations, but correct
annotations improve AI host behavior.


## What's Missing (not bugs — future work)

| Feature | Why not now | When |
|---|---|---|
| Remote HTTP transport | Phase 1 is local stdio | Phase 2 (when Claude.ai web needs it) |
| Resources primitive | Our read operations are dynamic queries, not static data | Phase 3 (for entity:// URIs) |
| Prompts primitive | No recurring interaction patterns yet | Phase 4 (if useful) |
| Auth/security | Local stdio doesn't need auth | Phase 2 (when HTTP transport added) |
| ADLS Gen2 backend | Local JSONL is fine for Phase 1 | Phase 2 (connect to Azure) |
| Error recovery | Server crashes = host restarts it | Phase 5 (production hardening) |

## Comparison with Our Design

| Design decision | What we designed | What was built | Match? |
|---|---|---|---|
| Transport | stdio first | stdio only | ✅ |
| Write tool | `log_event` | `log_event` | ✅ |
| Read tool | `search` | `search` | ✅ |
| Storage | JSONL to `~/.datacore/bronze/` | JSONL to `~/.datacore/bronze/` | ✅ |
| Metadata | `_timestamp`, `_source`, `_event_id` | All three present | ✅ |
| Schema enforcement | None (Bronze = raw) | None (accepts any content) | ✅ |
| MCP SDK | TypeScript v1 | v1.27.1 | ✅ |
| OpenClaw integration | "via mcporter bridge" | Hook system (better) | ✅+ |
| Claude.ai auto-logging | Assumed AI calls tools | Hook-based (correct) | ✅+ |

Two items exceeded our design: the OpenClaw hook system and the
programmatic client library. Both are valuable additions we didn't plan.

## Final Verdict

**7.5/10 — Ship it.**

The code is clean, the architecture matches our design, and the hook
system is a genuine improvement over what we planned. The runtime-deps
fallback is the main concern — fix it by installing local deps.

**Next steps (in order):**
1. `cd mcp-server && npm install` — fix the dependency blocker
2. `npm run smoke` — verify the test passes with local deps
3. Connect to Claude Desktop — first real client integration
4. Connect to OpenClaw via hook — automatic conversation capture
5. Use it for 1-2 weeks — discover entity types from real searches

---

*This review was conducted by Claude (brain role) reviewing GPT-5.4's
(hands role) work. The review itself is stored in the datacore repo as
documentation — not just chat history that gets lost.*
