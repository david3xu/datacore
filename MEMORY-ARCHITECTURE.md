# Memory Architecture Design

> Added to Datacore DESIGN.md — March 23, 2026
> Context: OpenClaw burning tokens from 59KB session dump in workspace/memory/.
> Root cause: no designed boundary between 5 memory layers that already exist.

## The Problem

Every AI agent has memory scattered across multiple systems with no design
principle for what goes where:

```
CURRENT STATE (undesigned):

OpenClaw:       SOUL.md + AGENTS.md + TOOLS.md + memory.md + memory/*.md
                → 6,000 tokens system prompt EVERY turn
                → 59KB session dump in memory/ (15K tokens indexed)
                → session-memory hook auto-dumps on /new

Claude Desktop: conversation history (internal, not accessible)
                + project .claude/CLAUDE.md (62 lines, loaded per session)
                + global ~/.claude/CLAUDE.md (11 lines, auto-logging)

Codex:          session files (~/.codex/sessions/)
                + project .codex/CODEX.md (58 lines)

Gemini:         session files (~/.gemini/antigravity/*.pb)
                + project .gemini/GEMINI.md (64 lines)
                + global ~/.gemini/GEMINI.md (11 lines)

Datacore:       20,900+ events in Bronze JSONL
                searchable by ALL AIs via MCP
                → but basic grep only, no semantic search
```

Problems:
1. OpenClaw's session-memory captures the SAME data Datacore already has
2. AGENTS.md (2,300 tokens) loads the full team org chart every turn —
   OpenClaw only needs it when dispatching
3. Each AI's project config duplicates role/logging rules
4. No AI can access another AI's internal memory
5. Datacore has 20K events but only basic grep — no semantic recall

## Design Principle: Four Memory Layers

Each layer has a clear purpose, boundary, and reason for existing.
Data flows DOWN (from fast/small to slow/large), never duplicated
across layers.

```
LAYER 1 — IDENTITY (static, per-AI, <500 tokens)
│
│   What: Who you are. Your role. Your tools. Nothing else.
│   Where: Project config files (.claude/CLAUDE.md, .codex/CODEX.md, etc.)
│   Loaded: Every turn (injected into system prompt)
│   Changes: Only when team structure changes
│   Size budget: <500 tokens per AI — this is the tax on every message
│
│   Contains:
│     - Role name (Tech Lead / Builder / Manager)
│     - 3-line startup routine (check tasks, check questions)
│     - Source of truth pointer ("see docs/workflow.md for details")
│     - Logging format (which source name, which event types)
│
│   Does NOT contain:
│     - Full org chart (get from Datacore if needed)
│     - Full workflow rules (read docs/workflow.md on demand)
│     - Task history or context from past sessions
│
├─────────────────────────────────────────────────────────
│
LAYER 2 — WORKING MEMORY (ephemeral, per-AI, per-session)
│
│   What: The AI's current conversation. Intermediate thoughts.
│          Draft reasoning. Things it's working on RIGHT NOW.
│   Where: Each app's internal session management
│     - OpenClaw: session transcript in ~/.openclaw/sessions/
│     - Claude Desktop: internal conversation buffer
│     - Codex: ~/.codex/sessions/
│     - Gemini: ~/.gemini/antigravity/*.pb
│   Loaded: Automatically by each app (not our concern)
│   Lifetime: One session. Compacted or discarded on /new.
│
│   This is PRIVATE. No other AI reads it directly.
│   File watchers capture it INTO Datacore (Layer 4) automatically.
│
│   Key rule: when a session ends, working memory is NOT preserved
│   in the AI's own system. It flows to Datacore via watchers/hooks.
│   The AI does not need to "remember" — Datacore remembers for it.
│
├─────────────────────────────────────────────────────────
│
LAYER 3 — PROJECT KNOWLEDGE (on-demand, shared files, read when needed)
│
│   What: Design documents, workflow rules, architecture decisions.
│          Reference material that any AI can read but doesn't need
│          loaded on every turn.
│   Where: Files on disk in the project
│     - docs/workflow.md (team operating agreement)
│     - datacore/DESIGN.md (architecture)
│     - datacore/TASK-MANAGEMENT-DESIGN.md (task lifecycle)
│     - datacore/AI-ORG-CHART.md (team structure)
│   Loaded: On demand — AI reads the file when it needs the info
│   Size: Unlimited — it's just files, not injected into context
│
│   This is the "bookshelf." Every AI can pull a book off the shelf
│   and read it. But you don't carry every book in your backpack.
│
│   Key difference from Layer 1: Layer 1 is always in context.
│   Layer 3 is only in context when the AI reads the file.
│
├─────────────────────────────────────────────────────────
│
LAYER 4 — SHARED MEMORY (persistent, all AIs, searchable)
│
│   What: Everything that happened across all AIs, all sessions.
│          The single source of truth for "what did we do?"
│   Where: Datacore Bronze (~/.datacore/bronze/*.jsonl)
│   Access: MCP tools (log_event, search, get_tasks)
│   Loaded: On demand — AI calls search() when it needs context
│   Size: 20,000+ events and growing
│
│   This is the ONLY place cross-AI coordination happens.
│   No AI talks to another AI directly. They all talk to Datacore.
│
│   Sub-layers (Medallion, future):
│     Bronze: raw events, full-text searchable (NOW)
│     Silver: entities, semantic search, embeddings (FUTURE)
│     Gold: curated facts, instant answers (FUTURE)
│
│   Key rule: Silver replaces OpenClaw's memory_search.
│   Gold replaces curated MEMORY.md / memory.md files.
│   When Datacore has semantic search, no AI needs its own.
│
└─────────────────────────────────────────────────────────
```


