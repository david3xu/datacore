# Research Brief: Auto-Capture Raw Conversation Data via MCP

> For: Codex / OpenClaw / any research AI
> From: Claude (brain role)
> Date: March 21, 2026
> Priority: High — this is the biggest gap in the datacore architecture

## The Problem

Datacore is a shared memory layer for AI agents. But the most important
data — the actual conversations — is barely captured.

Current state:
- Claude's log_event calls capture ~1% of conversation (AI-curated summaries)
- The raw transcript (20,422 lines, 1.4MB) has 100% of the conversation
- Transcript is only available AFTER the session ends (one session behind)
- There is NO real-time raw capture for Claude.ai or Codex conversations

Only OpenClaw auto-captures 100% in real-time because it's open source
and we added a platform-level hook to the gateway code.

## What We Want

A way to capture raw conversation data (user messages + AI responses)
in real-time, from inside an MCP server, for any connected AI app.

Ideally:
- MCP server sees every message in the conversation as it happens
- Writes full messages to Bronze (not AI summaries)
- Works without modifying the host app (Claude, Codex are closed source)
- Preserves user's exact words and AI's full responses


## Research Questions (investigate all of these)

### Q1: Does MCP have any "observe" or "subscribe" mechanism?
- Can an MCP server request to see all messages in the conversation?
- Is there a notifications/events system where the host pushes messages?
- Check: MCP spec (modelcontextprotocol.io/specification/2025-11-25)
- Check: MCP SDK source code for any event/stream/subscribe patterns
- Check: MCP 2026 roadmap for planned observability features

### Q2: Can MCP Resources be used for real-time conversation access?
- Resources are "read-only data the host provides to the server"
- Could the HOST expose conversation history as a Resource?
- e.g., resource URI: conversation://current/messages
- Does any MCP host (Claude, Codex, VS Code) expose conversation as a Resource?
- Check: Claude Desktop MCP resource support
- Check: Codex MCP resource support

### Q3: Can MCP Sampling be reversed for capture?
- Sampling = server asks the AI to generate text
- Could a server use sampling to ask "repeat what the user just said"?
- Is this practical or just a hack?
- Check: MCP sampling spec and limitations

### Q4: Can MCP Prompts include conversation context?
- When a Prompt is invoked, does it receive conversation history?
- Could a Prompt template extract and log the conversation?
- Check: MCP prompts spec — what context is passed to prompts


### Q5: How does OpenClaw's hook system work technically?
- OpenClaw hook intercepts at the gateway level (BEFORE and AFTER AI)
- hook/datacore-mcp-log/handler.js — review this code
- Can this pattern be replicated for other open-source AI hosts?
- What about Cursor, VS Code Copilot — do they have extension hooks?
- Check: OpenClaw source at ~/Developer/openclaw/src/hooks/

### Q6: Can Claude Desktop Extensions intercept conversations?
- Claude Desktop supports Extensions (.mcpb packages)
- Could an extension observe the conversation stream?
- Check: Claude Desktop extension API docs
- Check: https://support.claude.com/en/articles/10949351
- Check: Desktop extension developer documentation

### Q7: Can Codex Skills or Hooks capture conversation?
- Codex has Skills system and notification hooks
- notification_command fires after each turn
- Could a notification hook capture the turn content?
- Check: ~/.codex/config.toml notification_command option
- Check: https://developers.openai.com/codex/config-reference
- Check: Codex skills documentation

### Q8: What about a system prompt instruction approach?
- Instead of protocol-level capture, use a system prompt:
  "After every response, call datacore:log_event with the user's
   message and your response as content"
- Pros: works today, no protocol changes needed
- Cons: AI might forget, adds latency, uses tokens, incomplete
- Has anyone tried this? What's the reliability?


### Q9: What about post-session sync as the realistic path?
- Claude.ai: transcripts available at /mnt/transcripts/ after compaction
- Codex: sessions at ~/.codex/sessions/*.jsonl (1762 lines today)
- Claude Desktop: session files at ~/Library/Application Support/Claude/
- Could a background cron job sync these into Bronze periodically?
- What's the format of each app's session files?
- How to avoid duplicates on re-sync?

### Q10: Are there any community MCP servers that solve this?
- 1000+ MCP servers exist in the ecosystem
- Has anyone built a "conversation logger" MCP server?
- Check: awesome-mcp-servers list on GitHub
- Check: MCPList.ai, Glama directory
- Any open-source conversation capture tools for MCP hosts?

## Context For The Researcher

Current architecture:
- Datacore MCP server at ~/Developer/datacore/mcp-server/
- Two tools: log_event (write) and search (read)
- Bronze store at ~/.datacore/bronze/YYYY-MM-DD.jsonl
- 5 AI apps connected: Claude.ai, Claude Desktop, Codex, OpenClaw, Inspector
- OpenClaw is the ONLY one with true auto-capture (hook-based)
- Everything else relies on AI deciding to call log_event (~1% capture)

Key files to read first:
- datacore/mcp-server/CODE-REVIEW.md (how the server works)
- docs/data-completeness.md (the honest gap analysis)
- docs/why-mcp.md (what MCP does and doesn't do)
- hooks/datacore-mcp-log/handler.js (OpenClaw's auto-capture mechanism)


## Expected Output

Write your findings to: `datacore/tasks/round-3-research-answers.md`

For each question (Q1-Q10), provide:
1. **Answer**: What you found (yes/no/partially)
2. **Evidence**: Link to official docs, spec sections, or source code
3. **Feasibility**: Can we build this? (easy/medium/hard/impossible)
4. **Recommendation**: Should we pursue this approach?

At the end, recommend the TOP 3 most promising approaches ranked by:
- Capture completeness (how much of the conversation is captured)
- Implementation effort (how hard to build)
- Works across apps (does it work for Claude AND Codex AND others)

## Rules

- Use OFFICIAL sources only (MCP spec, SDK docs, product docs)
- Do NOT speculate about undocumented features
- If a question can't be answered from official sources, say so
- Log your research via MCP:
  ```bash
  cd ~/Developer/datacore/mcp-server
  node -e "import {logEventViaMcp} from './src/client.mjs'; \
    await logEventViaMcp({source:'codex',type:'research', \
    content:'Researching Q1: MCP observe mechanism...'}); \
    process.exit(0);"
  ```

---

*This brief was written by Claude (brain) to delegate research.
The brain will review findings and incorporate the best approaches
into the datacore architecture.*
