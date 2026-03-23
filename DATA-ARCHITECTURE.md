# Data Architecture — High Level Design

> Datacore data engineering architecture.
> Local-first today, Azure Databricks target.
> Created: March 23, 2026

## Current State (Local)

```
Sources → Capture → MCP → Bronze (JSONL) → grep search
```

Everything runs on MacBook Pro M1 Max 64GB.
Storage: `~/.datacore/bronze/*.jsonl` (20,900+ events, 19MB).
Protocol: MCP stdio. Transport: local process spawn.
Search: full-text grep. No embeddings, no semantic search.

## Target State (Azure Databricks)

```
Sources → Capture → MCP → Bronze (Delta) → Silver (Delta) → Gold (Delta)
                                ↓               ↓              ↓
                          ADLS Gen2         Vector Search   Knowledge Graph
                          (raw storage)     (semantic)      (curated facts)
```

All three Medallion layers as Delta tables on ADLS Gen2.
Compute: Azure Databricks (cluster + notebooks + pipelines).
Infra already deployed: rg-datacore, ADLS Gen2, Databricks workspace.

## Migration Path (Local → Azure)

### Phase 1 — Local Bronze (NOW, DONE)
- MCP server writes JSONL to local disk
- File watchers + hooks capture all AI sessions
- grep search over raw events
- No Azure dependency

### Phase 2 — Azure Bronze
- Upload local JSONL to ADLS Gen2 landing zone (`azcopy`)
- Auto Loader ingests into Bronze Delta table
- Same data, now in Delta format on cloud storage
- Local MCP server still primary — Azure is the backup/analytics layer

### Phase 3 — Azure Silver
- Databricks notebooks / Lakeflow pipelines: Bronze → Silver
- Dedup, normalize, entity extraction
- Mosaic AI Vector Search for semantic queries
- MCP server adds `search_semantic()` tool backed by Vector Search

### Phase 4 — Azure Gold
- Silver → Gold aggregation pipelines
- Curated facts table (question → answer pairs)
- Knowledge graph (entities + relationships)
- MCP server adds `add_fact()` and `add_entity()` tools
- Layered search: Gold → Silver → Bronze fallthrough

## Key Design Decisions

**Local-first, cloud-second.**
MCP server always works locally. Azure adds scale, semantic search, and
durability — but the system never depends on cloud being available.

**Delta tables, not raw files on ADLS.**
Delta gives ACID transactions, time travel, schema evolution, and
efficient queries. Raw JSONL on ADLS would be just a file dump.

**Auto Loader for ingestion.**
Incremental, checkpoint-based. Never re-reads old data. Handles
schema evolution automatically. Verified in Azure docs (p.1719).

**Lakeflow Pipelines for transformation.**
Declarative Bronze → Silver → Gold. Expectations for data quality.
Verified in Azure docs (p.2358).

## Azure Resources (Already Deployed)

| Resource | Name | Status |
|---|---|---|
| Resource group | rg-datacore | Deployed |
| Storage (ADLS Gen2) | datacore3kcfne4phgzua | Deployed |
| Databricks workspace | datacore-databricks | Deployed |
| Cluster | datacore-small | Created |
| Budget | A$100 Azure for Students | Active |

## Research Needed Before Migration

See `RESEARCH-AREAS.md` for full list. Migration-specific questions:

- **Embeddings:** Which model for Vector Search? Local or Databricks-hosted?
- **Sync strategy:** Real-time upload vs batch? How often does local → ADLS sync?
- **Cost:** How much cluster time per sync/pipeline run? Budget is A$100 total.
- **Hybrid search:** How does MCP server route between local grep and Azure Vector Search?

## Reference Docs

- Azure docs corpus: `~/Developer/docs/azure-docs/` (16 PDFs, 61K pages)
- TOC lookup: `grep -i "topic" docs/azure-docs/md/toc-*.md`
- Architecture: `datacore/DESIGN.md` (full details)
- Memory layers: `datacore/MEMORY-ARCHITECTURE.md`
- Research areas: `datacore/RESEARCH-AREAS.md`
