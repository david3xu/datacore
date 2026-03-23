# Datacore MCP Deep Dive: How Your Server Actually Works

> **Purpose:** This document explains the exact technical mechanics of how Datacore's MCP server (`mcp-server/src/index.mjs`) connects and communicates directly with AI applications like Claude Desktop, OpenClaw, and the Gemini IDE. 

## 1. The Big Secret: What Actually is MCP?
"Model Context Protocol" sounds like a futuristic, highly complex AI networking standard. It's actually much simpler. 

MCP is just **JSON-RPC (Remote Procedure Call)** mapped over **Standard Input and Output (stdio)**.

When you use MCP for Datacore, there are no open network ports, no complex REST APIs, and no GraphQL servers. The AI application (like Claude Desktop) literally spins up your `mcp-server` Node.js script as a background process and starts "typing" JSON strings into its hidden terminal window (`stdin`) and reading JSON strings that your script prints back (`stdout`).

## 2. The Connection Mechanics (stdio)

Look at your configurations (e.g., `claude_desktop_config.json`):
```json
"mcpServers": {
  "datacore": {
    "command": "node",
    "args": ["/Users/291928k/david/Developer/datacore/mcp-server/src/index.mjs"]
  }
}
```
When Claude boots up, it executes exactly that command: `node /Users/.../index.mjs`. 

Instead of showing you a popup terminal, Claude connects internal pipes to the script. 
1. `index.mjs` starts running.
2. Claude silently writes a JSON string into `stdin` saying: *"Hello, what tools do you have?"*
3. Your server reads that `stdin`, formulates an answer, and prints a JSON string to `stdout` saying: *"I have `log_event` and `search`."*

That's the entire transport layer. It's incredibly secure because the script only runs locally on your Mac and has no open network sockets.

## 3. The Server Layer (`index.mjs`)

Inside `index.mjs`, you import the official `@modelcontextprotocol/sdk`. This SDK parses the raw JSON strings coming in from `stdin` and turns them into Javascript objects.

**The Discovery Phase (`ListToolsRequestSchema`)**
When Claude connects, it automatically asks: *"What tools can you provide?"*
Your code registers a handler for this schema:
```javascript
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      { name: "log_event", description: "Append a raw event to Bronze..." },
      { name: "search", description: "Search collected Bronze events..." }
    ]
  };
});
```
This is how Claude magically knows about `log_event` and `search`. The Host AI takes this JSON response and feeds it directly into its LLM's system prompt so the AI knows it has permissions to use them.

## 4. The Write Path (`log_event`)

What happens when the AI actually decides to log an event?

**The Request (`CallToolRequestSchema`)**
 Claude sends a JSON-RPC request to `stdin`:
`{"method": "tools/call", "params": {"name": "log_event", "arguments": {"source": "gemini", "type": "conversation", "content": "Hello"}}}`

**The Execution**
1. Your server catches `CallToolRequestSchema`.
2. It looks at `request.params.name` and sees `"log_event"`.
3. It passes `request.params.arguments` to your `logEvent()` JavaScript function.
4. Your Javascript function opens `~/.datacore/bronze/2026-x-y.jsonl` and appends a line.

**The Response**
Your script returns a Javascript object back to the SDK:
```javascript
return {
  content: [{ type: "text", text: "Logged conversation to Bronze." }]
};
```
The SDK turns this into JSON, prints it to `stdout`, and Claude tells the LLM *"Tool succeeded."*

## 5. The Read Path (`search`)

The search path works exactly the same way, but it navigates your data lakes instead of writing to them.

1. **Trigger:** The AI encounters a question like *"Do you know Perth?"* and realizes it needs context. It outputs a tool call request for `"search"` with `{"query": "Perth"}`.
2. **Execute:** Your `index.mjs` receives the `"search"` request and fires up the search logic. It scans the `.jsonl` files in `~/.datacore/bronze/` using Javascript.
3. **Response:** It gathers the matching lines, formats them as a big string, and returns them:
```javascript
return {
  content: [{ type: "text", text: "[claude-desktop/conversation] User: do you know Perth?..." }]
};
```
4. **Resolution:** Claude reads this `stdout` response, injects it back into its active context window, and the AI confidently replies to you.

## Summary: You Are In Full Control

Because the MCP server is practically just a local Node.js script that you wrote (`mcp-server/src/index.mjs`), you hold all the keys:
- **You decide the tools:** Want a tool that sends an email or adjusts OpenClaw settings? Just add it to `ListToolsRequestSchema`.
- **You control the data:** Want to read from SQLite instead of Bronze JSONL directories? Just change the logic inside `CallToolRequestSchema`.
- **You own the security:** The AI can only do exactly what your explicitly written Javascript functions allow it to do. It cannot arbitrarily delete files unless you explicitly write a `"delete_file"` tool and expose it to the `ListTools` catalog. 

Datacore leverages this highly isolated standard architecture to make sure OpenClaw, Gemini, and Claude all share the exact same `log_event` and `search` node logic, creating an incredibly secure, unified multi-agent brain!
