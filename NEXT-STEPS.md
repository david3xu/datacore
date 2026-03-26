# NEXT-STEPS.md — What Needs Doing

> Updated: March 26, 2026
> Owner: David (Jinguo)
> Purpose: Hand-off doc for any developer (human or AI) to pick up work.

## What's done

| # | Task | Status |
|---|---|---|
| 1 | Fix git author | ✅ Done |
| 4 | Verify CI (CodeQL + tests) | ✅ 56 tests, 5 suites pass |
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
| 15 | R14: async AI-to-AI comms | ✅ get_questions tool (questions.ts, 5 tests) |
| 16 | R16: capability registry | ✅ 4 agent Gold entities |
| 17 | R18: RPA dispatcher | ✅ dispatch-to.sh (192 lines, AppleScript) |

## What's next

### 1. OpenClaw dispatch integration

**Priority:** High
**What:** Wire dispatch-to.sh into OpenClaw's task assignment flow.
OpenClaw reads capabilities from Gold, matches task to agent, calls dispatch-to.sh.
**Status:** dispatch-to.sh built, capability registry seeded, needs OpenClaw wiring.

### 2. Blog + content

**Priority:** Medium
**What:** Article #2: "4 memory layers every system needs"
Article #1 ("Why AI agents need shared memory") is live on Vercel.

### 3. Kaggle — NVIDIA Nemotron

**Priority:** Parked
