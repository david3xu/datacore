# Datacore — Research Questions for OpenClaw

> These questions are designed to be sent to OpenClaw's GPT-5-mini (with web search)
> to read official Microsoft Learn and Databricks documentation and bring back
> implementation-level answers.
>
> Goal: Understand what Azure + Databricks data services actually DO and HOW,
> so we can design datacore based on real knowledge, not imagination.
>
> Instructions for OpenClaw: For each question, search official Microsoft Learn
> (learn.microsoft.com) and Databricks docs (docs.databricks.com) ONLY.
> Give concrete answers with code examples where relevant. No generic overviews.

---

## Round 1 — Storage: How Data Actually Lives

Q1. How does Delta Lake store data on disk? What files are created when I
    create a Delta table and insert 100 rows? Show the actual file structure
    (parquet files, _delta_log/, JSON transaction log). Source: Databricks docs.

Q2. What is the difference between storing data in Azure Data Lake Storage Gen2
    vs Cosmos DB vs Azure SQL? When do you use each? Give a concrete example:
    if I have 10,000 event records per day, which storage for Bronze, which for
    Gold? Source: Microsoft Learn architecture guidance.

Q3. How does Delta Lake handle schema evolution? If my Bronze table has columns
    (id, timestamp, source, content) and I later need to add (actor, event_type),
    what happens? Show the actual SQL/Python commands. Source: Databricks docs.

---

## Round 2 — Ingestion: How Data Gets In

Q4. How does Azure Data Factory ingest data from a REST API (like DEV.to or
    LinkedIn API) into a Delta Lake table? Show the pipeline definition — what
    does a Data Factory pipeline look like in JSON/YAML? What are the components
    (linked services, datasets, activities)? Source: Microsoft Learn Data Factory docs.

Q5. How does Databricks Auto Loader work? If I have a folder where new JSONL
    files appear (like OpenClaw sessions), how does Auto Loader detect and
    ingest them incrementally? Show the actual PySpark code.
    Source: Databricks docs on Auto Loader.

Q6. What does Structured Streaming look like in practice? If I want to process
    events as they arrive (not batch), show the PySpark code for reading from
    a source, transforming, and writing to a Delta table. How is this different
    from a batch job? Source: Databricks Structured Streaming docs.

---

## Round 3 — Transformation: Bronze → Silver → Gold

Q7. Show a complete, minimal Medallion pipeline example in Databricks.
    Real code, not pseudocode. Bronze table ingests raw JSON, Silver table
    cleans and deduplicates, Gold table aggregates for a specific use case.
    What does each notebook/pipeline step look like?
    Source: Databricks medallion architecture docs or tutorials.

Q8. What are Delta Live Tables (DLT) / Spark Declarative Pipelines?
    How do they differ from writing Spark SQL manually?
    Show a DLT pipeline definition that does Bronze → Silver → Gold.
    What are "expectations" (data quality rules) and how do you define them?
    Source: Databricks DLT/Lakeflow docs.

Q9. How do you handle deduplication in the Silver layer? If the same event
    arrives twice (e.g., OpenClaw restarts and replays), what's the standard
    pattern? MERGE INTO? Window functions? Show the actual SQL.
    Source: Databricks best practices docs.

---

## Round 4 — Governance: How Data Stays Trustworthy

Q10. What does Unity Catalog actually do? How do you set it up? Show the
     commands to create a catalog, schema, and table with access controls.
     How does lineage tracking work — if I query a Gold table, can I trace
     back to which Bronze sources fed it? Source: Databricks Unity Catalog docs.

Q11. How does Azure Purview compare to Unity Catalog? When do you use which?
     If I'm on Azure Databricks, do I need both? Source: Microsoft Learn.

Q12. What are data quality checks in practice? Show how to define expectations
     like "timestamp must not be null" and "source must be one of [openclaw,
     claude, git, linkedin]" using DLT expectations or Delta constraints.
     What happens when a record fails? Source: Databricks docs.

---

## Round 5 — AI Access: How AI Reads the Data

Q13. How does Azure AI Search index data from a Delta Lake table? What's the
     pipeline from Databricks Gold table → AI Search index → AI agent query?
     Show the setup steps and code. Source: Microsoft Learn AI Search docs.

Q14. How does Semantic Kernel (C#/.NET) connect to a data source for RAG?
     If I have a Gold table with conversation summaries, how does an AI agent
     query it? Show the Semantic Kernel plugin code.
     Source: Microsoft Learn Semantic Kernel docs.

Q15. What is Databricks Lakebase? How does it differ from a regular Delta table
     for AI agent access? When would you use Lakebase vs a Gold Delta table
     with an API in front? Source: Databricks Lakebase docs.

---

## Round 6 — Local Dev: Can We Prototype Without Azure?

Q16. Can I run Delta Lake locally without Databricks or Azure? What's the
     minimum setup? Can delta-rs (Rust/Python) or delta-spark work on my
     MacBook with just local files? Show the pip install + basic usage.
     Source: delta.io docs, delta-rs GitHub.

Q17. What is the simplest way to prototype a Medallion pipeline locally
     that would later deploy to Azure Databricks without rewriting?
     Is there a local Spark option, or should I use delta-rs with polars/pandas?
     Source: Databricks docs, delta-rs docs.

---

## Round 7 — Cost and Feasibility: What Can a Student Actually Use?

Q18. What does Azure Databricks cost? Is there a free tier or student option?
     What does a minimal workspace cost per month for light usage (a few
     notebooks, small Delta tables, no cluster running 24/7)?
     Source: Azure pricing calculator, Databricks pricing page.

Q19. What Azure services are available on Azure for Students ($100 credit)?
     Can I use ADLS Gen2, Data Factory, Databricks, Cosmos DB, AI Search
     on student credits? What's blocked? Source: Microsoft Learn Azure for Students.

Q20. What is Databricks Community Edition? What can and can't it do compared
     to a full workspace? Can I build a Medallion pipeline on it?
     Source: Databricks Community Edition docs.

---

## Execution Plan

### How to run this research

**Option A — Send to OpenClaw via WebChat/Discord**
1. Start a new session: `/new`
2. Set model: `/model github-copilot/gpt-5-mini`
3. Paste one round of questions at a time (3-4 questions per message)
4. Tell it: "Search official Microsoft Learn and Databricks docs only.
   Give concrete answers with code examples. No generic overviews."
5. Save each response to datacore/research-answers/round-N.md

**Option B — Send via Claude with web search**
1. Same questions, but use Claude's web search to fetch official docs
2. Advantage: can read full pages with web_fetch
3. Save answers the same way

**Option C — Read the docs directly**
1. Use the question list as a reading guide
2. Go to learn.microsoft.com and docs.databricks.com
3. Read the specific pages that answer each question
4. Take notes in datacore/research-answers/

### After research is complete

1. Synthesize answers into a design doc: datacore/DESIGN.md
2. Map each design decision to the real capability we learned
3. Choose local prototype tech (delta-rs? DuckDB? local Spark?)
4. Build Bronze layer first with proper patterns
5. Iterate Silver and Gold as we understand more
