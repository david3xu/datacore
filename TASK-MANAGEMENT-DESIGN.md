# Task Management in Datacore — Design Document

> Brain (Claude) design doc
> Date: March 22, 2026
> Status: DESIGN v2 — no code yet
> Workflow step: 4. DESIGN
> Revision: v2 — added three-layer context model after David's feedback
>   ("every AI needs to understand WHY, not just WHAT")

---

## The Deeper Problem: Context, Not Just Status

Task coordination is the one critical function NOT in shared memory.

Today, task management lives in markdown files:
- `docs/backlog.md` — what to work on (77 Done items, growing)
- `datacore/tasks/task-board.md` — round-by-round delegation
- `datacore/tasks/round-X-code.md` — individual task specs
- `docs/ai-team.md` — allocation history (290 lines, growing)

This means:
1. **No AI can discover tasks via MCP.** Codex can't call `search("active tasks")` and get back actionable work. David must manually send file paths.
2. **Status is tracked by editing markdown.** Moving a task from "Active" to "Completed" requires editing task-board.md — error-prone, often forgotten.
3. **Task history is scattered.** To answer "what did Gemini build last week?" you'd need to read ai-team.md, task-board.md, and multiple round-X files.
4. **The backlog is a flat list.** 77 Done items and growing. No way to filter, search, or query programmatically.

Gemini called datacore a "Slack channel or Jira board." Right now it's only the Slack channel. This design adds the Jira board — using the same Bronze store and MCP tools.

But the problem goes deeper than missing tools. **A task ID with a status is not useful.** If Gemini gets assigned "R11: Build transcript ingest script" with no other context, it's stuck. It would ask: from where? what format? where does output go? why are we doing this? what patterns to follow?

Today this works because David sends a link to a detailed `round-X.md` spec file. But that means the coordination still runs through David manually. The "silent chat" vision breaks if tasks don't carry enough understanding for an AI to act independently.

---

## The Three Layers of Task Understanding

Every AI picking up a task needs three layers of context:

### Layer 1: WHY — The Problem Chain

Not just "build X" but what problem triggered this task, what decision led to it, and what happens if we skip it.

This is Gemini's insight: the codebase stores the WHAT, datacore stores the WHY. If a task doesn't carry the WHY, you've just moved a checkbox from markdown to JSON.

```
Example (good):
  "Search can't find Gemini conversations because content is stored as
   escaped JSON blobs. This blocks the 'USE IT' phase — we can't validate
   datacore's value if we can't find what AIs discussed."

Example (bad):
  "Fix search for Gemini events"
```

The good version tells any AI: this matters because it blocks a milestone, the root cause is data format, and the fix should target how content is stored.

### Layer 2: WHERE — Project Stage and State

The same task means different things at different stages. "Build auth module" during prototyping means "quick and dirty." During production it means "security review required."

Every task needs:
- **Workflow stage:** Which step in PROBLEM → RESEARCH → DIGEST → DESIGN → PLAN → BUILD → REVIEW?
- **What's already built:** What exists that this task connects to?
- **What's proven vs experimental:** Has this pattern been tested?
- **Constraints:** What NOT to touch, what rules to follow?

```
Example:
  stage: BUILD (Phase 1 complete, entering USE IT phase)
  depends_on: R6 codex-session-watcher (proven pattern to follow)
  constraints: "Use ID-based dedup, not offset-based. Files are JSON not JSONL."
  already_built: Bronze store with 12,338 events, 3 watchers running
```

### Layer 3: HOW — Patterns and Lessons

Accumulated team knowledge. What worked, what failed, what to avoid.

This is why Round 9 scored 9/10 (spec said "follow R6 pattern") but Round 0 scored 7.5/10 (no spec, free-form). The HOW is what turns a capable AI into a productive team member.

```
Example:
  pattern: "Follow codex-session-watcher.mjs (R6) architecture"
  lessons: "R1 used log-session.sh instead of MCP — always use MCP tools"
  lessons: "R5 was too ambitious (4 tasks in 1) — keep tasks single-step"
  acceptance: "Watcher detects new messages, events in Bronze, restart skips seen IDs"
```

### The Knowledge Chain

Every task should be traceable through a chain:

```
PROBLEM → DECISION → TASK → RESULT → LESSON
  "Search     "Redesign     "Add         "content     "Plain text
   can't       log_event     content_text  now          in content
   find         data          field to     searchable"  field is the
   content"     model"        log_event"                key pattern"
```

Each link in the chain is an event in Bronze. The task event carries references (not copies) to the upstream links.

---

## Design Principle: Tasks Are Events (revised)

