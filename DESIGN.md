# Datacore — Design Document (v4 — Azure-native + Knowledge Graph)

> Azure ecosystem only. Every component maps to an Azure service.
> Verified against official Azure/Databricks docs — page citations and
> correction notes preserved in `archive/DIGEST.md` (17 claims checked).
> MCP section verified against official MCP spec/SDK (latest spec dated November 25, 2025).
> Knowledge graph design informed by real search failure (see below).
> Industry research and original questions archived in `archive/RESEARCH.md`
> and `archive/RESEARCH-QUESTIONS.md` — findings applied to this document.
> Created: March 20, 2026 | Updated: March 23, 2026

## Vision

Datacore is **the coordination layer between multiple AI agents working
on the same projects.**

A human (David) sets direction, makes decisions, asks questions. Multiple
AI models do the work — Claude Desktop architects and reviews (Tech Lead),
Codex and Gemini/Antigravity build from specs (Dev Staff), OpenClaw
dispatches tasks and tracks status (Manager). Each AI produces knowledge:
decisions, code, insights, search results, tool outputs.

Without datacore, that knowledge is scattered across chat histories, local
files, cloud services, and session logs. Each AI starts from zero. The human
must manually relay context between them.

With datacore, every AI reads and writes to one shared data layer via MCP.
The Tech Lead can see what every builder did. The Manager can track task
state. The human doesn't repeat context. Knowledge compounds across sessions
and across models. See `docs/workflow.md` for the full team hierarchy.

**The MCP server is the shared memory. The Medallion layers are the quality
progression. The knowledge graph is the map that connects everything.**

This is not just a portfolio project — it is a personal data platform that
makes every AI interaction more informed than the last.

For the 4-layer memory model (Identity / Working / Project / Shared) and
how Datacore fits as the shared memory layer, see `MEMORY-ARCHITECTURE.md`.

### Proof: March 21, 2026

In one session, Claude (via Claude.ai) designed the MCP architecture and
updated docs. GPT-5.4 (via OpenClaw) built the actual mcp-server code,
wrote a decision memo, and ran smoke tests. When Claude started the next
session, it had to manually discover what GPT-5.4 did by reading the
filesystem — checking timestamps, reading files, comparing changes.

If the MCP server had been running, GPT-5.4 would have called `log_event`
for every decision and action. Claude would have called `search("what
happened since last session")` and gotten an instant answer. That gap is
exactly what datacore solves.

## Design Principle

Two goals reinforce each other:

1. **Learn Azure data engineering** — build with the same services and
   patterns as enterprise deployments (Databricks, ADLS Gen2, Data Factory,
   Unity Catalog, Lakeflow, Vector Search).

2. **Build genuinely useful infrastructure** — a personal data platform
   where every AI tool reads and writes through one MCP server, knowledge
   compounds across sessions, and no context is ever lost.

## Architecture: Medallion + Knowledge Graph

**Medallion layers** (verified: Databricks p.7127-7132) store data at different
quality levels. The **knowledge graph** spans all three layers as the map that
connects entities to their data across resolutions.

```
                    KNOWLEDGE GRAPH (the map — spans all layers)
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    │  (David) ──has_account──→ (Azure for    │
                    │     │                      Students)    │
                    │     │                        │          │
                    │  has_project              credits: A$100│
                    │     │                     expires: Oct26│
                    │     ▼                        │          │
                    │  (datacore)                   │          │
                    │     │                        │          │
                    │     ├── points to Bronze: raw transcript │
                    │     ├── points to Silver: parsed event   │
                    │     └── points to Gold: curated fact      │
                    │                                         │
                    └─────────────────────────────────────────┘

SOURCES              BRONZE (raw)           SILVER (clean)          GOLD (serve)
───────              ────────────           ──────────────          ───────────
OpenClaw JSONL  ──→  Delta table            Delta table             Delta table
Git log         ──→  on ADLS Gen2           on ADLS Gen2            on ADLS Gen2
LinkedIn API    ──→  (append-only,          (deduplicated,          (aggregated,
DEV.to API      ──→   raw preserved)         normalized)             AI-queryable)
Claude transcripts →  + full-text indexed    + entity extraction     + curated facts
```

**Key insight (learned from real search failure, March 20):**

The knowledge graph is NOT a layer. It's the connective tissue that
lets a single query find answers across all three layers:

