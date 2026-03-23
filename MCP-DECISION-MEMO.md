# Datacore — MCP Decision Memo (Phase 1)

> Purpose: narrow earlier MCP/OpenClaw/Microsoft research into a datacore-only
> decision memo.
> Status: proposed; review this memo before copying any conclusions into
> `DESIGN.md` or `PLAN.md`.
> Scope rule: official MCP docs/spec, official Microsoft docs, and local
> OpenClaw code/docs only.
> Date: March 21, 2026

## 1. What MCP Is Now

MCP is a protocol for context exchange between AI applications and external
servers. The current latest MCP spec revision is `2025-11-25`. MCP uses a
host/client/server model:

- The **host** is the AI application
- The **client** maintains a connection to a server on the host's behalf
- The **server** exposes context and actions to that client

MCP servers can expose three core primitives:

- **Tools** for executable actions
- **Resources** for read-oriented context data
- **Prompts** for reusable interaction templates

MCP currently defines two standard transports:

- **stdio** for local subprocess communication
- **Streamable HTTP** for remote communication

The transport spec says clients should support `stdio` whenever possible.
Streamable HTTP replaced the older standalone `HTTP+SSE` transport from
`2024-11-05`, so backwards-compatible SSE handling should be treated as legacy
compatibility, not a default design target.

The protocol also includes lifecycle management and capability negotiation.
That is a more precise description than the earlier "MCP is stateful, RAG is
stateless" framing. For datacore, MCP should be treated as the protocol layer
for tool/resource access. Search, indexing, and retrieval strategy remain
separate design concerns.

For authorization, the MCP spec is explicit:

- HTTP-based transports should follow the MCP authorization spec
- `stdio` transports should **not** use that HTTP auth flow, and should instead
  retrieve credentials from the environment

## 2. What Matters For Datacore

Datacore Phase 1 is not "general MCP strategy" and not "Microsoft 365
integration." It is the narrow problem of building a local MCP server that can
capture events and query collected data.

The implementation defaults locked by this memo are:

- Phase 1 server surface: `log_event`, `search`
- Both Phase 1 operations are **tools**
- No **resources** in v1
- No **prompts** in v1
- Phase 1 transport: `stdio`
- Phase 1 validation client: **MCP Inspector**
- No Microsoft 365 / Copilot integration in v1 scope

Why `log_event` and `search` are tools:

- `log_event` is an action that writes data
- `search` is a parameterized query over multiple records/layers, not a stable
  URI-addressable document

Resources can be added later, but only after datacore has durable, stable
read-only models worth naming by URI, for example `entity://{id}` or
`facts://{topic}`.

Prompts are also deferred. They may become useful later as convenience
templates, but they are not required to make the datacore server useful.

Language and SDK choice remain open in this memo. This document does **not**
pick FastMCP by default and does **not** lock datacore to Python or
TypeScript yet.

## 3. What OpenClaw Can Actually Do Today

The local OpenClaw repo supports MCP in ways that matter to datacore, but the
current checked-in evidence is narrower than a broad "OpenClaw has mature
remote MCP integration" claim.

Observed local repo reality:

- In the inspected bundle runtime, OpenClaw imports and uses
  `StdioClientTransport`, launches configured MCP servers as subprocesses,
  lists tools, and executes tools.
- The plugin loader warns when bundle MCP servers use unsupported transports
  and explicitly says "`stdio only today`".
- The Microsoft documentation checked into OpenClaw is a **Microsoft Teams
  plugin** guide, not a Microsoft 365 Copilot MCP guide.

Decision implication:

- Datacore should treat OpenClaw as a plausible future `stdio` client for the
  first MCP server build
- Datacore should **not** assume broad remote MCP capability in OpenClaw from
  the checked-in runtime alone
- Datacore should **not** infer Microsoft 365 Copilot support from the Teams
  plugin docs

## 4. What Microsoft Surfaces Are Real Future Options

