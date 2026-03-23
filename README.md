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
- `add_entity` → extracted entity to knowledge graph (Phase 3)
- `add_fact` → curated answer to Gold (Phase 4)

**Read tools** — how data comes out:
- `search` → full-text across all collected data
- `get_entity` → knowledge graph lookup
- `get_facts` → cached answers for known questions

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
| MCP server development | TypeScript/Python, stdio + HTTP | — |
| Data lake architecture | Medallion pattern (Bronze/Silver/Gold) | ADLS Gen2 + Databricks |
| Real-time ingestion | MCP write tools → JSONL → Delta | Auto Loader + Lakeflow |
| Knowledge graph | Entity extraction from AI interactions | Databricks + Vector Search |
| Infrastructure as Code | Bicep templates, automated setup | Azure Resource Manager |
| Multi-agent coordination | Shared data layer via MCP protocol | — |
| Data governance | Unity Catalog, schema evolution | Unity Catalog |

## Current Status

```
RESEARCH  ✅  7 rounds, 1495 lines, 10/17 claims verified against official docs
DESIGN    ✅  v4: Medallion + Knowledge Graph + MCP server as foundation
BUILD     🔨  MCP server code exists (GPT-5.4 built it), needs testing
              Azure infra deployed: Databricks + ADLS Gen2 + cluster + notebooks
              Manual prototypes superseded: log-session.sh → replaced by MCP log_event
NEXT      →   Install deps, test MCP server, connect to Claude Desktop
```

## Project Structure

```
datacore/
├── README.md                ← this file
├── DESIGN.md                ← architecture (Medallion + KG + MCP)
├── DATA-ARCHITECTURE.md     ← data engineering: local → Azure Databricks migration path
├── MEMORY-ARCHITECTURE.md   ← 4-layer memory model (Identity/Working/Project/Shared)
├── MCP-DECISION-MEMO.md     ← MCP research decisions (verified sources only)
├── PLAN.md                  ← Phase 1 task breakdown
├── archive/DIGEST.md        ← verified findings from official Azure docs (archived)
├── mcp-server/              ← THE FOUNDATION
│   ├── src/index.mjs        ← MCP server (log_event + search tools)
│   ├── src/bronze-store.mjs ← writes JSONL to ~/.datacore/bronze/
│   └── scripts/smoke.mjs    ← end-to-end test
├── infra/                   ← Azure IaC (Bicep + Databricks setup)
├── notebooks/               ← Databricks notebooks (Bronze ingest + search)
├── sample-data/             ← collected data + session logs
├── tasks/                   ← task specs by round (R1-R18+)
├── archive/                 ← deprecated scripts + pre-MCP files (historical)
└── hooks/                   ← OpenClaw auto-log hook
```
