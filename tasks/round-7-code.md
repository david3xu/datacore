# Round 7 — Build claude-desktop-session-watcher.mjs

> Assigned to: Codex
> Date: March 21, 2026
> Type: Code (one script)

## Task

Build a file watcher that auto-ingests Claude Desktop session JSONL into Bronze.
Same pattern as codex-session-watcher.mjs (R6) but for Claude Desktop.

**File:** `mcp-server/scripts/claude-desktop-session-watcher.mjs`

**Session root:** `~/Library/Application Support/Claude/local-agent-mode-sessions/`
**Files:** 31 JSONL files (deeply nested, includes subagent sessions)
**Total events:** 9384

**First-run behavior:** backfill existing unseen JSONL files from byte `0`, then continue tailing new writes. Do not start at EOF for files the watcher has never seen. A populated first run is expected and should ingest the current local backlog once.

**Event types to map (verified from actual files):**

| Claude Desktop type | Count | Bronze type | Content field |
|---|---|---|---|
| user | 2854 | human_message | message text |
| assistant | 4215 | assistant_message | message text |
| system | 843 | system_message | message text |
| tool_use_summary | 657 | tool_summary | tool name + summary |
| result | 128 | tool_result | result content |
| queue-operation | 270 | queue_operation | operation type |
| progress | 267 | progress | progress info |
| rate_limit_event | 146 | rate_limit | rate limit details |
| last-prompt | 4 | last_prompt | prompt text |

**Content extraction rules:**

- For `user`, `assistant`, and `system`, extract the most useful searchable text from the event payload:
  - if the message content is a string, use it
  - if the message content is an array, join text-like items in order
  - if there is no visible text, fall back to a short summary rather than dumping an empty string
- For `assistant`, prefer visible text content over internal thinking blobs or signatures
- For `tool_use_summary`, store a compact string using the summary text; include related tool-use IDs in `context`
- For `result`, use the `result` field as content; keep `is_error`, `stop_reason`, cost/usage, and similar metadata in `context`
- For `queue-operation`, `progress`, `rate_limit_event`, and `last-prompt`, build a short searchable summary string and keep the raw payload in `context`

**Reference:** Copy the architecture from `codex-session-watcher.mjs`:
- Offset-based state file at `~/.datacore/claude-desktop-watcher-state.json`
- fs.watch with polling fallback
- Shared MCP session via `logEventViaMcp()`
- Partial line handling
- `source: "claude-desktop"` for all events
- Keep this as a Claude-specific normalizer. Do not try to reuse the Codex event mapper directly; the schemas are different.

## Done when

- [ ] Watcher detects new Claude Desktop session writes
- [ ] Events appear in Bronze with `source: "claude-desktop"`
- [ ] First run backfills existing unseen Claude Desktop session files once
- [ ] Second run resumes from last offset (no duplicates)
- [ ] Log completion via MCP datacore tools
