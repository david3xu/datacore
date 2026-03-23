# Round 10 — End-to-End Auto-Capture Verification Test

> Assigned to: Gemini Pro (after R9 completes)
> Date: March 21, 2026
> Type: Test (no new code — verify existing watchers)

## Task

Verify all active session watchers capture real data automatically,
with no gaps and near-real-time latency.

**Test 1: Codex watcher (already daemonized)**
1. Open Codex, send one message: "R10 test message from Codex"
2. Wait 5 seconds
3. Search Bronze: `datacore:search("R10 test message from Codex")`
4. ✅ Pass if found with `source: "codex-session"`

**Test 2: Claude agent watcher (already daemonized)**
1. Open Claude Desktop agent mode, send: "R10 test message from Claude agent"
2. Wait 5 seconds
3. Search Bronze: `datacore:search("R10 test message from Claude agent")`
4. ✅ Pass if found with `source: "claude-agent"`

**Test 3: Gemini watcher (after R9 is daemonized)**
1. Open Gemini CLI, send: "R10 test message from Gemini"
2. Wait 5 seconds
3. Search Bronze: `datacore:search("R10 test message from Gemini")`
4. ✅ Pass if found with `source: "gemini-session"`

**Test 4: Cross-search (prove shared memory works)**
1. Search Bronze: `datacore:search("R10 test")`
2. ✅ Pass if results include all three sources in one query

**Test 5: No duplicates**
1. Wait 30 seconds, search again: `datacore:search("R10 test")`
2. Count results — should be same as Test 4
3. ✅ Pass if count unchanged (watchers didn't re-ingest)

## Done when

- [ ] All 5 tests pass
- [ ] Document results in round-10-results.md
- [ ] Log completion via MCP datacore tools
