# Research: Auto-Capture Raw AI Conversation Data via MCP

## Context

I'm building a personal data layer called "datacore" — an MCP server
that multiple AI apps (Claude, Codex, OpenClaw) connect to for shared
memory. The MCP server has two tools: `log_event` (write) and `search` (read).

**The problem:** When an AI calls `log_event`, it logs a summary (~1% of
the conversation). The raw conversation (user messages, AI responses,
reasoning, tool calls) is NOT captured. Only OpenClaw auto-captures
100% because it's open source and we added a platform-level hook.

**What I need:** A way to capture raw conversation data in real-time
from inside an MCP server, for Claude Desktop, Codex (OpenAI), and
other closed-source AI apps that support MCP.

## Research Questions

Please investigate each question using official documentation only.
For each, provide: answer, evidence (links), feasibility, recommendation.


### Q1: Does MCP have an "observe" or "subscribe" mechanism?
Can an MCP server request to see all messages in a conversation?
Is there a notification/event system where the host pushes messages
to the server automatically?
- Check: MCP spec at modelcontextprotocol.io/specification/2025-11-25
- Check: MCP 2026 roadmap for planned observability features
- Check: Any "channels" or "notifications" in the spec

### Q2: Can MCP Resources expose conversation history?
Resources are "read-only data the host provides to the server."
Could the HOST expose the current conversation as a Resource?
For example: `conversation://current/messages`
- Check: Which MCP hosts support Resources
- Check: Does Claude Desktop expose any built-in Resources
- Check: Does Codex (OpenAI) expose any built-in Resources

### Q3: Can MCP Sampling be used for conversation capture?
Sampling = server asks the AI to generate text.
Could a server use sampling to ask "what did the user just say?"
- Check: MCP sampling specification
- Check: Practical limitations of sampling

### Q4: Can Claude Desktop Extensions intercept conversations?
Claude Desktop supports Extensions (.mcpb packages).
Could an extension observe the conversation stream?
- Check: Claude Desktop extension API documentation
- Check: https://support.claude.com desktop extension docs
- Check: Can extensions access conversation context?


### Q5: Can Codex (OpenAI) notification hooks capture conversation?
Codex has a `notification_command` config option that fires after turns.
Could this capture the turn content and pipe it to datacore?
- Check: https://developers.openai.com/codex/config-reference
- Check: What data does the notification payload include?
- Check: Codex skills documentation for any capture patterns

### Q6: What about a system prompt instruction approach?
Instead of protocol-level capture, add to system prompt:
"After every response, call datacore:log_event with the full user
message and your full response as content."
- Has anyone tried this with MCP tools? What's the reliability?
- Does it significantly increase token usage or latency?
- Do Claude and Codex follow this instruction consistently?

### Q7: Are there community MCP servers that solve conversation logging?
Over 1000 MCP servers exist. Has anyone built a "conversation logger"?
- Check: awesome-mcp-servers on GitHub (punkpeye/awesome-mcp-servers)
- Check: MCPList.ai, Glama directory
- Check: Any "chat history" or "conversation capture" MCP servers

### Q8: Can post-session sync capture full conversations?
Each AI app stores session data locally:
- Claude Desktop: ~/Library/Application Support/Claude/
- Codex: ~/.codex/sessions/*.jsonl
- Claude.ai: transcripts available at /mnt/transcripts/ after compaction
Could a background sync job ingest these into datacore's Bronze store?
- What is the format of each app's session files?
- How often should sync run? (cron job vs on-demand)
- How to detect new sessions and avoid duplicate ingestion?


### Q9: What does the MCP "Elicitation" primitive do?
The MCP Inspector shows an "Elicitations" tab. This is a newer primitive.
Could elicitation be used to request conversation context from the host?
- Check: MCP spec for elicitation definition and capabilities
- Check: Which hosts support elicitations?

### Q10: What is the MCP "Tasks" primitive and can it help?
The Inspector also shows a "Tasks" tab for long-running operations.
Could a persistent task observe the conversation stream?
- Check: MCP Tasks specification (SEP-1686)
- Check: Can tasks maintain a persistent connection to the host?

## Expected Output Format

For each question, provide:

```
### Q[N]: [Question title]
**Answer:** Yes / No / Partially / Unknown
**Evidence:** [Link to official doc or spec section]
**Feasibility:** Easy / Medium / Hard / Impossible / Needs more research
**Recommendation:** Should we pursue this? Why or why not?
```

At the end, provide:

### Top 3 Recommended Approaches
Rank by:
1. Capture completeness (how much of conversation is captured)
2. Implementation effort (how hard to build)
3. Cross-app compatibility (works for Claude AND Codex AND others)

## Sources to Check
- MCP Specification: modelcontextprotocol.io/specification/2025-11-25
- MCP TypeScript SDK: github.com/modelcontextprotocol/typescript-sdk
- MCP 2026 Roadmap: blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/
- Claude Desktop docs: support.claude.com
- Codex docs: developers.openai.com/codex
- Awesome MCP Servers: github.com/punkpeye/awesome-mcp-servers

Please output your findings as a downloadable markdown file.
