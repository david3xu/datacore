# Databricks notebook source
# MAGIC %md
# MAGIC # Bronze Ingest — Raw Data into Delta Lake
# MAGIC 
# MAGIC > Phase 1, Task 3: Read raw files from ADLS Gen2 landing zone, write Bronze Delta tables.
# MAGIC > Storage: datacore3kcfne4phgzua | Container: landing/
# MAGIC > Sources: OpenClaw JSONL, Git commits JSON, Claude transcripts, project docs

# COMMAND ----------

# Configuration
STORAGE_ACCOUNT = "datacore3kcfne4phgzua"
LANDING_PATH = f"abfss://landing@{STORAGE_ACCOUNT}.dfs.core.windows.net"
BRONZE_PATH = f"abfss://datacore@{STORAGE_ACCOUNT}.dfs.core.windows.net/bronze"

# Storage access is configured at cluster level (spark_conf) — no manual key needed.
print(f"Landing zone: {LANDING_PATH}")
print(f"Bronze output: {BRONZE_PATH}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Explore the landing zone

# COMMAND ----------

# List what's in the landing zone
try:
    files = dbutils.fs.ls(LANDING_PATH)
    for f in files:
        print(f"{f.name:40s} {f.size:>10,} bytes")
except Exception as e:
    print(f"Cannot access landing zone: {e}")
    print("You may need to configure storage access — see next cell.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Ingest OpenClaw Sessions → Bronze

# COMMAND ----------

from pyspark.sql.functions import current_timestamp, input_file_name, lit, col

# Read all JSONL files from openclaw landing
openclaw_raw = (
    spark.read
    .format("json")
    .option("multiLine", False)  # JSONL = one JSON per line
    .load(f"{LANDING_PATH}/openclaw/*.jsonl")
)

# Add Bronze metadata columns
openclaw_bronze = (
    openclaw_raw
    .withColumn("_source", lit("openclaw"))
    .withColumn("_source_file", input_file_name())
    .withColumn("_ingest_ts", current_timestamp())
)

print(f"OpenClaw events: {openclaw_bronze.count()}")
openclaw_bronze.printSchema()

# COMMAND ----------

# Preview sample data
openclaw_bronze.select("type", "id", "timestamp", "_source", "_source_file").show(10, truncate=40)

# COMMAND ----------

# Write OpenClaw Bronze Delta table
(openclaw_bronze.write
    .format("delta")
    .mode("overwrite")
    .save(f"{BRONZE_PATH}/openclaw_events"))

print(f"✅ Written to {BRONZE_PATH}/openclaw_events")

# COMMAND ----------

# Verify: read back and check
df = spark.read.format("delta").load(f"{BRONZE_PATH}/openclaw_events")
print(f"Rows in Bronze: {df.count()}")
print(f"Columns: {df.columns}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Ingest Git Commits → Bronze

# COMMAND ----------

# Read git commits JSON (one JSON object per line)
git_raw = (
    spark.read
    .format("json")
    .option("multiLine", False)
    .load(f"{LANDING_PATH}/git/*.json")
)

# Add Bronze metadata
git_bronze = (
    git_raw
    .withColumn("_source", lit("git"))
    .withColumn("_source_file", input_file_name())
    .withColumn("_ingest_ts", current_timestamp())
)

print(f"Git commits: {git_bronze.count()}")
git_bronze.show(5, truncate=60)

# COMMAND ----------

# Write Git Bronze Delta table
(git_bronze.write
    .format("delta")
    .mode("overwrite")
    .save(f"{BRONZE_PATH}/git_commits"))

print(f"✅ Written to {BRONZE_PATH}/git_commits")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Ingest Project Docs → Bronze
# MAGIC Markdown files as raw text — each file becomes one row.

# COMMAND ----------

# Read markdown files as raw text
docs_raw = (
    spark.read
    .format("text")
    .option("wholetext", True)  # Entire file as one row
    .load(f"{LANDING_PATH}/docs/*.md")
)

docs_bronze = (
    docs_raw
    .withColumn("_source", lit("docs"))
    .withColumn("_source_file", input_file_name())
    .withColumn("_ingest_ts", current_timestamp())
)

print(f"Doc files: {docs_bronze.count()}")
docs_bronze.select("_source_file", "_ingest_ts").show(truncate=60)

# COMMAND ----------

# Write Docs Bronze Delta table
(docs_bronze.write
    .format("delta")
    .mode("overwrite")
    .save(f"{BRONZE_PATH}/project_docs"))

print(f"✅ Written to {BRONZE_PATH}/project_docs")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Ingest Claude Transcripts → Bronze (when available)
# MAGIC Export from claude.ai → Settings → Export data → place in landing/claude/

# COMMAND ----------

# Claude transcripts (run after exporting)
try:
    claude_raw = (
        spark.read
        .format("text")
        .option("wholetext", True)
        .load(f"{LANDING_PATH}/claude/*.txt")
    )
    claude_bronze = (
        claude_raw
        .withColumn("_source", lit("claude"))
        .withColumn("_source_file", input_file_name())
        .withColumn("_ingest_ts", current_timestamp())
    )
    (claude_bronze.write
        .format("delta")
        .mode("overwrite")
        .save(f"{BRONZE_PATH}/claude_transcripts"))
    print(f"✅ Claude transcripts: {claude_bronze.count()} files → {BRONZE_PATH}/claude_transcripts")
except Exception as e:
    print(f"⏭️ Claude transcripts not available yet: {e}")
    print("   Export from claude.ai → Settings → Export data")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Summary — What's in Bronze?

# COMMAND ----------

# List all Bronze Delta tables
print("=== Bronze Delta Tables ===\n")
for table in ["openclaw_events", "git_commits", "project_docs", "claude_transcripts"]:
    path = f"{BRONZE_PATH}/{table}"
    try:
        df = spark.read.format("delta").load(path)
        print(f"  {table:25s} {df.count():>8,} rows")
    except:
        print(f"  {table:25s}  (not yet created)")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. Inspect Delta Internals
# MAGIC Verify that Delta Lake is working: transaction log, history, file structure.

# COMMAND ----------

# Check Delta transaction history (proves ACID transactions work)
from delta.tables import DeltaTable

dt = DeltaTable.forPath(spark, f"{BRONZE_PATH}/openclaw_events")
dt.history().select("version", "timestamp", "operation", "operationMetrics").show(truncate=40)

# COMMAND ----------

# List the actual files (parquet + _delta_log/)
files = dbutils.fs.ls(f"{BRONZE_PATH}/openclaw_events")
for f in files:
    print(f"  {f.name:50s} {f.size:>10,} bytes")

# Check _delta_log contents
print("\n_delta_log/:")
log_files = dbutils.fs.ls(f"{BRONZE_PATH}/openclaw_events/_delta_log/")
for f in log_files:
    print(f"  {f.name:50s} {f.size:>10,} bytes")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Done!
# MAGIC Bronze layer is populated. Next: `02-bronze-search.py` — full-text search over Bronze.
