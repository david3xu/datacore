# Round 5 Findings — How OpenClaw Auto-Capture Works

This auto-capture path is implemented by the OpenClaw hook handler in
`datacore/hooks/datacore-mcp-log/handler.js` and the datacore MCP client in
`datacore/mcp-server/src/client.mjs`.

## 1. What triggers the hook?

The hook only acts on OpenClaw events where `event.type === "message"`. Inside
that message category, it handles two actions:

- `event.action === "preprocessed"`: treated as an inbound message capture
- `event.action === "sent"`: treated as an outbound message capture

Everything else returns early and is ignored. That means the handler is not a
general logger for all OpenClaw activity. It is specifically a message hook for
two points in the message lifecycle:

- after an inbound message has been preprocessed
- after an outbound message has been sent

## 2. What data does it capture?

For inbound capture, the handler builds a Bronze event with:

- `source: "openclaw"`
- `type: "message_preprocessed"`
- `content`: `bodyForAgent` first, falling back to `body`

Its inbound metadata goes into `context` and includes:

- `app`, `direction`, `hookAction`, `sessionKey`, `observedAt`
- `channelId`, `conversationId`, `messageId`
- `from`, `to`
- `transcript`, `provider`, `surface`, `mediaType`
- `isGroup`, `groupId`

For outbound capture, it builds:

- `source: "openclaw"`
- `type: "message_sent"`
- `content`: `event.context.content`

Its outbound metadata includes:

- `app`, `direction`, `hookAction`, `sessionKey`, `observedAt`
- `channelId`, `conversationId`, `messageId`
- `to`
- `success`, `error`
- `isGroup`, `groupId`

Two helper choices matter here:

- `readString()` and `readBoolean()` only keep correctly typed values
- `compactRecord()` removes `undefined` and `null` values before writing

So the stored event is intentionally compact: it keeps the useful message
content plus normalized routing and status metadata, without blank fields.

## 3. How does it write to Bronze?

The hook does not write files directly. Instead, `handler.js` imports
`logEventViaMcp()` from `mcp-server/src/client.mjs`.

`client.mjs` then does four things:

1. Resolves how to launch the datacore MCP server
2. Creates a `Client` plus `StdioClientTransport`
3. Connects to the server entry path
4. Calls the MCP tool named `log_event`

The hook passes `{ shared: true }`, so repeated hook invocations reuse one
shared MCP client session instead of spawning a fresh client every time.

From there, the write path is:

`handler.js` -> `logEventViaMcp()` -> `callDatacoreTool()` -> MCP `log_event`
tool -> datacore server -> `appendEvent()` -> `~/.datacore/bronze/*.jsonl`

So OpenClaw auto-capture reaches Bronze by going through the MCP protocol, not
by bypassing the server with direct file writes.

## 4. Why is it automatic?

It is automatic because the persistence decision is made by the runtime hook
layer, not by the AI model during a conversation.

Once OpenClaw fires one of the supported hook events, this handler runs
immediately. If it can build a payload, it always attempts `logEventViaMcp()`.
There is no extra reasoning step where the AI decides whether to save the turn.

That gives the system an important property: capture happens because the
message lifecycle triggered the hook, not because the assistant remembered to
call a logging tool. In practice, that is what makes it "auto-capture."

The only cases that are skipped are intentional ones:

- the event is not a `message`
- the action is not `preprocessed` or `sent`
- the handler cannot extract non-empty content

So the auto-capture mechanism is deterministic: matching OpenClaw message hook
events are transformed into Bronze events and written through datacore MCP
without requiring manual AI choice.