## Boundary Rules

### What goes WHERE — decision tree

```
Is this "who I am"?
  YES → Layer 1 (identity config, <500 tokens)

Is this my current train of thought?
  YES → Layer 2 (working memory, private, ephemeral)

Is this a reference document someone might read on demand?
  YES → Layer 3 (project files on disk)

Is this something another AI should be able to find?
  YES → Layer 4 (Datacore shared memory via MCP)
```

### Why each layer exists (and why we can't collapse them)

**Why not put everything in Datacore (Layer 4)?**
Because identity must be loaded on every turn. If OpenClaw had to
call search("what is my role") before every message, that's an extra
MCP round-trip and tool call on every turn. Identity is static — it
belongs in the system prompt.

**Why not put everything in system prompt files (Layer 1)?**
Because token cost. AGENTS.md at 2,300 tokens × every turn × every
session = massive quota burn. The full team workflow is 298 lines.
OpenClaw only needs "you are the Manager" on every turn. It needs
the full workflow only when dispatching a task.

**Why keep Layer 2 (working memory) at all?**
Because each AI app manages its own conversation window. We can't
replace Claude Desktop's internal context management. But we CAN
capture it into Datacore automatically (file watchers do this).
Layer 2 is owned by each app; we just drain it into Layer 4.

**Why have Layer 3 (project files) separate from Layer 4 (Datacore)?**
Because design documents are structured, versioned, and read as
whole files. Datacore events are append-only, searchable, and read
as query results. Different access patterns, different storage.
workflow.md is a document you read top-to-bottom. Datacore events
are facts you search across.

## Data Flow Between Layers

```
Layer 2 (working memory)  ──auto-capture──→  Layer 4 (Datacore)
  │ session ends                               │
  │ file watchers fire                         │ search()
  │ hooks fire                                 │ get_tasks()
  ▼                                            ▼
Layer 2 is gone                    Layer 4 persists forever
(compacted/discarded)              (Bronze = raw, Silver = clean, Gold = curated)

Layer 3 (project files)  ──read on demand──→  AI context
  │                                            │
  │ AI reads file when                         │ only loaded when
  │ it needs reference                         │ task requires it
  ▼                                            ▼
File stays on disk                 Context used, then discarded

Layer 1 (identity)  ──always loaded──→  AI context (every turn)
  │                                     │
  │ static, tiny                        │ <500 tokens
  ▼                                     ▼
Changes only when                  Always present
team restructures
```


## What This Means for Datacore's Medallion Layers

Each Medallion layer maps to a specific memory capability:

```
Bronze  = Layer 4 raw capture
          "What exactly happened?"
          → replay any conversation, grep any event
          → replaces: OpenClaw session-memory hook dumps
          → replaces: manual context relay between AIs

Silver  = Layer 4 semantic search
          "What's related to X?"
          → embeddings, vector similarity, entity extraction
          → replaces: OpenClaw memory_search (BM25 + vector)
          → replaces: AI manually scanning files for context
          → THIS IS THE UPGRADE THAT MATTERS MOST

Gold    = Layer 4 curated answers
          "What do we know about X?"
          → instant facts, no search needed
          → replaces: OpenClaw MEMORY.md (hand-curated)
          → replaces: memory.md safety rules (become Gold facts)
```

