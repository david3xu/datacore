# Databricks notebook source
# MAGIC %md
# MAGIC # Bronze Search — Full-Text Search Across All Sources
# MAGIC 
# MAGIC > Phase 1, Task 4: Search all Bronze Delta tables by keyword.
# MAGIC > This is the MINIMUM VIABLE PRODUCT — find anything in your data.
# MAGIC > Use this to discover what entity types matter (Task 5).

# COMMAND ----------

# Configuration (same as 01-bronze-ingest)
STORAGE_ACCOUNT = "datacore3kcfne4phgzua"
BRONZE_PATH = f"abfss://datacore@{STORAGE_ACCOUNT}.dfs.core.windows.net/bronze"

# Storage access is configured at cluster level (spark_conf) — no manual key needed.

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Load all Bronze tables into a unified searchable view

# COMMAND ----------

from pyspark.sql.functions import col, lit, lower, concat_ws, to_json, struct

# Load each Bronze table and create a unified search view
tables = {}

# OpenClaw events — convert all columns to a searchable string
try:
    df = spark.read.format("delta").load(f"{BRONZE_PATH}/openclaw_events")
    tables["openclaw"] = (
        df.withColumn("_search_text", to_json(struct(*df.columns)))
          .select("_search_text", "_source", "_source_file", "_ingest_ts")
    )
    print(f"  openclaw_events: {df.count()} rows")
except Exception as e:
    print(f"  openclaw_events: not available ({e})")

# Git commits — combine all fields into searchable text
try:
    df = spark.read.format("delta").load(f"{BRONZE_PATH}/git_commits")
    tables["git"] = (
        df.withColumn("_search_text", to_json(struct(*df.columns)))
          .select("_search_text", "_source", "_source_file", "_ingest_ts")
    )
    print(f"  git_commits: {df.count()} rows")
except Exception as e:
    print(f"  git_commits: not available ({e})")

# Project docs — full text is already the value column
try:
    df = spark.read.format("delta").load(f"{BRONZE_PATH}/project_docs")
    tables["docs"] = (
        df.withColumn("_search_text", col("value"))
          .select("_search_text", "_source", "_source_file", "_ingest_ts")
    )
    print(f"  project_docs: {df.count()} rows")
except Exception as e:
    print(f"  project_docs: not available ({e})")

# Claude transcripts (when available)
try:
    df = spark.read.format("delta").load(f"{BRONZE_PATH}/claude_transcripts")
    tables["claude"] = (
        df.withColumn("_search_text", col("value"))
          .select("_search_text", "_source", "_source_file", "_ingest_ts")
    )
    print(f"  claude_transcripts: {df.count()} rows")
except Exception as e:
    print(f"  claude_transcripts: not available yet ({e})")

# Union all tables into one searchable view
from functools import reduce

if tables:
    all_bronze = reduce(lambda a, b: a.unionByName(b), tables.values())
    all_bronze.createOrReplaceTempView("bronze_search")
    print(f"\n  Total searchable rows: {all_bronze.count()}")
    print(f"  Sources: {list(tables.keys())}")
else:
    print("ERROR: No Bronze tables found. Run 01-bronze-ingest first.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Search Function

# COMMAND ----------

def search_bronze(keyword, max_results=20):
    """Search all Bronze data for a keyword. Case-insensitive."""
    results = spark.sql(f"""
        SELECT 
            _source,
            _source_file,
            _ingest_ts,
            _search_text
        FROM bronze_search
        WHERE lower(_search_text) LIKE lower('%{keyword}%')
        LIMIT {max_results}
    """)
    
    count = results.count()
    print(f"\n🔍 Search: '{keyword}' → {count} results\n")
    
    if count == 0:
        print("  No results found.")
        return results
    
    for row in results.collect():
        source = row["_source"]
        source_file = row["_source_file"].split("/")[-1] if row["_source_file"] else "?"
        text = row["_search_text"]
        
        # Find keyword position and show context (100 chars around match)
        pos = text.lower().find(keyword.lower())
        if pos >= 0:
            start = max(0, pos - 80)
            end = min(len(text), pos + len(keyword) + 80)
            snippet = text[start:end].replace("\n", " ")
            if start > 0:
                snippet = "..." + snippet
            if end < len(text):
                snippet = snippet + "..."
        else:
            snippet = text[:160].replace("\n", " ") + "..."
        
        print(f"  [{source}] {source_file}")
        print(f"    {snippet}")
        print()
    
    return results

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Test Searches
# MAGIC These are the real questions that motivated the knowledge graph design.
# MAGIC Log which searches succeed, which fail, and what entity types would help.

# COMMAND ----------

# Test 1: The search that failed on March 20
# (We couldn't find all 3 Azure accounts — took 6 searches across 4 sources)
search_bronze("azure account")

# COMMAND ----------

search_bronze("david-uwa")

# COMMAND ----------

search_bronze("curtin.edu.au")

# COMMAND ----------

# Test 2: Can we find design decisions?
search_bronze("medallion")

# COMMAND ----------

search_bronze("delta lake")

# COMMAND ----------

# Test 3: Can we find project activity?
search_bronze("linkedin")

# COMMAND ----------

search_bronze("model_change")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Search Log — Track What Works and What Doesn't
# MAGIC 
# MAGIC Fill this in as you use the search. This becomes the input for
# MAGIC designing entity types (Task 5).
# MAGIC 
# MAGIC | Search query | Found? | Source | What entity type would help? |
# MAGIC |---|---|---|---|
# MAGIC | "azure account" | ? | ? | Account (name, email, credits, expiry) |
# MAGIC | "david-uwa" | ? | ? | Account |
# MAGIC | "medallion" | ? | ? | Decision (what, why, when) |
# MAGIC | "delta lake" | ? | ? | Tool/Service (name, purpose) |
# MAGIC | "linkedin" | ? | ? | Content (platform, date, status) |

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Interactive Search (SQL)
# MAGIC Change the keyword below and re-run to search for anything.

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Change the keyword and run this cell
# MAGIC SELECT 
# MAGIC     _source,
# MAGIC     substring(_source_file, -40) as file,
# MAGIC     substring(_search_text, 1, 200) as preview
# MAGIC FROM bronze_search
# MAGIC WHERE lower(_search_text) LIKE '%azure%'
# MAGIC LIMIT 20

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Source Statistics

# COMMAND ----------

# How much data do we have per source?
spark.sql("""
    SELECT 
        _source,
        count(*) as row_count,
        round(avg(length(_search_text)), 0) as avg_text_length,
        min(_ingest_ts) as earliest_ingest,
        max(_ingest_ts) as latest_ingest
    FROM bronze_search
    GROUP BY _source
    ORDER BY row_count DESC
""").show(truncate=40)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Done!
# MAGIC 
# MAGIC **Next steps:**
# MAGIC 1. Run real searches over 1-2 weeks (Task 5)
# MAGIC 2. Log every search that fails or returns too many results
# MAGIC 3. Identify entity types from search patterns
# MAGIC 4. Write `ENTITIES.md` with discovered types
# MAGIC 5. Then build Silver transform based on real findings
