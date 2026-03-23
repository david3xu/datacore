# Codex Task Queue — Datacore MCP Server

> Tasks for Codex / OpenClaw to execute.
> Written by Claude (brain). Each task has clear acceptance criteria.
> Do NOT make design decisions — just implement exactly as specified.
> Do NOT change DESIGN.md or README.md — those are brain-level docs.
> Date: March 21, 2026

## Important Context

- MCP server code is at: `~/Developer/datacore/mcp-server/`
- Dependencies are installed (`node_modules/` exists)
- Smoke test passes: `npm run smoke`
- Server works with Claude.ai and MCP Inspector
- Code review at: `mcp-server/CODE-REVIEW.md`

## Task 1 — Add Tool Annotations to search tool

**Priority:** High (easy, immediate value)
**File:** `mcp-server/src/index.mjs`
**Issue:** CODE-REVIEW.md Issue 6

The `search` tool has no MCP annotations. It shows the same badges
as `log_event` in MCP Inspector, but `search` is read-only.


**Change:** Add annotations object after the inputSchema parameter in the
`server.tool()` call for `search`. The SDK signature is:

```javascript
server.tool(name, description, inputSchema, annotations, callback)
```

**For `search` tool, add this annotations object after the schema:**
```javascript
server.tool(
  "search",
  "Search collected Bronze events using case-insensitive full-text matching.",
  {
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(100).optional(),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async ({ query, max_results: maxResults }) => {
    // ... existing handler unchanged
  },
);
```

**For `log_event` tool, add explicit annotations (matching current defaults):**
```javascript
  {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
```


**Acceptance criteria:**
- `npm run smoke` still passes
- MCP Inspector shows: `search` → Read-only ✓, Destructive ✗, Idempotent ✓
- MCP Inspector shows: `log_event` → Read-only ✗, Destructive ✓, Idempotent ✗
- No other code changes

---

## Task 2 — Add Graceful Shutdown Handler

**Priority:** Low (minor improvement)
**File:** `mcp-server/src/index.mjs`
**Issue:** CODE-REVIEW.md Issue 5

Add signal handlers at the end of `index.mjs`, after `server.connect()`:

```javascript
await server.connect(new StdioServerTransport());

// Graceful shutdown
async function shutdown() {
  await server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

**Acceptance criteria:**
- `npm run smoke` still passes
- Server exits cleanly on Ctrl+C (no hanging process)
- No other code changes

---

## Task 3 — Test OpenClaw Hook Integration

**Priority:** Medium (validates second client)
**Files:** `hooks/datacore-mcp-log/`, `scripts/setup-openclaw.sh`


The autolog smoke test already exists at `scripts/autolog-smoke.mjs`.
It simulates OpenClaw inbound/outbound messages through the hook and
verifies they end up in Bronze.

**Step 1:** Run the existing autolog smoke test:
```bash
cd ~/Developer/datacore/mcp-server
npm run autolog:smoke
# Expected: "Datacore auto-log smoke test passed"
```

**Step 2:** If it passes, run the OpenClaw setup script:
```bash
cd ~/Developer/datacore/mcp-server
bash scripts/setup-openclaw.sh all
```

**Step 3:** Verify OpenClaw config was updated:
```bash
cat ~/.openclaw/openclaw.json | grep -A 5 "datacore"
```

**Step 4:** Restart OpenClaw gateway and send a test message.
Check that the message appears in `~/.datacore/bronze/`.

**Acceptance criteria:**
- `npm run autolog:smoke` passes
- OpenClaw config includes datacore MCP server entry
- A real OpenClaw conversation creates events in Bronze
- Report any errors encountered with full error text

---

## Task 4 — Simplify runtime-deps.mjs

**Priority:** Low (cleanup)
**File:** `mcp-server/src/runtime-deps.mjs`
**Issue:** CODE-REVIEW.md Issue 1


Now that `npm install` has been run and `node_modules/` exists, the
fallback to the sibling openclaw checkout is unnecessary complexity.

**Replace the entire `runtime-deps.mjs` with direct imports:**

```javascript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

export { McpServer, StdioServerTransport, Client, StdioClientTransport, z };
```

**Acceptance criteria:**
- `npm run smoke` passes
- `npm run autolog:smoke` passes
- File is now 7 lines instead of 47
- No functional behavior change

---

## Task 5 — Update PLAN.md Checkboxes

**Priority:** Low (housekeeping)
**File:** `datacore/PLAN.md`

Update the task list to reflect current state. Mark completed:
- Task 2 (scaffold): ✅ done
- Task 3 (log_event): ✅ done
- Task 4 (search): ✅ done
- Task 5 (first client = Claude.ai): ✅ done

Do NOT change the task descriptions or add new tasks.
Just check the boxes that are already done.

**Acceptance criteria:**
- Checked boxes match reality
- No task descriptions changed
- No new tasks added

---


## Execution Order

Run tasks in this order: **1 → 2 → 4 → 3 → 5**

- Task 1 (annotations) and Task 2 (shutdown) are independent code changes
- Task 4 (simplify deps) should be done before Task 3 (OpenClaw hook)
  because the hook uses the same runtime-deps.mjs
- Task 5 (checkboxes) is last — after verifying everything works

After each task, run:
```bash
cd ~/Developer/datacore/mcp-server
npm run smoke
```
If the smoke test fails, stop and report the error. Do not proceed.

## Rules for Codex

1. **Run smoke test after every change** — `npm run smoke` must pass
2. **Do NOT modify:** DESIGN.md, README.md, CODE-REVIEW.md, why-mcp.md,
   MCP-AUTO-DISCOVERY.md, MCP-DECISION-MEMO.md — those are brain-level docs
3. **Do NOT make design decisions** — if something is ambiguous, stop and ask
4. **Do NOT add new tools or features** — only changes listed here
5. **Do NOT change the Bronze storage format** — JSONL structure stays the same
6. **Log what you do** — after completing each task, use the MCP server
   (NOT log-session.sh, which writes to a different store):
   ```bash
   cd ~/Developer/datacore/mcp-server
   echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"log_event","arguments":{"source":"codex","type":"action","content":"Completed Task N: brief description"}}}' | node scripts/run-server.mjs
   ```
   Or if that's too complex, use the client directly:
   ```bash
   node -e "
     import {logEventViaMcp} from './src/client.mjs';
     await logEventViaMcp({source:'codex',type:'action',content:'Completed Task N: brief description'});
     process.exit(0);
   "
   ```
7. **Report results** — after all tasks, report which passed and which failed

## What NOT To Do

- Do not refactor code that isn't mentioned in a task
- Do not upgrade SDK versions
- Do not add new dependencies
- Do not change the `.mcp.json` files
- Do not touch anything in `infra/` or `notebooks/`
- Do not change the Bronze directory path or JSONL format
