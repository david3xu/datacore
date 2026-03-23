# Codex Task Queue — Round 2

> Second batch of tasks. Round 1 scored 9/10 — all 5 passed, resolved
> errors independently, clean minimal changes. One lesson learned:
> log-session.sh was deprecated AFTER Round 1 — not Codex's fault.
> Date: March 21, 2026

## Context Since Round 1

- Datacore MCP server is LIVE (3 sources writing to Bronze)
- log-session.sh is DEPRECATED (writes to wrong store)
- 70 events in Bronze today
- CODEX-TASKS.md Round 1 instructions updated to use MCP client
- New docs created: CONNECT-GUIDE.md, why-mcp.md, docs/README.md

## Important: How to Log Events

Do NOT use `log-session.sh`. Use the MCP client library:
```bash
cd ~/Developer/datacore/mcp-server
node -e "
  import {logEventViaMcp} from './src/client.mjs';
  await logEventViaMcp({source:'codex',type:'action',content:'Completed Task N: description'});
  process.exit(0);
"
```


## Task 1 — Add Deprecation Warning to log-session.sh

**Priority:** High (prevents future data scatter)
**File:** `datacore/log-session.sh`

Add a warning at the very top of the script (after the shebang),
BEFORE any other logic:

```bash
#!/bin/bash
# ⚠️ DEPRECATED — This script writes to sample-data/claude/ which is
# NOT searchable by the datacore MCP server.
# Use the MCP server instead:
#   cd ~/Developer/datacore/mcp-server
#   node -e "import {logEventViaMcp} from './src/client.mjs'; \
#     await logEventViaMcp({source:'cli',type:'note',content:'msg'}); \
#     process.exit(0);"
echo "⚠️  WARNING: log-session.sh is DEPRECATED. Data goes to wrong store."
echo "   Use datacore MCP tools instead. See mcp-server/CONNECT-GUIDE.md"
echo "   Continuing anyway for backward compatibility..."
echo ""
```

Do NOT delete the script — just add the warning. Existing logic stays.

**Acceptance criteria:**
- Running `./log-session.sh note "test"` shows the warning then works as before
- Script still creates session JSONL files (backward compat)
- No other files changed

---

## Task 2 — Create .vscode/mcp.json

**Priority:** Medium (enables VS Code MCP integration)
**File:** `~/Developer/.vscode/mcp.json` (NEW file, create the directory too)


Create the file with this exact content:

```json
{
  "mcpServers": {
    "datacore": {
      "command": "node",
      "args": ["/Users/291928k/david/Developer/datacore/mcp-server/scripts/run-server.mjs"]
    }
  }
}
```

Also create `~/Developer/.cursor/mcp.json` with the same content
(for Cursor IDE support).

**Acceptance criteria:**
- File exists at `~/Developer/.vscode/mcp.json`
- File exists at `~/Developer/.cursor/mcp.json`
- Both contain valid JSON with the datacore server entry
- `npm run smoke` still passes (sanity check, nothing should break)

---

## Task 3 — Add Event Stats to Search Output

**Priority:** Medium (improves usability)
**File:** `mcp-server/src/bronze-store.mjs`

When `searchEvents` returns results, it already includes `eventsScanned`
and `filesScanned`. Add two more fields to the return object:


```javascript
// Add to the return object in searchEvents():
{
  bronzeDir,
  filesScanned: files.length,
  eventsScanned,
  parseErrors,
  totalMatches: results.length,
  results,
  // NEW: add these two fields
  sourceCounts: {},   // e.g. {"claude.ai": 15, "openclaw": 8, "mcp-inspector": 2}
  typeCounts: {},     // e.g. {"action": 10, "decision": 5, "milestone": 3}
}
```

Build `sourceCounts` and `typeCounts` by iterating over ALL events
(not just matches). This gives a picture of what's in the Bronze store
regardless of the search query.

**Acceptance criteria:**
- `npm run smoke` passes
- Search results now include `sourceCounts` and `typeCounts`
- Counts cover ALL events in all files, not just matched ones
- Existing search behavior unchanged

---

## Task 4 — Ingest Remaining sample-data Into Bronze

**Priority:** Low (data completeness)


Write a one-off migration script at `mcp-server/scripts/migrate-sample-data.mjs`
that reads files from `sample-data/` and ingests them into Bronze via
`appendEvent()`. 

Files to ingest:
- `sample-data/openclaw/*.jsonl` → source: "openclaw-session"
- `sample-data/docs/*.md` → source: "project-doc", one event per file
  with content = first 500 chars of the file
- `sample-data/content/*.md` → source: "content", one event per file

Do NOT ingest `sample-data/claude/session-*.jsonl` — those were already
migrated earlier in this session (41 events).

Do NOT ingest `sample-data/git/` — git commits will get their own
ingest method later.

Mark each event with `context: { migrated_from: "sample-data", original_file: "<filename>" }`

**Acceptance criteria:**
- Script runs: `node scripts/migrate-sample-data.mjs`
- Reports how many events were ingested
- Events appear in `~/.datacore/bronze/` JSONL
- `npm run smoke` still passes
- Running the script twice does NOT create duplicates
  (check if event with same `original_file` already exists before inserting)

---

## Execution Order

Run tasks in this order: **1 → 2 → 3 → 4**


After each task, run:
```bash
cd ~/Developer/datacore/mcp-server && npm run smoke
```
If smoke fails, stop and report the error.

Log completion via MCP (NOT log-session.sh):
```bash
cd ~/Developer/datacore/mcp-server
node -e "
  import {logEventViaMcp} from './src/client.mjs';
  await logEventViaMcp({source:'codex',type:'action',content:'R2 Task N: brief description'});
  process.exit(0);
"
```

## Rules (same as Round 1, plus updates)

1. **Run smoke test after every change**
2. **Do NOT modify:** DESIGN.md, README.md, CODE-REVIEW.md, why-mcp.md,
   MCP-AUTO-DISCOVERY.md, CONNECT-GUIDE.md, docs/README.md — brain-level docs
3. **Do NOT make design decisions** — if ambiguous, stop and ask
4. **Do NOT add new MCP tools** — only changes listed here
5. **Log events via MCP client** — NOT via log-session.sh
6. **Do NOT change the Bronze JSONL format** — schema stays the same
7. **Do NOT touch infra/, notebooks/, or .mcp.json files**
8. **Report results** — which tasks passed, which failed, any errors
