---
name: datacore-mcp-log
description: "Write OpenClaw message lifecycle events and session starts into the datacore MCP Bronze store."
metadata:
  openclaw:
    emoji: "🪵"
    events: ["message:preprocessed", "message:sent", "agent:bootstrap"]
    requires:
      bins: ["node"]
---

# Datacore MCP Log

This hook writes inbound and outbound OpenClaw message events, and session
start events, into the local datacore MCP server.

## Events

- `message:preprocessed` — inbound messages (logged as `message_preprocessed`)
- `message:sent` — outbound messages (logged as `message_sent`)
- `agent:bootstrap` — session starts, including post-compaction context resets (logged as `session_start`)

## Notes

- Storage still lands in the Bronze JSONL store via the `log_event` MCP tool.
- The hook does not copy full OpenClaw config into datacore records.
- The `session_start` event captures context window resets, providing a signal
  that the conversation history has been summarised (compacted).
- The OpenClaw gateway should be restarted after enabling this hook.
