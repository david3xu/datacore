# Round 9 — Build gemini-session-watcher.mjs

> Assigned to: Gemini Pro
> Date: March 21, 2026
> Type: Code (one script)

## Task

Build a file watcher that auto-ingests Gemini CLI session JSON into Bronze.

**File:** `mcp-server/scripts/gemini-session-watcher.mjs`

**Session root:** `~/.gemini/tmp/` (recursive — multiple project dirs)
**File pattern:** `*/chats/session-*.json`
**Files:** 11 sessions currently
**Format:** JSON (NOT JSONL) — each file is one object with a `messages` array

**Key difference from Codex/Claude watchers:** Files are rewritten (not appended).
Track by message IDs already seen, not byte offsets.

**Message format (verified from actual files):**
```json
{
  "sessionId": "b3c3889d-...",
  "projectHash": "...",
  "startTime": "2026-03-17T01:30:16.963Z",
  "messages": [
    { "id": "...", "timestamp": "...", "type": "user", "content": [{"text": "hello"}] },
    { "id": "...", "timestamp": "...", "type": "gemini", "content": "response text",
      "thoughts": [], "tokens": {...}, "model": "gemini-..." }
  ]
}
```

**Bronze event mapping:**
- `type: "user"` → `source: "gemini-session"`, `type: "human_message"`
- `type: "gemini"` → `source: "gemini-session"`, `type: "assistant_message"`
- Content: extract text from string or array format

**State tracking:** Store seen message IDs (not byte offsets) in
`~/.datacore/gemini-session-watcher-state.json`

**Reference:** `codex-session-watcher.mjs` for the watch/poll/shutdown pattern.

## Done when

- [ ] Watcher detects new Gemini session messages
- [ ] Events appear in Bronze with `source: "gemini-session"`
- [ ] Restart skips already-seen message IDs (no duplicates)
- [ ] Log completion via MCP datacore tools