```
Query: "what Azure accounts does David have?"
  │
  ▼
Gold (curated facts)
  → "Azure for Students, A$100, 291928K@curtin.edu.au" → FOUND, done.

Query: "why did we choose Databricks Free Edition?"
  │
  ▼
Gold → no curated fact about this decision
Silver → search events for "databricks" + "free edition"
  → event: "discussed Databricks options" on March 20 → FOUND

Query: "what exact capabilities does the M365 sandbox have?"
  │
  ▼
Gold → no curated fact
Silver → event exists but lacks full detail
Bronze → grep raw transcript from March 18
  → full conversation with capabilities table → FOUND
```

Each layer is slower but wider. The graph knows which layer has the answer.

## Azure Services Stack

| Layer | Azure Service | Role | Verified |
|---|---|---|---|
| **Storage** | ADLS Gen2 (hierarchical namespace) | All Delta tables live here | Storage PDF p.195 ✅ |
| **Compute** | Azure Databricks | Spark, notebooks, pipelines | Databricks PDF p.67 ✅ |
| **Ingestion** | Auto Loader (cloudFiles) | Incremental file ingestion | Databricks p.1719 ✅ |
| **Ingestion** | Azure Data Factory | REST API sources (LinkedIn, DEV.to) | ADF PDF p.1568 ✅ |
| **Transform** | Lakeflow Declarative Pipelines | Bronze → Silver → Gold quality pipeline | Databricks p.2358 ✅ |
| **Governance** | Unity Catalog | catalog.schema.table namespace + ACL | Databricks p.2358 ✅ |
| **AI Access** | Mosaic AI Vector Search | Embeddings + RAG retrieval | Databricks p.4988 ✅ |
| **Serving** | SQL Endpoints (serverless) | Query Gold tables via SQL | Databricks p.3404 ✅ |
| **Events** | Azure Event Grid | Trigger pipelines on data arrival | Event Grid PDF ✅ |
| **Knowledge Graph** | Azure Cosmos DB (Gremlin API) or Databricks graph tables | Entity-relationship map across all layers | Design decision (not from docs) |

## Data Flow: Cross-Platform to Database

Three stages: Collect → Ingest → Transform. Local files push to Azure.
APIs are pulled by Azure. Auto Loader picks up everything.

```
LOCAL (Mac)                                    CLOUD (Azure)
─────────────                                  ──────────────

~/.openclaw/sessions/*.jsonl ─── azcopy ──→ ADLS Gen2
/mnt/transcripts/*.txt       ─── azcopy ──→   landing/openclaw/
git log --format=json        ─── azcopy ──→   landing/git/
                                               landing/claude/
                                                    │
                                              ┌─────▼──────┐
LinkedIn API ── Data Factory REST ─────────→  │  landing/   │
DEV.to API   ── Data Factory REST ─────────→  │  linkedin/  │
                                              │  devto/     │
                                              └─────┬──────┘
                                                    │
                                              Auto Loader
                                              (watches landing/)
                                                    │
                                              ┌─────▼──────────────────────┐
                                              │  ADLS Gen2 datacore/       │
                                              │  ├── bronze/ (raw Delta)   │
                                              │  ├── silver/ (clean Delta) │
                                              │  └── gold/   (serve Delta) │
                                              └─────┬──────────────────────┘
                                                    │
                                              Lakeflow Pipeline
                                              Bronze → Silver → Gold
                                                    │
                                              ┌─────▼──────────────────┐
                                              │  Knowledge Graph       │
                                              │  (spans all layers)    │
                                              │  Gold → Silver → Bronze│
                                              │  layered search        │
                                              └────────────────────────┘
```

**Stage 1 — Collect (get data to ADLS Gen2 landing zone):**

| Source | Method | Trigger |
|---|---|---|
| OpenClaw JSONL | `azcopy` from Mac | Manual or cron |
| Claude transcripts | `azcopy` from Mac | Manual or cron |
| Git commits | Export + `azcopy` | Manual or cron |
| LinkedIn API | Data Factory REST connector | Scheduled (daily) |
| DEV.to API | Data Factory REST connector | Scheduled (daily) |

**Stage 2 — Ingest (Auto Loader → Bronze Delta):**
Auto Loader watches `landing/` on ADLS Gen2. When new files appear,
it reads them, adds metadata (`_source`, `_source_file`, `_ingest_ts`),
and writes to `bronze/` Delta tables. Checkpoint-based — never re-reads.

