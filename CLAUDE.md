# Datacore — Agent Guidelines

## Project overview

Cross-agent memory layer. MCP server exposing `log_event`, `search`,
`get_tasks`, `deep_search`, `get_facts`, and `add_entity` tools.

**Backends (Phase 5+):**
- **Bronze/Gold primary**: Azure Cosmos DB (`cosmos-datacore`, `rg-datacore`, australiaeast) — enabled when `COSMOS_ENDPOINT` + `COSMOS_KEY` are set
- **Bronze/Gold fallback**: Local JSONL files at `~/.datacore/` — used when Cosmos vars are absent
- **Silver**: Azure Databricks (Vector Search + managed embeddings)

**To enable Cosmos DB**, set these env vars (or add to `~/.zshrc`):
```bash
export COSMOS_ENDPOINT=https://cosmos-datacore.documents.azure.com:443/
export COSMOS_KEY=<from: az cosmosdb keys list --name cosmos-datacore --resource-group rg-datacore --query primaryMasterKey -o tsv>
```

## Build & test commands

```bash
pnpm run build              # TypeScript → dist/
pnpm run lint               # ESLint strict checks
pnpm run format:check       # Prettier formatting check
pnpm run format             # Auto-format all files
pnpm run test               # 56 tests across 5 suites
pnpm run start              # Run compiled server (dist/server.js)
```

## MemoBridge ingestion

MemoBridge captures land in Databricks (`default.memobridge_events`). Pull them into Bronze before running searches so every AI can see the same history.

1. Export credentials (`DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `MEMOBRIDGE_WAREHOUSE`). Optional overrides: `MEMOBRIDGE_TABLE`, `MEMOBRIDGE_SCHEMA`, `MEMOBRIDGE_CATALOG`, `SYNC_LIMIT`, `DATACORE_BRONZE_DIR`.
2. Run `pnpm run sync:memobridge` (wrapper around `node scripts/sync-memobridge.mjs`).
3. The script appends JSONL rows to `~/.datacore/bronze/YYYY-MM-DD.jsonl`, tags them with `context.origin = "memobridge"`, and stores the source timestamp in `context.source_timestamp`.
4. Checkpoint lives at `~/.datacore/.memobridge-sync-marker` so repeated runs only fetch new rows.

Imported rows immediately show up in `search`, `deep_search`, dashboards, and task board context.

## Workflow requirements

**Before finishing any task**, always:

1. Run `pnpm run build` — TypeScript must compile clean
2. Run `pnpm run lint` — zero warnings, zero errors
3. Run `pnpm run test` — all 56 tests must pass
4. Run `pnpm run format:check` — all files must be formatted
5. Update this file if you discovered a new gotcha

## Documentation Rules

- This file is the canonical source for Datacore metrics (test counts, tool lists, Bronze totals). Other docs should link here rather than duplicate numbers.
- After completing any Datacore task:
  1. Run `./scripts/check-docs.sh` from the Developer root.
  2. `grep -R "<value>" docs/ datacore/CLAUDE.md` for every value you changed. Update or replace duplicates with pointers.
  3. Record the sweep in `task_completed` (example: `Docs checked: check-docs.sh clean; grep for "56 tests" clean`).
- Reviewers rerun the same commands before logging `task_reviewed`. Missing proof or failing doc checks = automatic send-back.
- When you edit shared docs (backlog, workflow, ops guide), coordinate with the owners listed in `docs/DOC-DISCIPLINE.md` so currency stays intact.

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
  gold-store.ts     ← How are Gold entities stored? (upsert, query, JSONL)
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

Gold entities are JSONL files at `~/.datacore/gold/{type}s.jsonl`.
Structured facts extracted from Bronze. Entity fields: entity_type,
entity_id, summary, project, tags, source_events, data, created_at, updated_at.
Upsert logic: same summary+project = update, otherwise create new.
Promote from Bronze: `node scripts/promote-to-gold.mjs`.

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
        Tests           ✅  56 tests, 5 suites
          Formatter     ✅  Prettier configured
            Schemas     ✅  Zod on all 8 tools
```

## Documentation rules

This CLAUDE.md is the **canonical source** for all datacore metrics. Other
docs (project-map.md, onboarding.md, DEVELOPER-GUIDE.md) must LINK here,
not duplicate numbers. See `docs/workflow.md` Section 6.5.

After completing any task that changes code behavior:
1. Run `pnpm run check` — must pass clean
2. `git status --short` — must return empty (commit your work)
3. `grep -rn "old_value" ~/Developer/docs/ ~/Developer/*/CLAUDE.md` — fix stale refs
4. Include in task_completed event: "Docs checked: [clean | updated X, Y, Z]"
5. Include proof: exact commands run and their output

If you changed a metric (test count, tool count, event count):
- Update ONLY this CLAUDE.md
- Do NOT update other docs — they point here
