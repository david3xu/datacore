# Round 5 — Understand OpenClaw Auto-Capture

> Assigned to: Codex
> Date: March 21, 2026
> Type: Read + document (no code changes)

## Task

Read these two files:
1. `datacore/hooks/datacore-mcp-log/handler.js`
2. `datacore/mcp-server/src/client.mjs`

Write a 1-page summary to `datacore/tasks/round-5-findings.md` answering:
- What triggers the hook? (what event, when does it fire)
- What data does it capture? (fields, content, metadata)
- How does it write to Bronze? (client.mjs → MCP server → appendEvent)
- Why is it automatic? (what makes it fire without AI deciding)

## Done when

- [ ] round-5-findings.md exists with clear answers to all 4 questions
- [ ] Log completion via MCP datacore tools
