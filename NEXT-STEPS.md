# NEXT-STEPS.md — What Needs Doing

> Updated: March 26, 2026
> Owner: David (Jinguo)
> Purpose: Hand-off doc for any developer (human or AI) to pick up work.

## What's done

| # | Task | Status |
|---|---|---|
| 1 | Fix git author | ✅ Done |
| 4 | Verify CI | ✅ 23 tests pass |
| 5 | LICENSE | ✅ MIT |
| 6 | Clean scripts | ✅ -1,619 lines removed |
| 7 | Integration test | ✅ mcp-roundtrip.test.mjs |
| 8 | Silver layer | ✅ Azure Databricks Vector Search deployed |

## What's next

### 1. Data refresh pipeline

**Priority:** High
**Why:** Bronze data in Databricks (2,194 events) is a snapshot from March 25.
Local Bronze keeps growing (21K+ events). Need a repeatable way to sync.

**Options:**
- Run `export-for-databricks.mjs` → re-upload → overwrite Delta table (simple)
- Set up Auto Loader watching ADLS Gen2 landing zone (production-grade)
- Schedule a Databricks job to run weekly

**Acceptance:** New local events appear in Vector Search results.

---

### 2. Blog updates

**Priority:** Medium
**Why:** blog-puce-one.vercel.app needs datacore project page.

**Do this:**
- Add datacore project page with architecture diagram
- Add "what I learned" post about Databricks Vector Search

---

### 3. Gold layer design

**Priority:** Low (research first)
**Why:** Gold = curated facts extracted from events. "What projects am I
working on?" answered instantly from structured data, not search.

**Research needed:**
- What entity types emerge from our events? (projects, decisions, people)
- How to extract entities from free-text events?
- Where to store: Delta table? Separate MCP tool?

---

### 4. Kaggle — NVIDIA Nemotron

**Priority:** Parked
**Why:** Competition uses free Kaggle GPU (T4/L4), targets Nemotron-3-Nano-4B.
Pick up when other tasks are done.

---

### 5. Convert notebooks to Lakeflow pipeline

**Priority:** Low (portfolio value)
**Why:** Shows enterprise pipeline knowledge. Current notebooks work fine,
but Lakeflow adds: quality expectations, automatic retries, dependency tracking.

**Do this after:** Data refresh pipeline is working via notebooks.
