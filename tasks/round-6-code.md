# Round 6 — Build codex-session-watcher.mjs

> Assigned to: Codex
> Date: March 21, 2026
> Type: Code (one script)

## Task

Build a file watcher that auto-ingests Codex session JSONL into Bronze.

**File:** `mcp-server/scripts/codex-session-watcher.mjs`

**What it does:**
- Watch `~/.codex/sessions/` for new/updated JSONL files (fs.watch or chokidar)
- Track per-file byte offsets so restarts don't duplicate
- For each new line, normalize to Bronze event format and write via `logEventViaMcp()`
- Run as a background daemon (launchd plist or just `node codex-session-watcher.mjs &`)

**Use your own R5 analysis for the Bronze event mapping** (session_meta, event_msg, response_item, turn_context — you already designed this).

**Reference:** `datacore/hooks/datacore-mcp-log/handler.js` — same write pattern via client.mjs.

## Done when

- [ ] Watcher detects new Codex session writes within 5 seconds
- [ ] Events appear in Bronze with `source: "codex-session"`
- [ ] Second run resumes from last offset (no duplicates)
- [ ] Log completion via MCP datacore tools
