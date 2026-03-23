# Round 11 — Data Model Alignment

> Assigned to: Gemini Pro / OpenClaw
> Date: March 22, 2026
> Type: Design & Refactor

## Background
We discovered that temporal memory searches returned zero hits ("amnesiac AI") because the `log_event` MCP tool accepts a single flat `content` string, forcing AIs to embed escaped JSON inside it. 

The `SCHEMA.md` correctly models an incredible 10-field architecture, but the `log_event` tool currently ignores it, creating massive data inconsistency between the file watchers and instructed logging.

## Objectives
Align the entire Datacore pipeline so that all ingestion methods (Watchers + Instructed Logging) output identically structured data matching `SCHEMA.md`. The `search` tool must rely purely on clean text queries.

## 1. Update `log_event` Tool Signature
Modify `mcp-server/src/index.mjs`.

**New Signature:**
```javascript
{
  source: string,       // e.g., "gemini", "claude-desktop", "openclaw"
  type: string,         // e.g., "human_message", "assistant_message", "reasoning", "decision"
  content: string,      // PLAIN TEXT ONLY. This is the only searchable field. No JSON.
  session_id?: string,  // UUID grouping conversations
  actor?: string,       // e.g., "david", "ai:gemini-pro", "ai:claude-opus"
  parent_id?: string,   // For threaded replies
  metadata?: object     // Any structured JSON data (Tool limits, token usage, etc)
}
```

## 2. Refactor File Watchers (Strategy 1)
Modify the ingestion mappers in all three watcher scripts to conform exactly to the new signature:
- `mcp-server/scripts/codex-session-watcher.mjs`
- `mcp-server/scripts/claude-agent-session-watcher.mjs`
- `mcp-server/scripts/gemini-session-watcher.mjs`

*Ensure `content` never contains stringified JSON. Use `metadata` instead.*

## 3. Refactor Instructed Logging (Strategy 2)
Update the global rules across all AI applications so the LLM uses the proper schema.
- Update `~/.gemini/GEMINI.md` 
- Update the Claude Desktop Project Instructions ("All Conversations" project).
- Update OpenClaw system prompts if applicable.

*Rule: Instruct the AI to put the exact conversational text in `content` and any structural formatting into `metadata`.*

## 4. Upgrade `search` Tool 
Modify `mcp-server/src/index.mjs` search logic:
- Search queries now match **strictly** against the plain-text `content_text` (or `content`) field rather than scanning entire JSON blobs.
- Expose optional filters to the MCP tool: `source` and `type` (e.g., "find 'Perth' where source = 'gemini'").

## Done When
- [ ] `index.mjs` tool schemas correctly require the new fields.
- [ ] All 3 auto-watchers are updated and restarted using `install-watchers.sh`.
- [ ] `GEMINI.md` and Claude instructed logging rules utilize the new signature.
- [ ] `search` successfully finds "temporal memory" with zero JSON parsing errors.
