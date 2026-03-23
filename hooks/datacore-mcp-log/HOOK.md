---
name: datacore-mcp-log
description: "Write OpenClaw message lifecycle events into the datacore MCP Bronze store."
metadata:
  openclaw:
    emoji: "🪵"
    events: ["message:preprocessed", "message:sent"]
    requires:
      bins: ["node"]
---

# Datacore MCP Log

This hook writes inbound and outbound OpenClaw message events into the local
datacore MCP server.

## Events

- `message:preprocessed`
- `message:sent`

## Notes

- Storage still lands in the Bronze JSONL store via the `log_event` MCP tool.
- The hook does not copy full OpenClaw config into datacore records.
- The OpenClaw gateway should be restarted after enabling this hook.