A task is not a separate database table. A task is a sequence of events that share a `task_id`:

```
Event 1: task_created    → brain writes the spec
Event 2: task_assigned   → David delegates to an AI
Event 3: task_started    → hands begin execution
Event 4: task_completed  → hands report results
Event 5: task_reviewed   → brain scores the work
```

This fits the existing Bronze model perfectly. No new storage, no new files. Tasks are just events with enough structure to reconstruct state.

---

## Data Model

### The Task Event (extends common event)

Every task event uses `log_event` with these conventions:

```
source:     the AI that logged this event (e.g. "claude-cowork", "codex")
type:       one of the task lifecycle types (see below)
content:    plain text — MUST be human-readable AND searchable (see below)
context:    {
  // Identity
  task_id:      string (e.g. "R11", human-friendly, shared across all events for this task)
  task_type:    "code" | "research" | "config" | "test" | "review" | "content"
  status:       "created" | "assigned" | "in_progress" | "completed" | "failed" | "blocked"
                // EXACT strings only. Do NOT use "active", "done", "pending", etc.
                // get_tasks filters depend on these values. See docs/workflow.md Section 4.

  // Layer 1: WHY
  problem:      string (one sentence: what problem does this solve?)
  triggered_by: string (event_id or decision reference that led to this task)
  impact:       string (what breaks or stalls if this isn't done?)

  // Layer 2: WHERE
  project:      "datacore" | "openclaw" | "blog" | "buildinpublic" | "kaggle" | "azure-conflux"
  workflow_stage: "PROBLEM" | "RESEARCH" | "DIGEST" | "DESIGN" | "PLAN" | "BUILD" | "REVIEW"
  phase:        "phase-1" | "phase-2" | etc.
  depends_on:   [task_id, ...] (what must be done first)
  already_built: string (brief: what relevant things exist already)
  constraints:  string (what NOT to do, boundaries)

  // Layer 3: HOW
  pattern:      string (which existing code/approach to follow)
  lessons:      [string, ...] (relevant lessons from previous rounds)
  acceptance:   [string, ...] (how to verify "done")
  spec_file:    "tasks/round-11-code.md" (link to detailed spec if exists)

  // Delegation
  assigned_to:  "codex" | "gemini" | "claude" | "david" | null
  score:        number (0-10, set on review)

  // Organization
  tags:         ["auto-capture", "mcp", "search"] (for filtering)
}
```

### The `content` field rule

**Content must be a self-contained briefing, not a reference.**

Bad: `"Build transcript ingest script"`
Good: `"Build transcript ingest script — Claude.ai transcripts (downloaded HTML/JSON) need to be parsed and ingested into Bronze as individual conversation events. This unblocks the USE IT phase because Claude.ai is currently 0% captured. Follow the R6 codex-session-watcher pattern for file watching and dedup."`

