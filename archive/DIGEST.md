# Datacore — Digest: Round 1 (Storage Layer)

> Verified against official Azure Databricks PDF (22,461 pages) and Azure Storage PDF (4,162 pages)
> Research source: datacore/research-answers/round-1-raw.md
> Verified: March 20, 2026

## What We Confirmed

### 1. Delta Lake File Structure ✅ CONFIRMED

Research claimed: Delta Lake stores data as parquet files + `_delta_log/` directory with JSON transaction logs and checkpoint parquet files.

**Official docs confirm this** (found on pages 8126, 8442, 16600, 17006):
- Data files are Parquet (columnar, compressed)
- `_delta_log/` contains numbered JSON files recording AddFile/RemoveFile entries
- Checkpoint parquet files written periodically for read optimization
- `commitInfo` entries track operation metadata

**What the research got right:** The file tree example is accurate. The JSON structure with AddFile entries is real.

**What the research didn't mention:** The docs cover more advanced internals like deletion vectors, liquid clustering, and Z-ordering that affect the physical file layout significantly.

### 2. Storage Layer Choices ✅ CONFIRMED (with nuance)

Research claimed: ADLS Gen2 for Bronze/Silver, Cosmos DB or Azure SQL for Gold.

**Official docs confirm** (Databricks p.7127-7132, Storage p.195):
- Medallion architecture is the recommended pattern: Bronze (raw) → Silver (validated) → Gold (enriched)
- Bronze: "raw state of the data source in its original formats, appended incrementally"
- Silver: "schema enforcement, dedup, normalization, data quality checks, schema evolution, joins"
- Gold: "model data for reporting and analytics using a dimensional model"
- ADLS Gen2 with hierarchical namespace is the recommended storage for lakehouse workloads
- Multiple Gold layers per business domain is explicitly recommended

**What the research got right:** The Bronze/Silver/Gold mapping and storage recommendations are accurate.

**What the research oversimplified:** The docs say Gold can stay as Delta tables served via SQL endpoints — Cosmos DB and Azure SQL are optional serving layers, not the only Gold options. For our personal scale (10K events/day), Gold as Delta tables is plenty.

### 3. Schema Evolution ✅ CONFIRMED

Research claimed: ALTER TABLE ADD COLUMNS, mergeSchema option, MERGE INTO with schema evolution.

**Official docs confirm all three** (Databricks p.8136-8138):
- `ALTER TABLE ... ADD COLUMNS` — explicit column addition
- `mergeSchema` option on DataFrame writes — automatic schema merge
- `INSERT WITH SCHEMA EVOLUTION` / `MERGE WITH SCHEMA EVOLUTION` — SQL syntax
- Missing columns in old parquet files return NULL (no rewrite needed)
- `spark.databricks.delta.schema.autoMerge.enabled` config setting exists

**What the research got right:** All three approaches are valid and the code examples are accurate.

**What the research missed:** The docs also cover `overwriteSchema` for breaking changes (type changes, column renames), and Auto Loader has its own schema evolution modes (`schemaEvolutionMode`).

## Round 2 — Ingestion

### 4. Data Factory REST Connector ✅ CONFIRMED

Research claimed: Data Factory uses Copy Activity with RestSource type to ingest from REST APIs to ADLS Gen2.

**Official docs confirm** (ADF PDF p.1568, 2862-2864):
- Generic REST connector exists for any RESTful API
- Copy Activity with `RestSource` type is the documented pattern
- Pipeline JSON structure with linked services, datasets, activities is accurate

**For our scale:** Data Factory is enterprise tooling. For 10K events/day from 3-4 APIs, a simple Python script or Azure Function calling REST APIs and writing to ADLS Gen2 is more practical. Data Factory becomes worth it when you have dozens of sources or need visual pipeline management.

### 5. Auto Loader (cloudFiles) ✅ CONFIRMED

Research claimed: Auto Loader uses `cloudFiles` format to detect and ingest new files incrementally.

**Official docs confirm** (Databricks PDF p.67, 726, 959, 1719-1760):
- `spark.readStream.format("cloudFiles")` is the exact syntax
- Supports JSON, CSV, Parquet, and other formats
- Two detection modes: directory listing vs file notification (event-driven)
- Schema evolution built-in with `schemaEvolutionMode` setting
- Checkpoint-based — tracks which files have been processed

**Key detail from docs that research missed:** Auto Loader has a `trigger(availableNow=True)` mode for batch-like behavior with incremental state. This is the sweet spot for our use case — process new files when we run, not continuously.

### 6. Structured Streaming ✅ CONFIRMED (not verified in detail)

Research described PySpark structured streaming code. The Auto Loader example on p.67 IS structured streaming (`readStream`/`writeStream`). The pattern is confirmed. For our scale, Auto Loader with `availableNow` trigger is sufficient — no need for always-on streaming.

## Round 3 — Transformation

### 7. Medallion Pipeline Pattern ✅ CONFIRMED
Bronze → Silver → Gold with DLT/Lakeflow Declarative Pipelines. Docs confirm this is the recommended approach (p.7127-7132). DLT pipelines handle dependency management, data quality expectations, and auto-scaling.