Microsoft has two official MCP-adjacent paths that matter here, and they should
be kept separate.

### Copilot Studio

Copilot Studio has an MCP integration path that can connect an agent to an
existing MCP server. The official Copilot Studio MCP page says Copilot Studio
currently supports MCP **tools and resources**, and that Generative
Orchestration must be enabled.

This is a future integration option if datacore ever needs to expose selected
capabilities into Copilot Studio. It is not part of Phase 1.

### Microsoft 365 Copilot

Microsoft also documents a separate declarative-agent/plugin path for MCP in
the Microsoft 365 ecosystem. The official plugin overview says API/MCP plugins
are supported as actions **within declarative agents** and are **not enabled in
Microsoft 365 Copilot** as a blanket platform capability. The specific
"build plugins from an MCP server" page labels that MCP path **public preview**
and says **only tools from MCP servers are supported** there.

This is also a future option, but it should be treated as preview-sensitive and
kept out of datacore Phase 1.

### What Not To Treat As Canonical

- Unofficial or community M365 MCP servers are not design foundations for
  datacore
- Microsoft 365 Copilot should not be described here as broadly supporting all
  MCP primitives
- OpenClaw host support, Copilot Studio consumption, and Microsoft 365 Copilot
  plugin publishing are three different concerns and should not be merged into
  one implementation story

## 5. Final Decisions

These decisions are locked for the next build step:

- Build the **local datacore MCP server first**
- Validate it with **MCP Inspector** before wiring any product-specific client
- Keep Phase 1 scope to `log_event` and `search`
- Keep Phase 1 transport to `stdio`
- Exclude resources from v1
- Exclude prompts from v1
- Exclude Streamable HTTP from v1 unless a real target client later requires it
- Exclude Copilot Studio and Microsoft 365 Copilot integration from the first
  build

No code interfaces change in this memo step. This file exists to lock the
decision baseline for later implementation.

## Source Notes

### Official MCP

1. **Architecture overview**
   https://modelcontextprotocol.io/docs/learn/architecture
   Used for host/client/server roles, primitives, lifecycle, and Inspector as
   an official MCP development tool.
2. **Transports**
   https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
   Used for `stdio`, Streamable HTTP, the "clients SHOULD support stdio"
   guidance, and the deprecation/replacement of standalone `HTTP+SSE`.
3. **Authorization**
   https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
   Used for the distinction between HTTP authorization flow and `stdio`
   environment-based credentials.
4. **Key changes**
   https://modelcontextprotocol.io/specification/2025-11-25/changelog
   Used to confirm `2025-11-25` as the latest spec revision.

### Official Microsoft

1. **Extend your agent with Model Context Protocol**
   https://learn.microsoft.com/en-us/microsoft-copilot-studio/agent-extend-action-mcp
   Used for the Copilot Studio statement that MCP tools and resources are
   supported there.
2. **API plugins for Microsoft 365 Copilot**
   https://learn.microsoft.com/en-us/copilot/plugins/overview
   Used for the statement that API/MCP plugins are actions within declarative
   agents and are not enabled in Microsoft 365 Copilot broadly.
3. **Build plugins from an MCP server for Microsoft 365 Copilot**
   https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/build-api-plugins-mcp
   Used for the public-preview status and the statement that only tools are
   supported on that path.

### Local OpenClaw Evidence

1. `/Users/291928k/david/Developer/openclaw/src/agents/pi-bundle-mcp-tools.ts`
   Shows `StdioClientTransport`, tool listing, and tool execution in the
   inspected bundle runtime.
2. `/Users/291928k/david/Developer/openclaw/src/plugins/loader.ts`
   Warns that bundle MCP servers may use unsupported transports and labels the
   supported path as "`stdio only today`".
3. `/Users/291928k/david/Developer/openclaw/docs/channels/msteams.md`
   Documents the Microsoft Teams plugin path, not Microsoft 365 Copilot MCP.
