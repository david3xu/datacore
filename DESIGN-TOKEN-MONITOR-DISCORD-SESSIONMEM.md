# Three Design Problems from Token Debugging

> Created: March 23, 2026
> Context: Debugging OpenClaw token consumption revealed three design gaps.
> Principle: Design before code. Each solution should be minimal and build on existing infrastructure.

---

## Problem 1: Token Monitoring

### What's missing
No automated way to track how many tokens each AI model consumes. We discovered
the crash loop (11 restarts in 10 min) and the 59KB memory dump by manually
grepping gateway logs. That's not sustainable.

### What exists today
- `pnpm openclaw models status` → shows quota % (Premium 68%, Chat 100%)
- Gateway logs → every `agent model: X` line = one invocation
- No per-request input/output token counts in logs
- Copilot API doesn't expose per-request token usage to the client

### Design: Token events as Datacore Bronze events

**Capture layer:** A lightweight script parses gateway logs and writes
token events to Datacore Bronze via MCP.

```
Source: gateway.log → parser → log_event()
Event schema:
{
  source: "openclaw-monitor",
  type: "model_invocation",
  content: "claude-sonnet-4.6 invoked at 14:03:54",
  context: {
    model: "github-copilot/claude-sonnet-4.6",
    timestamp: "2026-03-23T14:03:54",
    trigger: "heartbeat"  // or "user_message", "startup"
  }
}
```

**Aggregation layer:** A periodic check (cron or heartbeat) runs:
```
pnpm openclaw models status → parse quota %
log_event(source: "openclaw-monitor", type: "quota_check",
  content: "Premium 68% left, Chat 100% left",
  context: { premium_pct: 68, chat_pct: 100 })
```

**Alert layer:** When quota drops below threshold (e.g. 30%),
log a high-priority event that the Manager picks up on heartbeat.

### What this gives us
- Bronze has a complete history of model invocations + quota snapshots
- Any AI can search("quota") to see current state
- Trend analysis: "how fast is quota burning?"
- Crash loop detection: "10+ invocations in 10 minutes = alert"

### Implementation approach
- **Phase 1 (simple):** Cron job every 30 min runs `models status`,
  parses output, calls `log_event`. ~20 lines of shell script.
- **Phase 2 (richer):** Gateway log watcher (like existing file watchers)
  that counts model invocations per hour and logs summaries.
- **Phase 3 (auto-update):** When quota check runs, update Claude.ai
  memory via the memory_user_edits tool pattern (requires design for
  how Datacore Gold facts propagate to AI memory configs).

### Decision
Start with Phase 1 — cron job. It uses existing infrastructure
(MCP log_event, shell script, launchd or OpenClaw cron).
No new architecture needed.


---

## Problem 2: Discord Crash Loop Resilience

### What happened
Discord WebSocket kept disconnecting (code 1006 = abnormal close).
OpenClaw's Discord plugin retried with exponential backoff (1s→2s→4s→8s→16s→30s),
then triggered a full gateway auto-restart after exhausting retries.
The gateway restarts every ~60 seconds, each time loading the full model +
system prompt = wasted Sonnet 4.6 tokens on startup initialization.

### What exists today
- Discord plugin has built-in exponential backoff (up to 30s)
- Gateway has `auto-restart attempt N/10` with 5s delay
- After 10 failed auto-restarts, gateway process exits → launchd restarts it
- No circuit breaker — it just keeps trying forever

### Design: Circuit breaker pattern

**The principle:** After N failed reconnects, stop trying for a cooldown period.
Don't crash the entire gateway because one channel is down.

**Option A — OpenClaw config (if supported):**
```json
"channels": {
  "discord": {
    "enabled": true,
    "reconnect": {
      "maxAttempts": 3,
      "cooldownMinutes": 30,
      "backoffMax": "30s"
    }
  }
}
```

**Option B — Disable Discord, enable via cron:**
If Discord reconnect config isn't supported, the simpler solution:
- Disable Discord in config (`enabled: false`)
- Cron job every 30 min tries to enable and test connectivity
- If test fails, stays disabled until next check

**Option C — Just disable Discord entirely:**
David doesn't actively use Discord for OpenClaw communication.
All AI team coordination flows through Datacore MCP.
Discord was set up for testing, not production use.

