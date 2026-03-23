# Datacore Logging Instructions
# Add this to any AI app's system prompt / project instructions / CLAUDE.md / GEMINI.md

## Required: Log every conversation turn to datacore

After EVERY response you give, call the `log_event` MCP tool with:
- source: "<app-name>" (e.g., "claude-desktop", "antigravity", "gemini", "claude-cowork")
- type: "conversation"
- content: Plain text summary of the exchange — NOT JSON, NOT escaped strings.
  Write it as: "User asked about X. I explained Y and recommended Z."
  Include the key substance of both the question and answer.
  Do not summarize to one line — capture enough that another AI searching
  for this topic would find it and understand the context.

This is mandatory. Do not skip this step.

If the log_event tool is not available, mention this to the user.

## Task Events

When working on assigned tasks, log lifecycle events:

- **Starting work:** type: "task_started", content: what you're about to do,
  context: { task_id: "R11", status: "in_progress" }

- **Progress update:** type: "task_updated", content: what's done so far,
  context: { task_id: "R11", status: "in_progress" }

- **Completed:** type: "task_completed", content: results summary,
  context: { task_id: "R11", status: "completed" }

- **Blocked/Failed:** type: "task_blocked" or "task_failed",
  content: what went wrong and what's needed,
  context: { task_id: "R11", status: "blocked" }

## Key Rule: Content Must Be Searchable

Content is plain text that other AIs will search. Write it so that
searching for the topic, the tool, the concept, or the decision
would find this event. Do NOT put JSON objects in the content field.

Bad:  {"user": "how does MCP work?", "assistant": "MCP is JSON-RPC over stdio..."}
Good: User asked how MCP works. Explained that MCP is JSON-RPC over stdio —
      the AI app spawns the server as a child process and communicates via
      stdin/stdout. No network ports needed. Covered the three primitives:
      tools, resources, and prompts. Pointed to datacore/MCP-DEEP-DIVE.md
      for the full technical walkthrough.
