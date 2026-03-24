# NEXT-STEPS.md — What Needs Doing

> Created: March 24, 2026 by Claude (claude.ai)
> Owner: David (Jinguo)
> Purpose: Hand-off doc for any developer (human or AI) to pick up work.
> Review: David reviews before assigning. Claude checks after completion.

## Context

Datacore is a cross-agent MCP server at github.com/david3xu/datacore.
It shipped today with: 8 TypeScript source files, 17 tests, 8-layer
constraint stack, clean repo structure. Every file answers one question.

This doc lists what's next, ordered by priority. Each task is
self-contained — a developer can do one without reading the others.

---

## 1. Fix git author identity

**Priority:** Do first (2 minutes)
**Why:** Every commit says `291928k@Davids-MacBook-Pro.local` instead
of a real name and email. Looks unprofessional on GitHub.

**Do this:**
```bash
git config --global user.name "David Xu"
git config --global user.email "your-real-email@example.com"
cd ~/Developer/datacore && git commit --amend --reset-author --no-edit
cd ~/Developer/blog && git commit --amend --reset-author --no-edit
git push --force  # for both repos
```

**Verify:** `git log -1 --format="%an <%ae>"` shows your real name.

---

## 2. Write the Lakestone article

**Priority:** High — blocks job application
**Why:** Lakestone.ai (Perth, AI Automation Engineer) wants to see
what you've built. One real article IS the portfolio piece.
**Assign to:** David (writing) or Claude (drafting)

**Title:** "Why AI Agents Need Shared Memory"

**Structure (from jnsgruk research — problem → solution → learnings):**

1. **The problem** (200 words)
   You use Claude, GPT, Gemini, Copilot daily. Each starts from zero.
   No AI knows what the others did. You manually relay context.

2. **The solution** (300 words)
   MCP server that every AI connects to. One protocol, one data layer.
   Show the architecture diagram (diagrams/data-architecture-complete.svg).
   Show the 3 tools: log_event, search, get_tasks.

3. **What I actually built** (400 words)
   TypeScript MCP server. 20,000+ real events from 15 sources.
   8-file codebase where every file answers one question.
   8-layer constraint stack. Medallion architecture for Azure migration.
   Link to github.com/david3xu/datacore.

4. **What I learned** (200 words)
   Architecture before code. Make wrong things impossible, not unlikely.
   The directory tree IS the architecture document.
   Every layer eliminates a class of error the layer below can't see.

**Publish to:** DEV.to first, then blog, then LinkedIn summary.
**Acceptance:** Published, has repo link, has diagram, no claims about
upstream PRs or unverified metrics.

---

## 3. Send Lakestone application

**Priority:** High — after article is published
**Assign to:** David

**To:** join@lakestone.ai
**Subject:** AI Automation Engineer — David Xu

**Include:**
- Link to the article (from task 2)
- Link to github.com/david3xu/datacore
- Link to blog
- 2-3 sentences on OpenClaw experience (built on, not contributed to)
- Mention: MCP, Claude, TypeScript, Azure, data engineering

**Do NOT include:** Claims about PR submissions, unverified metrics,
AzureConflux (171 lines skeleton).

---

## 4. Verify CI is actually passing on GitHub

**Priority:** Medium — should already work but never verified
**Assign to:** Any developer

**Do this:**
1. Go to github.com/david3xu/datacore/actions
2. Check if the latest push triggered CI
3. If failing, read the error and fix

**Common CI issues:**
- pnpm version mismatch → check `pnpm/action-setup@v4` version param
- Node version → must be 22+
- `dist/` not in repo → CI runs `pnpm run build` first, should be fine
- Missing pnpm-lock.yaml → must be committed

**Acceptance:** Green badge on GitHub Actions. If already green, done.

---

## 5. Add LICENSE file

**Priority:** Medium — professional repos have one
**Assign to:** Any developer

**Do this:**
```bash
cd ~/Developer/datacore
# MIT is standard for portfolio projects
curl -o LICENSE https://raw.githubusercontent.com/spdx/license-list-data/main/text/MIT.txt
# Edit: replace [year] with 2026, [fullname] with David Xu
git add LICENSE && git commit -m "add: MIT license"
git push
```

---

## 6. Clean up session watcher scripts

**Priority:** Low — scripts/ has files that reference old paths
**Assign to:** Any developer familiar with the codebase

**Problem:** `scripts/` has 10+ files. Some are one-off utilities,
some are active watchers. They need audit:

**Do this:**
1. Read each script in `mcp-server/scripts/`
2. For each, answer: "Does anything in the pipeline run this?"
3. If yes → keep, verify imports point to `dist/`
4. If no → move to `developer/docs/datacore/archive/` or delete

**Known issues:**
- `smoke.mjs` — imports `@modelcontextprotocol/sdk/client/index.js`
  but needs `StdioClientTransport` from `/client/stdio.js` (separate import)
- `migrate-sample-data.mjs` — one-off, already ran, can archive
- `*-session-watcher.mjs` — active daemons, imports updated to `dist/`

