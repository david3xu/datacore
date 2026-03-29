# Datacore — Shared Memory for AI Agents

> The coordination layer between multiple AI models working on the same projects.
> Every AI reads and writes to one data layer. Knowledge compounds across sessions.
> Built with Azure-native data engineering patterns. Portfolio-grade architecture.

## The Problem

You work with multiple AI models every day. Claude architects and reviews.
GPT writes code. Gemini handles long documents. Copilot works inside Microsoft 365.
Each produces knowledge — decisions, code, insights, search results.

Without coordination, that knowledge scatters:
- Claude's conversation stays on Anthropic's servers
- OpenClaw's session is a local JSONL file
- GPT's output lives in a separate chat history
- Git commits, LinkedIn posts, project docs — all siloed

No AI has the full picture. Every new session starts from zero. The human
must manually relay context between models. This is the scattered data problem
at the AI coordination level.

## The Solution

Datacore is an MCP server that every AI agent connects to. One protocol,
one data layer, every AI reads and writes through it.

```
YOU (human)
  Set direction, make decisions, ask questions
  │
  ├── Claude (brain)           ──── log_event, search, add_entity ────┐
  │   Architects, reviews,                                            │
  │   judges other AIs' work                                          │
  │                                                                   │
  ├── GPT-5.4 via OpenClaw (hands) ── log_event, search ─────────────┤
  │   Writes code, runs tests,                                       │
  │   builds prototypes                                               ▼
  │                                                          ┌──────────────┐
  ├── Gemini (long context)    ──── log_event, search ──────→│   DATACORE   │
  │   Reads large docs,                                      │  MCP Server  │
  │   deep analysis                                          │              │
  │                                                          │  Bronze: raw │
  └── M365 Copilot (work data) ── log_event, search ───────→│  Silver: KG  │
      Emails, calendar,                                      │  Gold: facts │
      SharePoint, Teams                                      └──────────────┘
```

Every AI logs what it does. Every AI can search what others did.
The brain AI reviews the hands' work. No context is ever lost.

## How It Works

**MCP (Model Context Protocol)** is an open standard for connecting AI
apps to external data. Claude, ChatGPT, Gemini, VS Code, and OpenClaw
all support MCP. Datacore is an MCP server that exposes:

**Write tools** — how data gets in:
- `log_event` → raw event to Bronze (any AI can call this)
- `add_entity` → structured fact to Gold layer (upserts by content hash)

**Read tools** — how data comes out:
- `search` → keyword grep across all local Bronze events (instant)
- `deep_search` → semantic search via Azure Databricks Vector Search (meaning-based)
- `get_tasks` → task board derived from task events
- `get_facts` → structured Gold entities (decisions, capabilities, facts)
- `get_questions` → async AI-to-AI question/answer protocol (R14)

## Architecture: Medallion + Knowledge Graph + MCP

Data flows through three quality layers (Azure Databricks Medallion pattern):

```
Bronze (raw)     — Every event as-is. Append-only JSONL / Delta tables.
                   "What exactly happened?" → replay any moment.

Silver (refined) — Extracted entities, normalized events, knowledge graph.
                   "What do I know about X?" → structured answers.

Gold (curated)   — Verified facts, cached answers, decision records.
                   "What's the answer?" → instant, no search needed.
```

The **knowledge graph** spans all three layers as the map connecting entities
to their data at every resolution. Entity types emerge from real search
failures, not upfront design.

## Proof of Concept: March 21, 2026

In one session: Claude designed the MCP architecture and updated docs.
GPT-5.4 (via OpenClaw) built the actual mcp-server code, wrote a decision
memo, and ran smoke tests. When Claude started the next review, it had to
manually discover what GPT-5.4 did — checking timestamps, reading files,
comparing changes across the filesystem.

If the MCP server had been running:
- GPT-5.4 calls `log_event` for every decision and action
- Claude calls `search("what happened since last session")`
- Instant answer. No filesystem archaeology.

That gap is exactly what datacore solves.

## What This Demonstrates (Portfolio)

| Skill | Implementation | Azure Service |
|---|---|---|
| MCP server development | TypeScript, 7 tools, stdio transport | — |
| Data lake architecture | Medallion pattern (Bronze/Silver/Gold) | ADLS Gen2 + Databricks |
| Semantic search | Hybrid keyword + vector search | Mosaic AI Vector Search |
| Managed embeddings | Auto-embed from Delta table | Foundation Model APIs (gte-large-en) |
| Real-time ingestion | Session watchers → JSONL → Delta | Auto Loader (planned) |
| Infrastructure as Code | Bicep templates, automated setup | Azure Resource Manager |
| Multi-agent coordination | Shared data layer via MCP protocol | — |
| Data governance | Unity Catalog, schema evolution | Unity Catalog |

## Current Status

