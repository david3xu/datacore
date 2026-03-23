# Task Board

> Single view of all work across all AIs.
> Location: datacore/tasks/
> Updated: March 22, 2026

## Active

| Round | Type | Assigned to | Task file | Status |
|---|---|---|---|---|
| R13-R19 | Various | Various | (Datacore events) | ⬜ Created — see `get_tasks(status: 'active')` |

## Archived (deprioritized)

| Round | Type | Original assignee | Task file | Reason |
|---|---|---|---|---|
| R3 | Research | Codex | `archive/round-3-research.md` | Superseded by R5-R9 findings |
| R4 | Research | M365 Copilot | `archive/round-4-research-m365.md` | M365 Copilot removed from team |

## Completed

| Round | Type | Assigned to | Task file | Score | Summary |
|---|---|---|---|---|---|
| R1 | Code | Codex | `round-1-code.md` | 9/10 | Annotations, shutdown, runtime-deps, hook test, PLAN checkboxes |
| R2 | Code | Codex | `round-2-code.md` | 9/10 | Deprecation warning, VS Code/Cursor configs, search stats, migration |
| R5 | Read + doc | Codex | `round-5-code.md` | 8/10 | OpenClaw hook mechanism documented |
| R6 | Code | Codex | `round-6-code.md` | 9/10 | codex-session-watcher.mjs — 2060 records, offset resume |
| R7 | Code | Gemini Pro | `round-7-code.md` | 9/10 | claude-agent-session-watcher.mjs — 9384 agent events |
| R8 | Config | Gemini Pro | `round-8-code.md` | 9/10 | launchd plists + install-watchers.sh, 3 daemons running |
| R9 | Code | Gemini Pro | `round-9-code.md` | 9/10 | gemini-session-watcher.mjs — 449 messages, ID-based dedup |
| R10 | Test | David | `round-10-test.md` | ✅ | Antigravity + Claude Desktop chat both proven working |

## Next (not yet assigned)

- Set up Claude Desktop Project with auto-logging instructions (permanent fix)
- Daemonize gemini-session-watcher (add to install-watchers.sh — R8 update)
- Build transcript ingest script (Claude.ai transcripts → Bronze)
- Phase 2: Connect Bronze to ADLS Gen2 → Databricks
- Entity type discovery from real search patterns (USE IT phase)
- Blog post: "Building shared memory for AI agents"
- LinkedIn posts #6-8 (Mon-Wed next week)
