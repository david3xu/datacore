# NEXT-STEPS.md — What Needs Doing

> Updated: March 26, 2026
> Owner: David (Jinguo)
> Purpose: Hand-off doc for any developer (human or AI) to pick up work.

## What's done

| # | Task | Status |
|---|---|---|
| 1 | Fix git author | ✅ Done |
| 4 | Verify CI (CodeQL + tests) | ✅ 43 tests, 5 suites pass |
| 5 | LICENSE | ✅ MIT |
| 6 | Clean scripts | ✅ -1,619 lines removed |
| 7 | Integration test | ✅ mcp-roundtrip.test.mjs |
| 8 | Silver layer | ✅ Databricks Vector Search + Auto Loader |
| 9 | Data refresh pipeline | ✅ Auto Loader daily sync (launchd 6 AM) |
| 10 | Improvement plan 10/10 | ✅ All 4 sprints shipped |
| 11 | Code discipline audit | ✅ 26 checks, 92% pass |
| 12 | Gold layer design | ✅ GOLD-DESIGN.md (244 lines) |
| 13 | Schema governance | ✅ SCHEMA.md rewritten (157 lines) |
| 14 | AI memory architecture | ✅ AI-MEMORY-ARCHITECTURE.md (392 lines) |

## What's next

### 1. Gold layer Phase 1 (DELEGATED to OpenClaw)

**Priority:** High — task GOLD-PHASE-1 in Bronze
**What:** gold-store.ts + get_facts/add_entity MCP tools + promote-to-gold.mjs
**Acceptance:** get_facts returns structured entities, promote script processes 226 events
**Status:** Task spec logged to Bronze, awaiting OpenClaw dispatch

### 2. Memory pipeline (depends on Gold)

**Priority:** Medium — task MEMORY-PIPELINE in Bronze
**What:** Compaction → Bronze hook, session startup enrichment, content_summary
**Acceptance:** MEMORY.md auto-updates at session start with recent facts

### 3. Blog + content

**Priority:** Medium
**What:** Datacore project page, "what I learned" article, LinkedIn posts queued

### 4. Quick wins from enterprise eval

**Priority:** Low effort, do anytime
- Trust-tagged events (add _trust field to store.ts)
- Status/observability MCP tool
- Version tag (git tag v0.2.0)
- Informal SLIs from daily-sync logs

### 5. Kaggle — NVIDIA Nemotron

**Priority:** Parked
