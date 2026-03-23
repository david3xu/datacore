# Claude Code Guidelines for Datacore

> Learned from experience, not written upfront.
> Every rule here exists because an AI made a mistake.

## Project Overview

Datacore is a cross-agent memory layer. MCP server exposing log_event,
search, and get_tasks tools. Bronze JSONL store. Designed for Silver
(semantic search) and Gold (curated facts) layers.

## Build & Test

```bash
node mcp-server/src/index.mjs                    # Run MCP server directly
DATACORE_BRONZE_DIR=~/.datacore/bronze node mcp-server/src/index.mjs
cd mcp-server && npm test                         # Run all 17 tests
cd mcp-server && npm run format:check             # Verify formatting
cd mcp-server && npm run format                   # Auto-format all files
```

No build step. Plain JavaScript ES modules. No TypeScript (yet).

**Before finishing any task:**
1. Run `npm test` — all 17 tests must pass
2. Run `npm run format:check` — all files must be formatted
3. Update CLAUDE.md if you discovered a new gotcha

## Architecture

```
mcp-server/src/
  index.mjs          ← MCP server entry, tool definitions, Zod schemas
  bronze-store.mjs   ← Append-only JSONL read/write, search, task parsing
```

Bronze events are JSONL files at ~/.datacore/bronze/YYYY-MM-DD.jsonl.
One file per day. Events have: id, timestamp, source, type, content, context.

## Gotchas

**1. Content must be plain searchable text, not JSON.**
search() does case-insensitive grep. If content is a JSON blob,
search terms won't match natural language. Always write content
as a self-contained briefing paragraph.

**2. source must be the actual AI app, not "user".**
Sources: claude.ai, claude-desktop, openclaw, codex-session,
gemini-antigravity, manual. Never "user" or "human".

**3. type values are specific, not freeform.**
Types: conversation, decision, action, insight, problem,
task_created, task_assigned, task_started, task_completed,
task_reviewed. Don't invent new types without updating SCHEMA.md.

**4. context is an object, not a string.**
context: { session: "2026-03-23", project: "datacore" }
Not: context: "session 2026-03-23"

**5. JSONL files are append-only. Never edit or delete events.**
If an event was wrong, log a correction event. Don't modify history.

**6. get_tasks parses task events, not a separate database.**
Tasks are derived from type="task_*" events. Status is computed from
the latest event for each task_id. There is no task table.

**7. search returns max_results most recent matches, not all.**
Default max_results=20. For comprehensive searches, set max_results=100.

**8. File watcher events have source like "codex-session" not "codex".**
The source string must match the watcher that produced it.

## Code Style

- ES modules only (import/export, not require)
- Zod for schema validation on tool inputs
- No external dependencies beyond @modelcontextprotocol/sdk and zod
- Functions return objects, not strings
- Error messages should be user-readable, not stack traces
- See CODE-DISCIPLINE.md for the constraint stack plan