The critical insight: **Silver is what makes Datacore actually replace
each AI's private memory system.** Without semantic search, AIs still
need their own memory_search. With it, one search() call to Datacore
finds everything any AI ever said about a topic — across all sessions,
all AIs, all time.

## What Needs to Change (concrete actions)

### 1. Shrink Layer 1 configs to <500 tokens each

CURRENT OpenClaw system prompt load:
  SOUL.md      1,248 tokens  ← trim to 500 (remove duplicated rules)
  AGENTS.md    2,319 tokens  ← trim to 300 (role only, not full workflow)
  TOOLS.md       771 tokens  ← trim to 200 (wakeup commands only)
  memory.md      666 tokens  ← REMOVE (safety rules → Datacore Gold)
  BOOTSTRAP.md   367 tokens  ← keep (startup sequence)
  HEARTBEAT.md   302 tokens  ← keep (cron check)
  IDENTITY.md    159 tokens  ← keep
  USER.md        119 tokens  ← keep
  TOTAL:       5,951 tokens  → target: ~2,000 tokens

### 2. Disable OpenClaw session-memory hook

The hook dumps 15 messages to workspace/memory/ on every /new.
Datacore already captures 100% of OpenClaw sessions via the gateway
hook. The session-memory hook is redundant and creates 59KB files.

```json
"hooks": {
  "internal": {
    "entries": {
      "session-memory": { "enabled": false }
    }
  }
}
```

### 3. Archive existing memory/*.md files

These are one-time session dumps, not ongoing memory. Move to
~/.openclaw/workspace/memory/archive/. They're already in Datacore.

### 4. OpenClaw startup reads from Datacore instead

Instead of loading curated memory.md, OpenClaw's startup routine
calls search() to get recent context:

```
Startup sequence:
1. Read Layer 1 (identity — always loaded, <500 tokens)
2. Call get_tasks(status: "active") → what needs attention
3. Call search("session summary") → what happened recently
4. Ready to work
```

### 5. Slim down project configs

Each AI's .claude/CLAUDE.md, .codex/CODEX.md, .gemini/GEMINI.md
should be <500 tokens. Current sizes (58-64 lines) are too large.

Minimum viable config per AI:
- Role (1 line)
- Startup: call get_tasks (2 lines)
- Logging format (3 lines)
- Pointer to docs/workflow.md for everything else (1 line)

## Connection to Datacore Phases

```
Phase 1 (NOW — Bronze):
  Layer 4 = grep search only
  Layer 1 = must carry more (startup context, safety rules)
  Layer 3 = AIs read workflow.md and org chart from disk
  → OpenClaw needs ~2,000 tokens in system prompt

Phase 2 (Silver — semantic search):
  Layer 4 = vector search replaces memory_search
  Layer 1 = can shrink further (Datacore answers "what's my role?")
  Layer 3 = less needed (search finds decisions and docs)
  → OpenClaw needs ~1,000 tokens in system prompt

Phase 3 (Gold — curated facts):
  Layer 4 = instant answers for recurring questions
  Layer 1 = absolute minimum (name + MCP connection)
  Layer 3 = only for new/changing design docs
  → OpenClaw needs ~500 tokens in system prompt
```

As Datacore gets smarter, each AI's local memory burden shrinks.
The end state: Layer 1 is just "I am OpenClaw, I connect to Datacore"
and Layer 4 has everything else.

## Summary

| Layer | What | Where | Loaded | Size | Shared? |
|---|---|---|---|---|---|
| 1. Identity | Role, startup, logging | Per-AI config files | Every turn | <500 tokens | No |
| 2. Working | Current conversation | App-internal | Auto | App-managed | No (but captured) |
| 3. Project | Design docs, workflow | Files on disk | On demand | Unlimited | Yes (files) |
| 4. Shared | All events, all AIs | Datacore Bronze/Silver/Gold | On demand (MCP) | 20K+ events | Yes (MCP) |

The boundary principle: **each layer exists because it has a unique
access pattern that the other layers can't serve.** Identity must be
instant (system prompt). Working memory is private (app-internal).
Project knowledge is structured (files). Shared memory is searchable
(Datacore). Collapse any two and you either waste tokens or lose access.