**Stage 3 — Transform (Lakeflow Pipeline → Silver → Gold):**
Bronze → parse, validate, dedup → Silver → aggregate → Gold.
Knowledge graph grows as we use the data and discover entity patterns.

**Infrastructure as Code:** Two-step setup, fully automated.
```bash
cd ~/Developer/datacore/infra

# Step 1: Bicep — creates Azure resources (rg, storage, Databricks workspace)
./deploy.sh

# Step 2: Databricks API — creates cluster, configures storage, uploads notebooks
./setup-databricks.sh
```
Bicep handles what Azure Resource Manager manages (storage, workspace, budget).
Databricks API handles what lives inside the workspace (cluster, spark_conf, notebooks).
Storage account key is injected into the cluster's `spark_conf` at creation — no manual
configuration needed in notebooks.

## How Each Service Fits

### ADLS Gen2 — where all data lives

Every Delta table (Bronze, Silver, Gold) stores its parquet files + `_delta_log/`
on ADLS Gen2. Hierarchical namespace enabled for directory-level operations.

```
abfss://datacore@<account>.dfs.core.windows.net/
├── bronze/
│   ├── openclaw_events/     ← Delta table (parquet + _delta_log/)
│   ├── git_commits/
│   └── api_responses/
├── silver/
│   └── events/              ← Deduplicated, normalized
└── gold/
    ├── daily_timeline/
    └── model_usage/
```

### Auto Loader — file-based ingestion

For sources that produce files (OpenClaw JSONL, git log exports):

```python
# From official docs (Databricks p.67):
(spark.readStream
  .format("cloudFiles")
  .option("cloudFiles.format", "json")
  .option("cloudFiles.schemaLocation", checkpoint_path)
  .load(file_path)
  .select("*",
    col("_metadata.file_path").alias("_source_file"),
    current_timestamp().alias("_ingest_ts"))
  .writeStream
  .option("checkpointLocation", checkpoint_path)
  .trigger(availableNow=True)    # batch-like, incremental state
  .toTable("bronze.openclaw_events"))
```

**Key:** `trigger(availableNow=True)` processes all new files since last checkpoint,
then stops. Not continuous streaming — runs on demand or scheduled.

### Azure Data Factory — REST API ingestion

For LinkedIn API, DEV.to API, and other REST sources:
- Copy Activity with `RestSource` type → lands JSON in ADLS Gen2
- Databricks notebook picks up landed files via Auto Loader
- **Verified:** ADF PDF p.1568, p.2862-2864

Pipeline: `REST API → ADF Copy Activity → ADLS Gen2 landing zone → Auto Loader → Bronze Delta`

### Lakeflow Declarative Pipelines — transformation

Bronze → Silver → Gold transformations as declarative pipelines:

```python
# Lakeflow pipeline (formerly DLT)
import dlt

@dlt.table(comment="Cleaned events from all sources")
@dlt.expect("event_id_not_null", "event_id IS NOT NULL")
@dlt.expect("valid_source", "source IN ('openclaw','claude','git','linkedin','devto')")
def silver_events():
    return (
        dlt.read("bronze_openclaw_events")
        .select(parse_and_normalize_udf("raw_json"))
        .dropDuplicates(["event_id"])
    )
```

### Unity Catalog — governance

Three-level namespace for all data assets:

```
datacore (catalog)
├── bronze (schema)
│   ├── openclaw_events (table)
│   ├── git_commits (table)
│   └── api_responses (table)
├── silver (schema)
│   └── events (table)
└── gold (schema)
    ├── daily_timeline (table)
    └── model_usage (table)
```

Access control via GRANT/REVOKE. Lineage tracked automatically.
**Verified:** Databricks p.2358+

### Mosaic AI Vector Search — AI access

Gold Delta → embeddings → vector index → RAG queries from agents.

```
Gold Delta table
  ↓ compute embeddings (Databricks notebook or Model Serving)
Vector Search index
  ↓ similarity search API
AI agent (OpenClaw skill / Semantic Kernel)
```

**Verified:** Databricks p.4988-5047. Creates and manages vector indexes
natively within the Databricks platform.

### Knowledge Graph — the map across all layers

The knowledge graph is NOT inside any layer. It connects entities to their
data at every resolution. A node like "Azure for Students" has edges pointing
to Bronze (raw transcript), Silver (parsed event), and Gold (curated fact).

**How it grows:** You can't design entity types upfront. They emerge from
real usage — when a search fails, you discover what entities matter.