---

## 7. Add integration test (MCP round-trip)

**Priority:** Medium — proves the server actually works end-to-end
**Assign to:** Any developer

**Why:** Current 17 tests test individual functions (store, search, tasks).
None test the MCP server itself — start server, connect client, call tool,
verify response.

**Do this:**
1. Create `mcp-server/tests/mcp-roundtrip.test.mjs`
2. Start the MCP server as a child process (`dist/server.js`)
3. Connect a client via StdioClientTransport
4. Call `log_event` → verify response has `status: 'ok'`
5. Call `search` for the event just logged → verify it appears
6. Call `get_tasks` → verify it returns (even if empty board)
7. Disconnect and clean up temp dir

**Reference:** `mcp-server/scripts/smoke.mjs` does exactly this but
as a manual script, not an automated test.

**Acceptance:** `pnpm run test` passes with 20+ tests (17 existing + 3 new).

---

## 8. Silver layer — semantic search (DESIGN FIRST)

**Priority:** Next major feature — after Lakestone application
**Assign to:** Claude (architecture) then Codex/Gemini (implementation)

**WARNING:** Architecture before code. Do NOT start coding without
a design document reviewed by David.

**Phase 8a — Design (Claude):**
1. Read `developer/docs/datacore/DESIGN.md` and `RESEARCH-AREAS.md`
2. Answer the 5 open questions in RESEARCH-AREAS.md:
   - Which embedding model? (local vs API, cost, quality)
   - Which entity types emerge from real data?
   - How to curate facts from conversation noise?
   - Graph DB or property graph in relational store?
   - How to route queries (keyword vs semantic vs structured)?
3. Write `developer/docs/datacore/SILVER-DESIGN.md`
4. David reviews before any code is written

**Phase 8b — Implementation (after design is approved):**
1. Add `src/embed.ts` — "How are events embedded?" (new file, one question)
2. Add `src/silver-store.ts` — "How is Silver data stored?"
3. Add new MCP tool: `semantic_search` in `tools.ts`
4. Add tests for the new tool
5. All existing 17 tests must still pass
6. Update CLAUDE.md with new file descriptions

**Acceptance:** `semantic_search` tool returns relevant results for
natural language queries across 20,000+ Bronze events.

---

## 9. Blog updates

**Priority:** Low — after Lakestone article
**Assign to:** Any developer

**Pending items:**
- Other project card links still point to `#` (placeholder)
- Blog design uses WA Health pipeline card — needs real content or remove
- Consider: does the Projects page add value, or do articles replace it?
  (jnsgruk has no projects page — articles ARE the portfolio)

---

## 10. Kaggle — NVIDIA Nemotron Challenge

**Priority:** Parked — pick up when Lakestone is done
**Assign to:** David + Claude

**Research done:** Uses free Kaggle GPU (T4/L4), targets
Nemotron-3-Nano-4B, allows LoRA fine-tuning and synthetic data.
Details in `developer/docs/datacore/` research files.

---

## Rules for any developer working on this repo

**Read CLAUDE.md first.** It has build commands, workflow contract,
structural principles, 10 gotchas, and code style rules. Everything
below is IN ADDITION to CLAUDE.md — not a replacement.

### Structural principles (from CLAUDE.md — enforced)

These came from studying professional codebases (jnsgruk's brewlog,
booklog, newsagent). They are design rules, not preferences.

1. **Every item in the repo must serve the pipeline.**
   Ask: "What compiles, tests, deploys, serves, or instructs with this?"
   If the answer is nothing — it doesn't belong. Design docs, plans,
   research, migration records go in `developer/docs/datacore/`.

2. **Every directory answers ONE question: "What does this do?"**
   Never organize by file type (`docs/`, `config/`, `utils/`) or by
   time (`archive/`, `old/`). Organize by function in the system.

3. **Every source file answers ONE question.**
   Put the question as a comment on line 1:
   `// search.ts — How is data found?`
   If a file does two things — split it.

4. **Only README.md and CLAUDE.md at repo root.**
   No DESIGN.md, no PLAN.md, no MIGRATION.md at root.
   Architecture IS the code structure — `src/` tree shows it.

5. **New concepts use consistent names across layers.**
   Adding Silver? Name it `silver-store.ts` in src/,
   `silver.test.mjs` in tests/, "Silver" section in CLAUDE.md.

### Build contract (from CLAUDE.md — enforced by CI + pre-commit)

Before finishing any task:
```bash
cd mcp-server
pnpm run format:check   # formatting
pnpm run lint            # linting  
pnpm run build           # TypeScript compiles
pnpm run test            # 17+ tests pass
```

### Code rules

- No `any` in TypeScript — use `unknown` and narrow
- No `==` ever — always `===` (ESLint enforces)
- No claims about upstream OpenClaw contributions
- Content in `log_event` must be plain searchable text, not JSON
- Architecture before code — new subsystems need a design doc first

---

*This file is temporary. Delete it when all tasks are complete
or move remaining items to GitHub Issues.*
