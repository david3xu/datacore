# Datacore — Agent Guidelines

## Project overview

Cross-agent memory layer. MCP server exposing `log_event`, `search`,
`get_tasks`, and `deep_search` tools. Bronze JSONL store locally.
Silver layer on Azure Databricks (Vector Search + managed embeddings).
Designed for Gold (curated facts) layer next.

## Build & test commands

```bash
pnpm run build              # TypeScript → dist/
pnpm run lint               # ESLint strict checks
pnpm run format:check       # Prettier formatting check
pnpm run format             # Auto-format all files
pnpm run test               # 23 tests across 3 suites
pnpm run start              # Run compiled server (dist/server.js)
```

## Workflow requirements

**Before finishing any task**, always:

1. Run `pnpm run build` — TypeScript must compile clean
2. Run `pnpm run lint` — zero warnings, zero errors
3. Run `pnpm run test` — all 23 tests must pass
4. Run `pnpm run format:check` — all files must be formatted
5. Update this file if you discovered a new gotcha

Pre-commit hook enforces: format:check → lint → build → test.
CI enforces the same on every push.

## Structural principles

These are not preferences — they are design rules learned from
studying professional codebases. Violating them creates the mess
we already cleaned up once.

**Every item in the repo must serve the pipeline.**
Ask: "What compiles, tests, deploys, serves, or instructs with this file?"
If the answer is nothing — it doesn't belong in the repo. Design docs,
research notes, migration records, and plans serve the developer's
thinking, not the software pipeline. They go in the personal workspace
(`developer/docs/datacore/`), not here.

**Every directory answers ONE question: "What does this do in the system?"**
Never organize by file type ("docs/", "config/", "utils/") or by when
something was created ("archive/", "old/"). Organize by function:

```
src/       → compiler reads this
tests/     → test runner reads this
scripts/   → human or agent runs this
diagrams/  → README references this
infra/     → Azure deployment reads this
.github/   → CI reads this
```

**Every source file answers ONE question.**
Put the question as a comment on line 1. If a file answers two
questions, split it. This is how we went from 2 bloated files
(bronze-store.ts at 423 lines, index.ts at 231 lines) to 8 focused
files where you can find anything by asking "what does X do?"

**Only README.md and CLAUDE.md at root.**
README serves GitHub visitors. CLAUDE.md serves AI agents and developers.
No other markdown files. No docs/ directory. The code structure IS the
architecture documentation — you see it by reading the src/ tree.

**New files must follow the mirroring principle.**
When you add a concept (e.g., Silver layer), its name should appear
consistently: `silver-store.ts` in src/, `silver.test.mjs` in tests/,
"Silver" section in CLAUDE.md. Trace any concept by name.

## Architecture

```
mcp-server/src/
  server.ts         ← How does the server start?
  tools.ts          ← What can agents do? (Zod schemas, tool registration)
  store.ts          ← How is data stored? (append, read, file I/O)
  search.ts         ← How is data found? (full-text, filtering, snippets)
  deep-search.ts    ← How does semantic search work? (Databricks Vector Search API)
  tasks.ts          ← How are tasks tracked? (task parsing, status, board)
  types.ts          ← What shapes exist? (all interfaces)
  client.ts         ← How to connect programmatically?
  paths.ts          ← Where are files?
```

Each file answers ONE question. No file has two jobs.

Source is TypeScript (strict mode). Compiled to `dist/` via `pnpm run build`.
Tests import from `dist/`. Entry point: `dist/server.js`.

Bronze events are JSONL files at `~/.datacore/bronze/YYYY-MM-DD.jsonl`.
One file per day. Events have: source, type, content, context, _timestamp,
_source, _event_id.