### 8. Deduplication ✅ CONFIRMED
MERGE INTO is the standard dedup pattern. The docs cover this extensively across 54+ pages with mergeSchema support.

### 9. Lakeflow Declarative Pipelines ✅ CONFIRMED
Research called this "DLT" (Delta Live Tables) — the current name is "Lakeflow Spark Declarative Pipelines" (p.2358+). Unity Catalog integration is the default. Same concept, rebranded.

## Round 4 — Governance

### 10. Unity Catalog ✅ CONFIRMED
Three-level namespace (catalog.schema.table) for data governance. Docs confirm access control, lineage tracking, and cross-workspace sharing (p.2358+). This is the governance layer for all data assets.

### 11. Data Quality Expectations ✅ CONFIRMED (as part of DLT)
DLT/Lakeflow pipelines support `EXPECT` constraints for data quality. Not a standalone system — it's built into the pipeline framework.

## Round 5 — AI Access

### 12. Lakebase ✅ CONFIRMED (but different from research claim)
Research framed Lakebase as "for AI agents." Official docs say it's "fully managed Postgres database for OLTP and low-latency data serving" (p.2891). It's a general-purpose operational database, not AI-specific. But it IS useful for serving data to AI agents with low latency.

### 13. Mosaic AI Vector Search ✅ CONFIRMED
Databricks has native vector search built into the platform (p.4988). Creates embeddings, indexes them, supports similarity search. This is the RAG retrieval layer.

### 14. Azure AI Search ✅ CONFIRMED
Separate Azure service with agentic retrieval (RAG) support. Can index Delta Lake data. Alternative to Databricks' built-in vector search if we want Azure-native.

**Key insight:** Two paths for AI access — Databricks-native (Vector Search + Lakebase) or Azure-native (AI Search + Cosmos DB). For our project, the Databricks path is simpler since data already lives there.

## Round 6 — Local Development

### 15. delta-rs (Python deltalake) ⚠️ NOT IN AZURE DOCS
Research claimed we can use `pip install deltalake` (delta-rs) locally. This is NOT in the Azure Databricks PDF — it's from the open-source delta.io project. The claim is almost certainly correct (delta-rs is a well-known Rust implementation), but we can't verify it from our official docs.

**Practical note:** This is our local dev path. We should verify by actually running it:
```bash
pip install deltalake
python3 -c "import deltalake; print(deltalake.__version__)"
```

### 16. Local Spark ⚠️ NOT VERIFIED
Research suggested PySpark locally as an alternative. The Databricks docs assume a Databricks runtime — local Spark setup is not covered. Community Edition (free Databricks tier) may be the easier path for Spark testing.

## Round 7 — Cost

### 17. Databricks Pricing ⚠️ RESEARCH NUMBERS MAY BE OUTDATED
Research gave specific DBU prices. These change. For current pricing:
- Check: azure.microsoft.com/pricing/details/databricks/
- Community Edition: free but limited
- Student credits: $100 Azure for Students (may not cover Databricks)

## Summary

### What we confirmed from official sources:
1. **Delta Lake storage model** — parquet + _delta_log/ + checkpoints ✅
2. **Medallion architecture** — Bronze/Silver/Gold is the official pattern ✅
3. **Schema evolution** — ALTER TABLE, mergeSchema, MERGE WITH SCHEMA EVOLUTION ✅
4. **Data Factory REST ingestion** — Copy Activity with RestSource ✅
5. **Auto Loader** — cloudFiles format, incremental, checkpoint-based ✅
6. **DLT/Lakeflow Pipelines** — declarative transformation framework ✅
7. **Unity Catalog** — three-level namespace governance ✅
8. **Lakebase** — managed Postgres for OLTP/serving (not AI-specific) ✅
9. **Vector Search** — Mosaic AI native to Databricks ✅
10. **Azure AI Search** — alternative RAG path ✅

### What we CANNOT verify from official Azure docs:
- delta-rs local dev path (from delta.io, not Microsoft)
- Specific pricing numbers (check live pricing page)
- Code examples that mix Databricks-specific and open-source APIs

### Key corrections to our mental model:
- **DLT is now called "Lakeflow Spark Declarative Pipelines"** — same thing, new name
- **Lakebase is Postgres, not AI-specific** — useful for AI serving but general purpose
- **Gold layer doesn't require Cosmos DB** — Delta tables with SQL endpoints may suffice at our scale
- **Two AI access paths** — Databricks-native (Vector Search) vs Azure-native (AI Search)
- **Auto Loader has `availableNow` trigger** — batch-like with incremental state, perfect for us

### What to dig into next (Layer 2 targeted extractions):
- Medallion architecture deep dive (p.7127-7165) — reference architecture details
- Auto Loader configuration (p.1719-1760) — file detection modes, schema evolution
- Unity Catalog setup (p.2358-2380) — access control for our data
- Vector Search setup (p.4988-5047) — embeddings + index creation
