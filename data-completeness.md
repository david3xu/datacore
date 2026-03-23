# Data Completeness — Honest Architecture

> What's actually captured from each AI app, and what's missing.
> This doc corrects earlier claims that log_event calls are "Bronze."
> Last updated: March 22, 2026 (all strategies proven — watchers + instructed logging + transcript)

## The Uncomfortable Truth

We designed datacore as "shared memory for AI agents." But the brain
(Claude) — where 90% of decisions and reasoning happen — captures
less than 1% of its conversations to Bronze.

```
RAW TRANSCRIPT (available after compaction):
  20,422 lines | 1.4 MB | 46 human messages | 48 assistant messages
  Every tool call, every result, every reasoning step
  = TRUE Bronze — raw, unfiltered, complete

CLAUDE'S log_event CALLS (during session):
  ~40 events | ~20 KB | AI-selected summaries only
  Human's exact words: MISSING
  Reasoning chains: MISSING
  Tool call details: MISSING
  Screenshots: MISSING
  = SILVER quality — filtered through AI judgment
```

**Ratio: 500:1.** For every line Claude logs via MCP, 500 lines of
actual conversation are not captured.

## Corrected Data Quality Map

| Data source | True quality | Capture method | Completeness |
|---|---|---|---|
| OpenClaw messages | **Bronze** | Platform hook (auto, real-time) | 100% |
| Codex session files | **Bronze** | File watcher (auto, near-real-time) | 100% — R6 DONE |
| Claude Code/Agent sessions | **Bronze** | File watcher (auto, near-real-time) | 100% — R7 DONE |
| Gemini CLI sessions | **Bronze** | File watcher (auto, near-real-time, ID-based dedup) | 100% — R9 DONE |
| Raw transcripts (Claude.ai) | **Bronze** | Download after compaction (manual) | 100%, one session behind |
| Claude.ai log_event calls | **Silver** | AI decides when to log | ~1%, biased |
| Codex log_event calls | **Silver** | AI decides when to log | ~1%, biased |
| Antigravity (Gemini IDE) | **Silver** | Instructed logging via GEMINI.md + MCP | ~80-90% — PROVEN working |
| Claude Desktop (agent) | **Silver** | Instructed logging via CLAUDE.md + MCP | ~80-90% — instructions created |
| Claude Desktop (chat) | **Silver** | Instructed logging via Project instructions + MCP | ~80-90% — PROVEN working |


## The Corrected Architecture

```
REAL-TIME AUTO-CAPTURE (no AI decision needed):
  OpenClaw hook fires     → Bronze messages  → instant search
  Codex session-watcher   → Bronze sessions  → near-real-time (2s poll)
  Claude agent-watcher    → Bronze sessions  → near-real-time (R7)
  Gemini session-watcher  → Bronze sessions  → near-real-time (R9)

REAL-TIME INSTRUCTED CAPTURE (~80-90%, AI follows instructions):
  Antigravity (GEMINI.md) → calls log_event  → PROVEN (Perth test)
  Claude Desktop chat     → calls log_event  → PROVEN (Perth test)
  Claude Desktop agent    → CLAUDE.md        → instructions created

DELAYED COMPLETE (one session behind):
  Claude.ai transcript downloaded → ingested as true Bronze
  
NOT CAPTURABLE:
  Claude.ai live session → Cloud-hosted, no local files

SEARCH finds everything through one MCP tool.
```

## What This Means for Shared Memory

The shared memory works in TWO phases:

**Phase A — Real-time (during session):**
Any AI can search and find Silver-quality summaries immediately.
"What did Claude decide about the architecture?" → finds log_event summary.
Incomplete but instant. Good enough for coordination.

**Phase B — Complete (after session):**
Raw transcripts are ingested as true Bronze.
"What exactly did David say about annotations?" → finds his exact words.
Complete and accurate. Good for replay and verification.

Both phases use the same search tool. The searcher doesn't need to
know which phase the data came from — it's all in Bronze JSONL.

## The Auto-Capture Pattern

The same pattern works for every app:

```
1. AI app writes session files to disk (JSONL, append-only)
2. File watcher detects new/changed files (fs.watch + polling fallback)
3. Watcher reads new lines from last known byte offset
4. Each line normalized to Bronze event format
5. Written to ~/.datacore/bronze/ via logEventViaMcp()
6. State file tracks offsets (restart = resume, no duplicates)
```

Three implementations of this pattern now exist:

| Script | Watches | Events |
|---|---|---|
| `hooks/datacore-mcp-log/handler.js` | OpenClaw gateway events | Messages in/out |
| `scripts/codex-session-watcher.mjs` | `~/.codex/sessions/` | 11 Codex event types |
| `scripts/claude-agent-session-watcher.mjs` | `~/Library/.../Claude/local-agent-mode-sessions/` | 9 Claude Code event types |