### Decision
**Option C for now** — disable Discord. It's not in the critical path.
The token savings are immediate. If David wants Discord later, re-enable
with Option A if OpenClaw supports reconnect limits, or Option B as fallback.

### Implementation
```bash
pnpm openclaw config set channels.discord.enabled false
```
One command. Zero risk. Reversible.

---

## Problem 3: Where Does Session Memory Go?

### What we disabled
The `session-memory` hook saved the last 15 messages to
`workspace/memory/YYYY-MM-DD-slug.md` on every `/new` or `/reset`.
These files were indexed by OpenClaw's `memory_search` tool for
semantic recall ("what happened last session?").

### What we DIDN'T lose
Datacore already captures 100% of OpenClaw sessions via the gateway
hook (`datacore-mcp-log`). Every message, every tool call, every
response flows into Bronze JSONL in real-time.

### What IS lost (the gap)
The session-memory hook created **summaries** — curated, compact,
searchable by OpenClaw's semantic memory_search (BM25 + vector).
Raw Bronze events are not the same thing:

| Feature | session-memory hook | Datacore Bronze |
|---------|-------------------|-----------------|
| Capture rate | Last 15 messages per /new | 100% real-time |
| Format | Markdown summary | Raw JSONL events |
| Search | Semantic (memory_search) | Full-text grep |
| Size | 2-59KB per session | Grows indefinitely |
| Cross-AI | OpenClaw only | All AIs |

**The real gap is search quality, not capture.**

### Design: Three-phase migration

**Phase 1 (NOW — Bronze grep):**
OpenClaw's startup routine already calls:
```
get_tasks(status: "active")     → what needs attention
search("session summary")       → recent context
```
This is basic grep over raw events. It works but isn't semantic.
The Manager gets "what happened" from task events, not conversation
summaries. Good enough for task coordination.

**Gap acceptance:** OpenClaw loses the ability to recall "we discussed
X three days ago" from the old conversation. This is a real loss for
conversational continuity. But the Manager role doesn't need it —
it needs task state, not conversation history.

**Phase 2 (Silver — semantic search):**
When Datacore adds embeddings + vector search:
- OpenClaw calls `search("what happened in the last session")` → gets
  semantically relevant events across all AIs, not just its own
- This is BETTER than the old session-memory hook because it searches
  across ALL agents, not just OpenClaw's own sessions
- The search quality gap closes completely

**Phase 3 (Gold — curated summaries):**
When Datacore adds `add_fact` tool:
- At session end, AI calls `add_fact("last session covered: X, Y, Z")`
- Next session, AI calls `search("last session")` → gets the curated fact
- This replaces BOTH the session-memory hook AND manual MEMORY.md

### Key insight
**We didn't remove a feature. We moved it from Layer 2 (private) to
Layer 4 (shared).** The quality gap (grep vs semantic) is temporary —
it closes when Silver ships. And when it does, the result is strictly
better: cross-AI recall instead of single-AI recall.

### What to do about the archived files
The three files in `~/.openclaw/workspace/memory/archive/` contain
session context from March 17 and March 22. Options:

1. **Leave in archive** — they're already captured in Datacore Bronze.
   The archive is a safety net, not active memory.
2. **Ingest into Datacore** — run them through `log_event` as historical
   events. Gives them full searchability in Bronze.
3. **Delete** — the data exists in Bronze already.

**Decision:** Option 1 (leave in archive). No action needed. They're
backup copies of data that's already in Datacore. When Silver ships,
even the backup becomes unnecessary.

### Summary table

| Capability | Before (hook) | Now (Bronze) | Silver (future) | Gold (future) |
|---|---|---|---|---|
| Last session context | 15 msgs saved | grep over events | Semantic search | Curated facts |
| Cross-AI recall | No | Yes | Yes + semantic | Yes + instant |
| Token cost | 15K per dump | 0 | 0 | 0 |
| Search quality | Semantic | Grep | Semantic | Exact |
| Capture rate | 15 msgs | 100% | 100% | AI-curated |

The trajectory is clear: each Medallion layer closes a gap.
The disabled hook is the first step, not a regression.