Any AI reading just the `content` field should understand WHAT, WHY, and roughly HOW. The `context` fields provide structured data for querying and filtering. Both exist because they serve different purposes: content is for understanding, context is for coordination.
```

### Task Lifecycle Types

| type | Who logs it | When | content contains |
|---|---|---|---|
| `task_created` | Brain (Claude) | Task spec written | One-sentence summary of what needs doing |
| `task_assigned` | Brain or David | Delegation decision | Who it's assigned to and why |
| `task_started` | Hands (Codex/Gemini) | Work begins | Acknowledgment, initial observations |
| `task_updated` | Hands | Progress checkpoint | What's done so far, any blockers |
| `task_completed` | Hands | Work finished | Results summary, what was built/found |
| `task_failed` | Hands | Can't finish | What went wrong, what's needed |
| `task_blocked` | Anyone | Dependency not met | What's blocking and what unblocks it |
| `task_reviewed` | Brain (Claude) | Review done | Score, quality notes, what to improve |

### Example: Full Task Lifecycle (R9 as it would have looked)

**Event 1 — Brain creates task:**
```json
{
  "source": "claude-cowork",
  "type": "task_created",
  "content": "Build gemini-session-watcher.mjs — auto-ingest Gemini CLI sessions from ~/.gemini/tmp/*/chats/ into Bronze. Gemini conversations are currently 0% captured by file watchers. This completes the three-watcher coverage (Codex R6 + Claude R7 + Gemini R9). Key difference: Gemini files are JSON not JSONL, so use ID-based dedup instead of byte offsets. Follow R6 codex-session-watcher pattern for watch/poll/shutdown architecture.",
  "context": {
    "task_id": "R9",
    "task_type": "code",
    "status": "created",
    "problem": "Gemini sessions not captured — 0% coverage from file watchers",
    "triggered_by": "R7 completed Claude watcher, Gemini is the remaining gap",
    "impact": "Without this, Gemini conversations are only captured by instructed logging (~80%)",
    "project": "datacore",
    "workflow_stage": "BUILD",
    "phase": "phase-1",
    "depends_on": ["R6", "R8"],
    "already_built": "codex-session-watcher.mjs (R6, 525 lines, proven), claude-agent-session-watcher.mjs (R7, 350 lines), launchd plists (R8)",
    "constraints": "Files are JSON not JSONL — cannot use byte offset tracking. Must use ID-based dedup.",
    "pattern": "Follow codex-session-watcher.mjs (R6) for watch/poll/shutdown pattern",
    "lessons": ["R6: EMFILE error on too many watchers — include polling fallback", "R7: name correctly (claude-agent not claude-desktop) — name this gemini-session not gemini-cli"],
    "acceptance": ["Watcher detects new Gemini session messages", "Events appear in Bronze with source: gemini-session", "Restart skips already-seen message IDs (no duplicates)", "Log completion via MCP"],
    "spec_file": "tasks/round-9-code.md",
    "assigned_to": null,
    "tags": ["auto-capture", "gemini", "phase-1", "file-watcher"]
  }
}
```

**Event 2 — Brain assigns:**
```json
{
  "source": "claude-cowork",
  "type": "task_assigned",
  "content": "R9 assigned to Gemini Pro — Gemini knows its own session format best, and has scored 9/10 average across R7-R8. Good fit for building its own watcher.",
  "context": {
    "task_id": "R9",
    "status": "assigned",
    "assigned_to": "gemini"
  }
}
```

**Event 3 — Hands start work:**
```json
{
  "source": "gemini",
  "type": "task_started",
  "content": "Starting R9. Read round-9-code.md spec. Confirmed session root ~/.gemini/tmp/ has 11 sessions. Files are JSON with messages[] array. Using ID-based dedup as specified.",
  "context": {
    "task_id": "R9",
    "status": "in_progress"
  }
}
```

**Event 4 — Hands complete:**
```json
{
  "source": "gemini",
  "type": "task_completed",
  "content": "R9 complete. Built gemini-session-watcher.mjs (321 lines). Results: 449 messages from 11 sessions ingested on first run. ID-based dedup confirmed — second run: 0 new events. Created launchd plist. All acceptance criteria met.",
  "context": {
    "task_id": "R9",
    "status": "completed"
  }
}
```

**Event 5 — Brain reviews:**
```json
{
  "source": "claude-cowork",
  "type": "task_reviewed",
  "content": "R9 scored 9/10. Correct naming (gemini-session-watcher, not gemini-cli). ID-based dedup is the right choice for JSON files that get rewritten. Plist deployed and running. Minor: could add error count to state file for observability.",
  "context": {
    "task_id": "R9",
    "status": "completed",
    "score": 9,
    "lessons": ["ID-based dedup works well for JSON files that are rewritten (vs JSONL append)", "Gemini Pro continues strong — 9/10 average across 3 rounds"]
  }
}
```

**What this enables:** Any AI can now call `get_tasks(task_id: "R9")` and get back the full story — why it was created, what patterns were followed, what the results were, and what was learned. No need to read 3 different markdown files.

---

## MCP Tools

### Option A: Minimal (recommended for Phase 1)

Keep using `log_event` for writes. Add ONE new read tool:

```
get_tasks(
  status?: "active" | "completed" | "all"    // default: "active"
  assigned_to?: string                        // filter by assignee
  task_type?: string                          // filter by type
  limit?: number                              // default: 20
)
```

**How `get_tasks` works internally:**
1. Scan Bronze for events where type starts with `task_`
2. Group by `context.task_id`
3. For each task_id, find the LATEST event to determine current status
4. Filter by requested status/assignee/type
5. Return task summaries sorted by most recent activity

This is a **read-only derived view** over existing Bronze events. No new storage needed.

### Option B: Full task tools (Phase 2+)

```
create_task(summary, task_type, tags?, spec_file?)
  → generates task_id, logs task_created event, returns task_id

assign_task(task_id, assigned_to, reason?)
  → logs task_assigned event

update_task(task_id, status, content)
  → logs task_updated/completed/failed/blocked event

review_task(task_id, score, notes)
  → logs task_reviewed event