The only app this can't work for is Claude.ai — it's cloud-hosted
with no local session files. For Claude.ai, transcript download
after compaction remains the only path to complete capture.


## Per-App Capture Strategy

### OpenClaw — SOLVED (gold standard)
```
Method:    Platform hook (auto-captures every message)
Script:    hooks/datacore-mcp-log/handler.js
Quality:   True Bronze
Delay:     Real-time
Coverage:  100%
Status:    ✅ Done since Phase 1
```

### Codex (OpenAI) — SOLVED (R6)
```
Method:    File watcher on ~/.codex/sessions/**/*.jsonl
Script:    mcp-server/scripts/codex-session-watcher.mjs
Quality:   True Bronze (all 11 event types: user, agent, reasoning, tool calls)
Delay:     Near-real-time (2s polling + fs.watch)
Coverage:  100% — 2060 real records ingested in 4 seconds
Status:    ✅ Done — needs daemonization (launchd) to run on boot
```

### Claude Code/Agent (inside Claude Desktop) — SOLVED (R7)
```
Method:    File watcher on ~/Library/Application Support/Claude/local-agent-mode-sessions/
Script:    mcp-server/scripts/claude-agent-session-watcher.mjs
Quality:   True Bronze (9 event types: user, assistant, system, tool_use_summary, result, etc.)
Delay:     Near-real-time
Coverage:  9384 existing events across 31 session files
Status:    ✅ Done — needs daemonization (launchd) to run on boot
Note:      This captures Claude Code agent sessions INSIDE Claude Desktop,
           NOT regular Claude Desktop chat conversations.
```

### Claude.ai — TWO-PHASE (partial)
```
Real-time: log_event calls → Silver-quality summaries (~1%)
Delayed:   Transcript download → Bronze-quality raw data (100%)
Action:    Start of each session: download previous transcript → ingest
Gap:       Current session not available until next session
Status:    ⚠️ Best we can do — Claude.ai is cloud-hosted, no local files
```

### Claude Desktop (regular chat) — NOT CAPTURABLE
```
Method:    None available
Why:       Chat data stored in Electron IndexedDB/Session Storage,
           not readable JSONL files. Only local-agent-mode sessions
           have JSONL (captured by R7 above).
Status:    ❌ No path forward without Anthropic exposing chat session files
```

## Why This Still Works (Despite the Gaps)

The shared memory isn't broken. It's layered:

```
IMMEDIATE VALUE (now):
  AI calls search("architecture decision") → finds Silver summaries
  This is enough for coordination. Brain knows what hands did.
  
FULL VALUE (next session):
  Transcript ingested → search finds exact words, full reasoning
  This is enough for verification. Any AI can replay the conversation.
```

The log_event calls during the session are like quick notes on a
whiteboard. The transcript is the full meeting recording. Both are
useful. The notes are available immediately. The recording arrives
the next day. Together, they capture everything.


## Lessons

1. **log_event calls are Silver, not Bronze.** Stop calling them Bronze.
   They're AI-curated summaries. True Bronze is the raw conversation.

2. **Auto-capture is platform-level, not protocol-level.** OpenClaw
   has a gateway hook. Codex has session files we watch. Claude Code
   has session files we watch. MCP enables the write path, but the
   TRIGGER must come from outside the AI's decision loop.

3. **MCP enables the connection, not the capture.** MCP gives every AI
   the ability to log_event and search. Whether the AI USES those tools
   for complete capture is a separate problem. Auto-capture solves it.

4. **The shared memory works in layers.** Silver events for real-time
   coordination. Bronze auto-capture for complete history. Both are
   searchable through the same MCP search tool.

5. **Honesty about data completeness matters.** The earlier docs promised
   "every AI reads and writes to one data layer." That's true — but it
   didn't mention that AI-decided writes are 1% summaries. This doc
   corrects that.

6. **File watchers are the universal auto-capture pattern.** Every AI
   app writes session files somewhere. Watching those files and ingesting
   into Bronze gives 100% capture without modifying the host app.
   OpenClaw's hook was the insight; file watchers are the generalization.

## Action Items

- [x] Build Codex session watcher (~/.codex/sessions/ → Bronze) — R6 DONE
- [x] Investigate Claude Desktop session file format — DONE (it's Claude Code agent, not chat)
- [x] Update why-mcp.md: honest capture completeness section — DONE
- [x] Build Claude Code/Agent session watcher — R7 DONE (Gemini Pro, 9/10)
- [ ] Daemonize both watchers (launchd plist — auto-start on boot)
- [ ] Start of each session: present new transcripts for download
- [ ] Build transcript ingest script (Claude.ai transcripts → Bronze)
- [ ] Update DESIGN.md: log_event = Silver, transcripts = Bronze

---

*See also:*
- `datacore/MCP-DECISION-MEMO.md` — includes "What MCP Does NOT Do" section
- `mcp-server/CONNECT-GUIDE.md` — per-app connection status
- `docs/ai-team.md` — who does what and how they capture data
