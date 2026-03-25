# Databricks notebook source
# MAGIC %md
# MAGIC # 01 — Bronze Delta Table
# MAGIC Upload local JSONL to Unity Catalog volume, create Bronze Delta table.
# MAGIC
# MAGIC ## Prerequisites
# MAGIC 1. Run locally: `node mcp-server/scripts/export-for-databricks.mjs`
# MAGIC 2. Upload `~/.datacore/export/bronze-all.jsonl` to the volume

# COMMAND ----------

# MAGIC %sql
# MAGIC CREATE SCHEMA IF NOT EXISTS datacore;
# MAGIC CREATE VOLUME IF NOT EXISTS datacore.default.bronze_upload;

# COMMAND ----------

# Check uploaded file
volume_path = "/Volumes/datacore/default/bronze_upload"
try:
    files = dbutils.fs.ls(volume_path)
    for f in files:
        print(f"{f.name:40s} {f.size:>12,} bytes")
except Exception as e:
    print(f"Upload bronze-all.jsonl to {volume_path} first.")

# COMMAND ----------

from pyspark.sql.functions import current_timestamp, col

df = (spark.read
    .format("json")
    .option("multiLine", False)
    .load(f"{volume_path}/bronze-all.jsonl"))

print(f"Events loaded: {df.count()}")
df.printSchema()

# COMMAND ----------

df.select("event_id", "timestamp", "source", "type", "content").show(10, truncate=80)

# COMMAND ----------

# Write as managed Delta table
(df.write
    .format("delta")
    .mode("overwrite")
    .option("overwriteSchema", "true")
    .saveAsTable("datacore.default.bronze_events"))

print("Written to datacore.default.bronze_events")

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT source, count(*) as cnt FROM datacore.default.bronze_events GROUP BY source ORDER BY cnt DESC;

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT type, count(*) as cnt FROM datacore.default.bronze_events GROUP BY type ORDER BY cnt DESC LIMIT 15;

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT event_id, timestamp, source, type, LEFT(content, 200) as preview
# MAGIC FROM datacore.default.bronze_events WHERE source = 'claude.ai'
# MAGIC ORDER BY timestamp DESC LIMIT 10;

# COMMAND ----------

from delta.tables import DeltaTable
dt = DeltaTable.forName(spark, "datacore.default.bronze_events")
dt.history().select("version", "timestamp", "operation", "operationMetrics").show(truncate=40)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Done! Next: 02-vector-search.py