- **Datacore metrics** — See `datacore/CLAUDE.md` for the canonical list of MCP tools, test counts, and release notes (current tag v0.3.0).
- **MemoBridge** — Chrome extension feeding Databricks (`default.memobridge_events`). Stages 1–4 are complete (semantic search, auto-context, auto-start warehouse).
- **Multi-agent topology** — Claude (architect), Codex/Gemini (builders), OpenClaw (manager). Capabilities tracked in Gold entities; dispatch-to.sh provides GUI wakeups.
- **Infrastructure** — Bronze JSONL store in `~/.datacore/bronze`, Silver on Azure Databricks (Vector Search paused for cost control), Gold JSONL facts.
- **Tooling** — GitHub Actions (format → lint → build → test), launchd session watchers, dashboards under `docs/dashboard/`.
- **Focus areas** — MemoBridge → Bronze ingestion (DC-T2), Chrome Web Store submission, async comms hardening (R13/R16/R17/R18).

## Syncing MemoBridge captures into Bronze

MemoBridge saves captures inside Databricks (default table `default.memobridge_events`). Run `scripts/sync-memobridge.mjs` to pull those rows into the local Bronze store so `search`, `get_tasks`, and other tools can see them. The script maintains a watermark (`~/.datacore/.memobridge-sync-marker`) so each run only imports new rows.

### Configure credentials

Set these environment variables before running the sync (use a dedicated `.env.memobridge` file if that helps):

```
export DATABRICKS_HOST="community.cloud.databricks.com"
export DATABRICKS_TOKEN="<PAT with SQL access>"
export MEMOBRIDGE_WAREHOUSE="<SQL warehouse ID>"
# Optional overrides
export MEMOBRIDGE_TABLE="default.memobridge_events"
export MEMOBRIDGE_SCHEMA="default"
export MEMOBRIDGE_CATALOG=""
export SYNC_LIMIT=500
export DATACORE_BRONZE_DIR="$HOME/.datacore/bronze"
```

### Run the sync

```
pnpm run sync:memobridge
# or
node scripts/sync-memobridge.mjs
```

Rows are appended to `~/.datacore/bronze/YYYY-MM-DD.jsonl` with `context.origin = "memobridge"` and the original Databricks timestamp preserved in `context.source_timestamp`.

## Project Structure

```
datacore/
├── README.md                ← this file
├── CLAUDE.md                ← agent guidelines (gotchas, patterns, workflow)
├── API.md                   ← MCP tool reference (7 tools, schemas, examples)
├── .github/workflows/       ← CI pipeline
├── mcp-server/
│   ├── src/                 ← TypeScript source (strict mode)
│   │   ├── server.ts        ← how the server starts
│   │   ├── tools.ts         ← MCP tool definitions (Zod schemas)
│   │   ├── store.ts         ← JSONL append, read, file I/O
│   │   ├── search.ts        ← full-text search, filtering
│   │   ├── deep-search.ts   ← Databricks Vector Search client
│   │   ├── tasks.ts         ← task parsing, status board
│   │   ├── types.ts         ← all interfaces
│   │   ├── client.ts        ← programmatic MCP client
│   │   └── paths.ts         ← file path resolution
│   ├── tests/               ← tests (see datacore/CLAUDE.md for live count)
│   ├── scripts/             ← session watchers, export, smoke tests
│   ├── package.json, tsconfig.json, eslint.config.js, .prettierrc
│   └── dist/                ← compiled output (gitignored)
├── notebooks/               ← Databricks notebooks (Bronze ingest, Vector Search)
├── diagrams/                ← architecture diagrams (referenced above)
├── infra/                   ← Azure IaC (Bicep + Databricks setup)
└── hooks/                   ← OpenClaw auto-log hook
```

## Codex post-execution logging (R13)

Codex Desktop runs headless, so its work needs to be summarized manually after a session.
Use `scripts/codex-postexec.mjs` to scan `.codex/sessions/**/*.jsonl`, extract commits/PRs/errors, and log a Datacore summary via `log_event`.

### Quick start

```bash
cd "~/Library/CloudStorage/OneDrive-Curtin/Developer/datacore"
pnpm run codex:postexec                # most recent session
pnpm run codex:postexec -- --count 3   # summarize last 3 sessions
pnpm run codex:postexec -- --since 60  # sessions updated in last hour
pnpm run codex:postexec -- --file ~/.codex/sessions/2026/03/29/rollout-...jsonl
```

Each run writes a `builder_summary` event with the git directives, final response, and any errors.
Pass `--dry-run` to preview the summary without logging.

## OpenClaw GUI dispatcher (R18)

OpenClaw can now wake Claude Desktop, Codex (VS Code), and Gemini (Antigravity/Chrome) with a single command:

```bash
cd "~/Library/CloudStorage/OneDrive-Curtin/Developer/datacore"
./scripts/dispatch-to.sh claude-desktop "Review GOLD-PHASE-1"
```

Features:
- AppleScript automation per platform (new chat, clipboard-safe paste, send)
- Clipboard backup/restore, multi-line messages, `BRIEFING` env fallback
- In-progress guard via `get_tasks(assigned_to: X, status: "in_progress")` (use `--force` to override)
- `--dry-run` mode + Datacore logging (`log_event`, type `dispatch`)
- Gemini path auto-detects Antigravity; falls back to Chrome when the app isn’t installed

Options: `--dry-run`, `--force`, `--message-file path`. Aliases (`claude`, `code`, `antigravity`, etc.) are supported.

