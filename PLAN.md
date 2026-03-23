# Datacore — Plan (Phase 1: MCP Server)

> Phase 1: Build the datacore MCP server — the data collection foundation
> Without data flowing in, nothing else matters.
> MCP server IS the ingest layer — every connected AI app becomes a data source.
> Updated: March 23, 2026

## What We're Building

A MCP server that AI apps can connect to. Two tools to start:
- `log_event` — write any event to Bronze (append-only JSONL)
- `search` — read back from collected data (full-text)

Once connected to Claude.ai and OpenClaw, every conversation
automatically feeds the data lake. No manual export needed.

Important protocol decision:
- `log_event` and `search` are MCP **tools**
- stable read-only entity/fact views can become MCP **resources** later
- prompts are optional and not required for Phase 1

## What We Already Have (Azure infra — done, ready for Phase 2)

- Databricks workspace: https://adb-7405608864534253.13.azuredatabricks.net
- ADLS Gen2: datacore3kcfne4phgzua
- Cluster: datacore-small (0320-205712-3aqxqhku)
- Notebooks: 01-bronze-ingest, 02-bronze-search (uploaded)
- Data uploaded to landing zone (11 files, 5.1MB)
- Bicep infra: `infra/deploy.sh` + `infra/setup-databricks.sh`


## Research Checkpoint Before Coding

- Confirm which target clients support `stdio`, Streamable HTTP, or both
- Validate the first build with MCP Inspector before wiring app-specific clients
- Treat legacy HTTP+SSE as compatibility-only, not the default design
- Keep OAuth/auth work out of the first local `stdio` prototype

## Task List

### Task 1 — Confirm Client Compatibility
- [ ] Read official docs for each target client before integrating it
- [ ] Confirm whether Claude.ai needs local spawn, remote HTTP, or both
- [ ] Confirm OpenClaw mcporter transport expectations
- [ ] Decide whether Streamable HTTP is needed in Phase 1 or can wait
- [ ] Pick one first client and use MCP Inspector as the neutral baseline

### Task 2 — Scaffold MCP Server Core
- [x] Create `datacore/mcp-server/` directory
- [x] Initialize: `npm init` + install `@modelcontextprotocol/sdk`
- [x] Create `src/index.ts` — MCP server entry point
- [x] Keep business logic transport-agnostic from day one
- [x] Register two tools: `log_event` and `search`
- [x] Add schemas for tool inputs/outputs
- [x] Start with `stdio`
- [x] Test locally with MCP Inspector: does the server start and respond?

### Task 3 — Implement log_event Tool
- [x] Accepts: `{source, type, content, context?}`
- [x] Writes to: `~/.datacore/bronze/YYYY-MM-DD.jsonl` (local)
- [x] Adds metadata: `_timestamp`, `_source`, `_event_id`
- [x] No schema enforcement — preserve everything raw (Bronze principle)
- [x] Test: call log_event manually, verify JSONL written

### Task 4 — Implement search Tool
- [x] Reads all JSONL files in `~/.datacore/bronze/`
- [x] Full-text search (grep-equivalent) across all events
- [x] Returns: matching events with source, timestamp, snippet
- [x] Keep `search` as a TOOL, not a Resource
- [x] Test locally from Inspector: query returns real matches

### Task 5 — Connect the First Real Client
- [x] Configure the first client whose transport/auth model matches the prototype
- [x] Verify: client can see `log_event` and `search`
- [x] Test: a real conversation writes events into `~/.datacore/bronze/`
- [x] This is the moment data starts flowing automatically

### Task 6 — Connect Additional Clients ✅
- [x] Configure the second target client (OpenClaw — auto-log hook)
- [x] Configure third client (Codex — `.mcp.json`)
- [x] Configure fourth client (Antigravity/Gemini — `.mcp.json` + file watcher R9)
- [x] Verify: all clients write to and read from the same Bronze store
- [ ] Add Streamable HTTP only if a future client cannot use `stdio`

### Task 7 — USE IT (discover entity types)
- [ ] Use search tool for real questions over 1-2 weeks
- [ ] Log every search that fails or returns too many results
- [ ] Identify patterns: what entity types would make search instant?
- [ ] Document discovered entities in ENTITIES.md
- [ ] This experience informs Phase 3 (add_entity tool)

### Task 8 — Connect to ADLS Gen2 (bridge to Azure)
- [ ] Add ADLS Gen2 storage backend to MCP server
- [ ] Events write to both local JSONL AND ADLS Gen2 landing zone
- [ ] Auto Loader picks up → Bronze Delta tables in Databricks
- [ ] Now Databricks notebooks work on the same data
- [ ] Run 01-bronze-ingest and 02-bronze-search on real data

### Task 9 — Document + Blog
- [ ] Write blog post: "Building a personal data MCP server"
- [ ] LinkedIn post: "every AI app writes to one data lake via MCP"
- [ ] Export notebooks to `datacore/notebooks/`

## Done Criteria (Phase 1 complete when)

- [x] MCP server running locally over `stdio` with `log_event` + `search` + `get_tasks`
- [x] MCP Inspector validates both tools end-to-end
- [x] At least one real client connected — conversations auto-captured
- [x] Second client connected — 4 AI apps connected (Claude Desktop, OpenClaw, Codex, Antigravity)
- [x] Full-text search works across all collected data (15,000+ events)
- [ ] At least 2 weeks of real usage data collected (started March 21)
- [ ] Entity types documented from search patterns (ENTITIES.md)

## What's NOT in Phase 1

- No add_entity tool (Phase 3 — need entity types from experience first)
- No add_fact tool (Phase 4 — need recurring questions first)
- No ADLS Gen2 write (Phase 2 — local JSONL first, Azure later)
- No Databricks notebooks (Phase 2 — they're ready, waiting for data)
- No HTTP+SSE as the default transport
- No Vector Search (Phase 4)
- No Data Factory (Phase 4)
- No Graph API (Phase 4 — M365 Copilot not on team currently)

## What We Keep From Current Setup

The Azure infra (Databricks + ADLS Gen2) is deployed and ready.
The notebooks are uploaded. The sample data is in the landing zone.
These become Phase 2 — connecting the MCP server to Azure backend.
See `DATA-ARCHITECTURE.md` for the full local → Azure migration path.

The manual scripts (collect.sh, upload.sh, log-session.sh) have been
archived to `datacore/archive/` — fully superseded by MCP tools and
file watchers.