```

These are convenience wrappers around `log_event` with proper validation (e.g. can't review a task that hasn't been completed, can't assign a task that doesn't exist).

### Recommendation

**Start with Option A.** Brain and hands continue to use `log_event` with the task event conventions above. Add `get_tasks` as the single new tool. This tests whether the data model works before committing to dedicated tools.

If after 1-2 weeks the conventions feel solid, build Option B as convenience wrappers.

---

## What This Enables

### For any AI starting a session:
```
AI calls get_tasks(status: "active")
→ "R11: Build transcript ingest script, assigned to Codex, status: in_progress"
→ "R12: Deploy blog to Vercel, assigned to none, status: created"
AI immediately knows what's happening and what needs doing.
```

### For David delegating work:
```
Brain calls log_event with task_created → task exists in shared memory
David tells Codex: "Check active tasks in datacore"
Codex calls get_tasks() → sees the task → starts working
No file paths to copy-paste. No markdown to read.
```

### For brain reviewing:
```
Claude calls get_tasks(status: "completed", assigned_to: "gemini")
→ sees all Gemini's completed work with scores
→ can compare performance across AIs over time
```

### For the autonomous dispatch vision (v2):
```
David tells OpenClaw: "We need auth"
OpenClaw: logs task_created "R19: Build auth system"
OpenClaw: assigns R19 to Claude Desktop (design task)
OpenClaw: wakes Claude via osascript (pbcopy briefing → Cmd+N → Cmd+V → Return)
Claude Desktop: calls get_tasks(task_id: R19) → reads WHY/WHERE/HOW
Claude Desktop: writes auth-spec.md → logs task_completed
OpenClaw: detects completion → creates R19-impl → assigns to Codex
OpenClaw: wakes Codex via osascript with implementation briefing
Codex: reads spec, writes code → logs task_completed
OpenClaw: wakes Claude for review → logs task_reviewed
OpenClaw: notifies David "R19 ready for final review"
```

David only talks to OpenClaw. OpenClaw dispatches via shell `osascript`.
All coordination flows through Datacore events. No plugins, no MCP wrappers —
just standard macOS commands and the Datacore event bus.

---

## What This Replaces (Gradually)

| Current | Becomes | Timeline |
|---|---|---|
| `docs/backlog.md` | `get_tasks(status: "all")` | After migration |
| `datacore/tasks/task-board.md` | `get_tasks()` | After migration |
| `datacore/tasks/round-X-code.md` | Still exists for detailed specs, but linked via `spec_file` | Keep both |
| `docs/ai-team.md` allocation history | `get_tasks(assigned_to: "gemini")` | Supplement, don't replace |

**Important:** The markdown files don't disappear immediately. They're the detailed specs. The datacore tasks are the index — "what exists, who's doing it, what's the status." The spec files are the detail — "exactly what to build and how to verify."

Think of it like: task-board.md is the whiteboard, round-X.md files are the design docs. Datacore replaces the whiteboard, not the design docs.

---

## Relationship to log_event Redesign

This design assumes `log_event` gets a proper `context` field (already exists in the schema but underused). The task conventions use `context` for structured metadata while keeping `content` as plain searchable text.

This is a **stepping stone** toward the full SCHEMA.md vision:
- Phase now: Tasks use `context.task_id` for grouping (lightweight)
- Phase later: All events get `session_id`, `actor`, `parent_id` (full schema)

We don't need to redesign all of log_event to start using tasks. The `context` field is already there.

---

## Migration Plan

### Step 1: Start logging new tasks as events (zero code change)
Any AI can start logging task events TODAY using the existing `log_event` tool with the conventions above. Just use `context` properly.

### Step 2: Build `get_tasks` tool (one new tool, ~100 lines)
Read-only query over Bronze. Groups task events by task_id, returns current state.

### Step 3: Backfill completed rounds (optional)
Write a one-time script that reads the 10 existing round-X.md files and emits task events for each. This gives `get_tasks` historical data.

### Step 4: Deprecate task-board.md
Once `get_tasks` is proven, stop editing task-board.md manually. It becomes auto-generated or retired.

---

## Open Questions (for David to decide)

1. **Should task specs still be markdown files?** I think yes — they're detailed documents that benefit from formatting. But the index/status should be in datacore.

2. **Should we backfill the 10 existing rounds?** Low effort, high value for testing `get_tasks`. But it's optional.

3. **Round numbering vs task IDs?** The current R1-R10 system is simple and human-friendly. Propose: keep round IDs as the task_id format (e.g. "R11", "R12") rather than UUIDs. Humans need to say "check R11" to an AI.

4. **Who can create tasks?** Currently only brain (Claude) writes specs. Should hands be able to create subtasks? My recommendation: brain creates, hands can update status. Keeps the director model clean.

---

*Designed by Claude (brain role, Cowork session). This is DESIGN only — no code written.
Next step: David reviews, decides on open questions, then we PLAN the build.*
