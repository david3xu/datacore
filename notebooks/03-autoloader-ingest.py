# Databricks notebook source
# MAGIC %md
# MAGIC # 03 — Auto Loader Ingestion
# MAGIC Incrementally ingest new JSONL files from ADLS Gen2 landing zone.
# MAGIC Uses `cloudFiles` (Auto Loader) with `trigger(availableNow=True)`.
# MAGIC Only processes files not seen before (checkpoint-based).
# MAGIC
# MAGIC Designed to run as a scheduled Databricks Job.

# COMMAND ----------

# Configuration
STORAGE_ACCOUNT = "datacore3kcfne4phgzua"
LANDING_PATH = f"abfss://landing@{STORAGE_ACCOUNT}.dfs.core.windows.net/bronze"
TABLE = "datacore_databricks.datacore.bronze_events"
CHECKPOINT = f"abfss://datacore@{STORAGE_ACCOUNT}.dfs.core.windows.net/_checkpoints/autoloader_bronze"

print(f"Source:     {LANDING_PATH}")
print(f"Target:     {TABLE}")
print(f"Checkpoint: {CHECKPOINT}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Auto Loader: Incremental Ingest

# COMMAND ----------

from pyspark.sql.functions import current_timestamp

# Auto Loader reads JSONL from landing zone
# Checkpoint tracks which files have been processed
# trigger(availableNow=True) processes all new files then stops

query = (
    spark.readStream
    .format("cloudFiles")
    .option("cloudFiles.format", "json")
    .option("cloudFiles.schemaLocation", CHECKPOINT)
    .option("cloudFiles.inferColumnTypes", "true")
    .load(LANDING_PATH)
    .withColumn("_ingest_ts", current_timestamp())
    .writeStream
    .format("delta")
    .option("checkpointLocation", CHECKPOINT)
    .option("mergeSchema", "true")
    .trigger(availableNow=True)
    .toTable(TABLE)
)

# Wait for the stream to finish processing
query.awaitTermination()
print(f"Auto Loader finished. New files ingested.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Verify + enable CDF + trigger Vector Search sync

# COMMAND ----------

# Ensure CDF is on (idempotent)
spark.sql(f"ALTER TABLE {TABLE} SET TBLPROPERTIES (delta.enableChangeDataFeed = true)")

# Count
total = spark.sql(f"SELECT count(*) as n FROM {TABLE}").collect()[0]["n"]
by_source = spark.sql(f"""
    SELECT source, count(*) as cnt FROM {TABLE}
    GROUP BY source ORDER BY cnt DESC
""").collect()

print(f"Total events: {total}")
for row in by_source:
    print(f"  {row['source']:30s} {row['cnt']:6d}")

# COMMAND ----------

# Trigger Vector Search sync
from databricks.sdk import WorkspaceClient

INDEX = "datacore_databricks.datacore.bronze_events_index"
w = WorkspaceClient()

try:
    w.vector_search_indexes.sync_index(index_name=INDEX)
    print(f"Vector Search sync triggered for {INDEX}")
except Exception as e:
    print(f"Sync trigger: {e}")
    print("Index may auto-sync on next query.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Done!
# MAGIC Auto Loader ingested new files. Vector Search sync triggered.
# MAGIC This notebook is designed to run as a scheduled Databricks Job.