```
Build order:
1. Ingest everything into Bronze (raw, full-text searchable)
2. USE the data — search, fail, discover what questions matter
3. Extract entities into the graph based on real failures
4. Curate Gold facts for questions that keep recurring
```

**Entity types discovered so far (from today's search failure):**
- Account (Azure subscription, M365 sandbox, OpenClaw providers)
- Project (datacore, openclaw, azure-conflux, blog, kaggle)
- Decision (architectural choices with rationale and date)
- Tool/Service (Databricks, ADLS Gen2, Data Factory, etc.)

**Azure service:** Cosmos DB Gremlin API (graph database) or Databricks
graph tables. Both support entity-relationship queries. Cosmos DB Gremlin
has a free tier (1000 RU/s). Decision deferred until we have enough
entities to justify a graph database.

### Layered search strategy

When a query comes in, search layer by layer — fast and precise first,
slow and broad last:

```
Query arrives
  ├─→ Gold (curated facts)                  → instant, precise
  │     if found → return answer
  ├─→ Silver (entity search)                → seconds, structured
  │     if found → return answer
  └─→ Bronze (full-text grep)               → slower, complete
        if found → return answer + add entity to graph for next time
```

## Schema

### Bronze — preserve raw, add metadata only
```sql
CREATE TABLE datacore.bronze.openclaw_events (
    id STRING,
    raw_json STRING,             -- full original JSON, not parsed
    _source STRING,              -- openclaw | claude | git | linkedin | devto
    _source_file STRING,         -- lineage: which file produced this
    _ingest_ts TIMESTAMP         -- when ingested
) USING DELTA
LOCATION 'abfss://datacore@<account>.dfs.core.windows.net/bronze/openclaw_events';
```

**Critical source: Claude transcripts.** Today's search proved that Claude
conversation transcripts contain the richest contextual information — decisions,
account details, architecture reasoning. These must be ingested as a first-class
source alongside OpenClaw sessions.

### Silver — normalized common event model
```sql
CREATE TABLE datacore.silver.events (
    event_id STRING,             -- unique (source + source_id)
    timestamp TIMESTAMP,         -- normalized to UTC
    source STRING,               -- openclaw | claude | git | linkedin | devto
    source_id STRING,            -- original platform ID
    session_id STRING,           -- conversation/session grouping
    parent_id STRING,            -- reply chain
    actor STRING,                -- david | ai:gpt-5-mini | system
    event_type STRING,           -- message | tool_call | commit | post | article
    content_text STRING,         -- searchable plain text
    metadata STRING              -- JSON for source-specific extras
) USING DELTA
LOCATION 'abfss://datacore@<account>.dfs.core.windows.net/silver/events';
```

### Schema Evolution
Three approaches (verified from Databricks p.8136-8138):
1. `ALTER TABLE ... ADD COLUMNS` — explicit
2. `mergeSchema` option on writes — automatic
3. `MERGE WITH SCHEMA EVOLUTION` — for upserts

Old parquet files don't need rewriting — missing columns return NULL.

### Deduplication — MERGE INTO
```sql
MERGE INTO datacore.silver.events AS t
USING staged_events AS s
ON t.event_id = s.event_id
WHEN MATCHED AND s._ingest_ts > t._ingest_ts THEN UPDATE SET *
WHEN NOT MATCHED THEN INSERT *
```

## Development Environment

### Azure Databricks on Azure for Students (single subscription)

Everything runs under one Azure subscription — no separate environments.

| Setting | Value |
|---|---|
| **Subscription** | Azure for Students (291928K@curtin.edu.au) |
| **Subscription ID** | 52758373-b269-439c-8ba0-976397a796cf |
| **Resource group** | rg-openclaw-ai (or create new: rg-datacore) |
| **Workspace name** | TBD (e.g. datacore-databricks) |
| **Pricing Tier** | Premium (includes Unity Catalog, RBAC) |
| **Region** | East US |
| **Workspace type** | Hybrid (uses Azure compute + storage) |
| **Credits** | A$100 (expires Oct 2026) |

**Premium tier gives us everything from day one:**
Unity Catalog, Auto Loader, Lakeflow Pipelines, Vector Search,
SQL Endpoints, RBAC — no feature gaps to work around.

**Cost discipline:** Premium Databricks clusters burn credits fast ($1-5/hour).
Rules:
- Start clusters only when actively working
- Shut down immediately after each session
- Use smallest cluster size available
- Monitor spend weekly at Azure Portal → Cost Management
- Budget alert at A$50 (half of credits)

## Cost

All from Azure for Students credits (A$100, expires Oct 2026).

| Service | Estimated cost | Notes |
|---|---|---|
| **Databricks compute** | $1-5/hour when running | Shut down when not working |
| **ADLS Gen2 storage** | <$1/month | Tiny data volume |
| **Data Factory** | Free tier likely sufficient | Pay per activity run |
| **Event Grid** | Free tier | First 100K operations/month free |

**Budget:** A$100 total. If we run Databricks ~2 hours/week for 12 weeks,
that's ~A$24-60 for compute + negligible storage. Should last the project.

## MCP Server: The Data Collection Foundation

**Core insight:** Without data flowing in, nothing else matters. The MCP server
IS the ingest layer — every AI app that connects becomes an automatic data
source. File watchers (R6, R7, R9) handle passive capture; `log_event` handles
active capture. Together they cover all team members.

```
Every AI app (read + write)          Datacore MCP Server
                                     ┌──────────────────────────────┐
Claude Desktop  log_event() ────────→ │                              │
(Tech Lead)    search() ←─────────── │  WRITE TOOLS:                │
                                     │   log_event → Bronze         │
OpenClaw ───── log_event() ────────→ │   add_entity → Silver/KG     │
(Manager)      search() ←─────────── │   add_fact → Gold            │
                                     │                              │
Codex ──────── log_event() ────────→ │  READ TOOL (Phase 1):        │
(Builder)      search() ←─────────── │   search → Gold/Silver/Bronze│
                                     │                              │
Antigravity ── log_event() ────────→ │  READ RESOURCES (later):     │
(Builder)      entity://id ←──────── │   entity://{id}              │
                                     │   facts://{topic}            │
                                     └────────────┬─────────────────┘
                                                  │
                                     ┌────────────▼───────────────┐
                                     │  STORAGE (ADLS Gen2)       │
                                     │  ├── bronze/ (raw events)  │
                                     │  ├── silver/ (entities)    │
                                     │  └── gold/ (curated)       │
                                     │  + Knowledge Graph         │
                                     └────────────────────────────┘
```

### MCP Primitives Mapping

Per the official MCP model, Datacore should use the primitives this way:

- **Tools** for actions and query-time computation: `log_event`, `search`, later
  `add_entity` and `add_fact`
- **Resources** for stable, read-only, addressable records once they exist:
  `entity://{id}`, `facts://{topic}`
- **Prompts** as optional UI/human helpers, not the foundation of ingestion

### MCP Write Tools (how data gets in)

```
log_event(source, type, content, context?)
  → appends to Bronze Delta table as-is
  → no schema required — preserve everything raw
  → every AI calls this to record decisions, completions, questions

add_entity(name, type, attributes, source_ref)
  → creates/updates node in knowledge graph
  → edges point to Bronze source data
  → AI calls this when it recognizes something worth extracting

add_fact(question, answer, verified, source_refs)
  → curated Gold fact — instant answer next time
  → AI calls this when a question keeps recurring
```

### MCP Read Surfaces (tool first, resources when stable)

```
search(query, max_results?)
  → stays a TOOL, not a Resource
  → layered search: Gold facts → Silver entities → Bronze full-text
  → query-time computation across many records/layers
  → returns results with source references

entity://{id}
  → RESOURCE template once entities are stable/addressable
  → returns entity + all edges (Bronze refs, Silver events, Gold facts)

facts://{topic}
  → RESOURCE template once curated facts are durable read models
  → returns curated answers for known questions
```

`search` remains a tool because it is a parameterized query that can span
multiple layers and do non-trivial work. Resources are a better fit once
Datacore has durable, URI-addressable read models.

### MCP Prompts (optional, not Phase 1)

Prompt templates can help human users or rich clients kick off common flows
like "capture this session" or "summarize a topic," but they are not required
to make Datacore useful. Phase 1 should ship tools first.

### Build Order (MCP server grows with usage)

```
Week 0: verify target client transport/auth requirements
        start with the simplest transport that the client supports

Week 1: stdio server + log_event → writes JSONL to local disk
        validate with MCP Inspector and one local client
        every conversation automatically captured to Bronze

Week 2: search tool → full-text over collected data
        Now AI apps can read back what was collected

Week 3: Streamable HTTP transport (only if a target client needs remote/hosted)
        add auth boundary if exposed over HTTP

Week 4: ADLS Gen2 backend → events flow to Azure
        Databricks can process the data

Week 5: add_entity / add_fact → knowledge graph grows
        Entity types discovered from real search patterns
```

### Transport Strategy (best practice as of March 21, 2026)

- Start with **stdio** for local, process-spawned integrations and MCP Inspector.
  It is the simplest path and avoids premature auth/server work.
- Add **Streamable HTTP** when Datacore needs remote or hosted access. This is
  the current recommended remote transport.
- Do **not** design around legacy HTTP+SSE. Treat it as a compatibility shim
  only if a specific client still requires it.
- Keep transport adapters thin. Tool logic, storage, and schemas should be
  shared between stdio and HTTP entry points.

### Security Boundary

- For **stdio**, use local configuration or environment credentials. The MCP
  HTTP authorization flow does not apply there.
- For **Streamable HTTP**, Datacore acts as an OAuth 2.1 resource server and
  should follow the MCP authorization spec.
- Do **not** do token passthrough to downstream APIs. Tokens must be issued for
  Datacore itself and validated for audience.
- Personal data means narrow scopes, explicit consent, and auditability should
  be part of the design from the start.

## Implementation Plan

### Phase 1 — MCP Server + Data Collection (the foundation)
1. Verify target client transport/auth requirements from official docs
2. Build datacore MCP server core (TypeScript or Python, MCP SDK)
3. Implement stdio transport + Inspector validation
4. Implement `log_event` tool → writes JSONL to local disk
5. Connect the first compatible client
6. Implement `search` tool → full-text over collected JSONL
7. Add Streamable HTTP only if a target client requires remote access
8. **USE IT** — search real questions, discover entity patterns
9. Deliverable: working MCP server, data flowing in from real usage

### Phase 2 — Azure Backend + Bronze Delta
1. Connect MCP server to ADLS Gen2 (write events to landing zone)
2. Auto Loader picks up events → Bronze Delta tables
3. Databricks notebooks for batch processing and analytics
4. Full-text search over Bronze Delta (02-bronze-search notebook)
5. Document entity types emerging from search patterns (ENTITIES.md)

### Phase 3 — Silver + Knowledge Graph
1. Design Silver schema based on real search patterns from Phase 1-2
2. Implement `add_entity` MCP tool
3. Build knowledge graph nodes + edges pointing to Bronze data
4. Dedup and normalize events
5. Lakeflow Pipeline for automated Bronze → Silver transformation
6. Unity Catalog governance

### Phase 4 — Gold + Full Stack
1. Implement `add_fact` MCP tool
2. Curate Gold facts from frequently-asked questions
3. Layered search working: Gold → Silver → Bronze fallthrough
4. Enable Mosaic AI Vector Search for semantic queries
5. Data Factory for REST API sources (LinkedIn, DEV.to, Graph API)
6. Deliverable: "one query" answers across all layers from any AI app

## Project Structure

```
datacore/
├── DESIGN.md              ← this file
├── PLAN.md                ← Phase 1 task breakdown
├── README.md              ← vision + architecture
├── SCHEMA.md              ← common event schema
├── TASK-MANAGEMENT-DESIGN.md ← task lifecycle + dispatch design
├── AI-ORG-CHART.md        ← team hierarchy + wakeup protocol
├── LOGGING-INSTRUCTIONS.md ← how AIs log events
├── MEMORY-ARCHITECTURE.md ← 4-layer memory model
├── MCP-DECISION-MEMO.md   ← verified MCP spec decisions
├── MCP-DEEP-DIVE.md       ← how the MCP server actually works
├── mcp-server/            ← THE FOUNDATION (MCP server for all AI apps)
├── diagrams/              ← architecture diagrams (SVG + PNG)
│   ├── src/
│   │   ├── index.mjs      ← MCP server entry point
│   │   └── bronze-store.mjs ← JSONL read/write + search + get_tasks
│   └── package.json
├── tasks/                 ← task specs by round (R1-R18+)
├── hooks/                 ← OpenClaw auto-log hook
├── infra/                 ← IaC (Bicep + Databricks API)
├── notebooks/             ← Databricks notebooks (Phase 2+)
├── sample-data/           ← collected session data for testing
└── archive/               ← deprecated scripts + pre-MCP files

Official docs: ~/Developer/docs/azure-docs/
```