Silver layer lives on Azure Databricks:
- Delta table: `datacore_databricks.datacore.bronze_events` (2,194 events)
- Vector Search endpoint: `datacore-search` (ONLINE, serverless)
- Index: `datacore_databricks.datacore.bronze_events_index`
- Embeddings: `databricks-gte-large-en` (managed, auto-sync from Delta)
- `deep_search` tool queries this via REST API using PAT token
- Requires env vars: `DATABRICKS_HOST`, `DATABRICKS_TOKEN`

## Gotchas

These are real mistakes that happened. Each one is a rule now.

**1. Content must be plain searchable text, not JSON.**
`search()` does case-insensitive grep. If content is a JSON blob,
search terms won't match natural language. Always write content
as a self-contained briefing paragraph.

**2. Source must be the actual AI app, not "user".**
Sources: `claude.ai`, `claude-desktop`, `openclaw`, `codex-session`,
`gemini-antigravity`, `manual`. Never "user" or "human".

**3. Type values are specific, not freeform.**
Types: `conversation`, `decision`, `action`, `insight`, `problem`,
`task_created`, `task_assigned`, `task_started`, `task_completed`,
`task_reviewed`. Don't invent new types without updating this file.

**4. Context is an object, not a string.**
`context: { session: "2026-03-23", project: "datacore" }`
Not: `context: "session 2026-03-23"`

**5. JSONL files are append-only. Never edit or delete events.**
If an event was wrong, log a correction event. Don't modify history.

**6. `get_tasks` parses task events, not a separate database.**
Tasks are derived from `type="task_*"` events. Status is computed
from the latest event for each task_id. There is no task table.

**7. Search returns `snippet` not `content`.**
Search results have: `eventId`, `timestamp`, `source`, `type`,
`snippet`, `filePath`. Not `id`, not `content`. Tests verify this.

**8. `appendEvent` returns `{ bronzeDir, filePath, record }`.**
The record has `_event_id` and `_timestamp` (underscore prefix).
Not `id` and `timestamp`. Tests verify this.

**9. MCP entry point is `scripts/run-server.mjs` → `dist/server.js`.**
The `.mcp.json` uses `scripts/run-server.mjs` which imports from
`dist/server.js`. Always run `pnpm run build` before testing MCP.

**10. Never use `any` in TypeScript.**
ESLint enforces `@typescript-eslint/no-explicit-any`. Find the
real type. If genuinely unknown, use `unknown` and narrow with
type guards.

## Code style

### TypeScript
- Strict mode (`strict: true` in tsconfig)
- `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`
- ES modules only (`import`/`export`, not `require`)
- Interfaces for all function parameters and return types
- `unknown` over `any` — narrow with type guards
- `as const` for literal types in return objects

### General
- Zod for schema validation on MCP tool inputs
- No external dependencies beyond `@modelcontextprotocol/sdk` and `zod`
- Functions return typed objects, not strings
- Error messages should be user-readable, not stack traces
- `eqeqeq` enforced — no `==` ever, always `===`
- `prefer-const` — never use `let` if the value doesn't change

## Test patterns

Tests live in `mcp-server/tests/*.test.mjs` (Node.js built-in runner).
Each test file uses a temp directory (`os.tmpdir()`) — never real data.

```
tests/
  log-event.test.mjs   ← 4 tests: write, file creation, JSON validity, context
  search.test.mjs      ← 7 tests: keyword, empty, case, source/type filter, max, metadata
  get-tasks.test.mjs   ← 6 tests: active/completed/all, history, assigned_to, limit
```

Key pattern: `before()` creates tmpDir, sets `DATACORE_BRONZE_DIR` env var.
`after()` deletes tmpDir and unsets env var. Tests never touch `~/.datacore/`.

## Constraint stack

```
CI (GitHub Actions)     ✅  format → lint → build → test
  Pre-commit hook       ✅  same checks locally
    Linter (ESLint)     ✅  strict, no-any, eqeqeq
      Types (TypeScript)✅  strict mode, compiled
        Tests           ✅  23 tests, 3 suites
          Formatter     ✅  Prettier configured
            Schemas     ✅  Zod on all 4 tools
```
