
Continue research. Search ONLY official Microsoft Learn and Databricks docs. Concrete answers with code examples.

ROUND 2 — Ingestion: How Data Gets In

Q4. How does Azure Data Factory ingest data from a REST API (like DEV.to or LinkedIn API) into a Delta Lake table? Show the pipeline definition — what does a Data Factory pipeline look like in JSON? What are the components (linked services, datasets, activities)?

Q5. How does Databricks Auto Loader work? If I have a folder where new JSONL files appear (like OpenClaw sessions), how does Auto Loader detect and ingest them incrementally? Show the actual PySpark code.

Q6. What does Structured Streaming look like in practice? If I want to process events as they arrive (not batch), show the PySpark code for reading from a source, transforming, and writing to a Delta table. How is this different from a batch job?
'

Q4 — Azure Data Factory ingesting REST API → Delta Lake (concrete pipeline JSON + components)

Conceptual pieces
- Linked service: connection details to the REST endpoint (base URL, authentication) and to the destination (Azure Data Lake Storage Gen2 / ADLS Gen2 or Azure Databricks).
- Dataset (source): describes data shape/format for REST responses (often JSON) and points at the linked service.
- Dataset (sink): ADLS Gen2/Blob dataset pointing at the container/path where Delta data will be stored (you can write parquet then convert to Delta or call Databricks notebook to write Delta directly).
- Pipeline: activities to call the REST source and persist results — common patterns:
  - Copy Activity (REST → ADLS Gen2) — writes JSON/parquet files to storage.
  - Web Activity + Azure Databricks Activity (call REST then pass to Databricks notebook if you need direct Delta writes).
- Trigger: schedule or event-based trigger for periodic ingestion.

Minimal working pipeline JSON (copy activity REST → ADLS Gen2 as newline-delimited JSON files)
- This example shows the pipeline definition portion (activities/linkedService/dataset definitions are in the ADF ARM JSON). You can export pipeline as JSON from ADF UI — the core is the Copy activity.

Pipeline (abridged, paste-ready JSON snippet):
{
  "name": "IngestFromRestToADLS",
  "properties": {
    "activities": [
      {
        "name": "CopyFromRestToADLS",
        "type": "Copy",
        "dependsOn": [],
        "policy": {},
        "userProperties": [],
        "typeProperties": {
          "source": {
            "type": "RestSource",
            "httpRequestTimeout": "00:01:00",
            "requestInterval": "00:00:05"
          },
          "sink": {
            "type": "AzureBlobFSink",
            "storeSettings": {
              "type": "AzureBlobFSWriteSettings",
              "maxConcurrentConnections": 5
            }
          }
        },
        "inputs": [
          {
            "referenceName": "RestApiDataset",
            "type": "DatasetReference"
          }
        ],
        "outputs": [
          {
            "referenceName": "AdlsGen2JsonDataset",
            "type": "DatasetReference"
          }
        ]
      }
    ],
    "annotations": []
  }
}

Key linked services & dataset examples (abridged)
1) Linked service (REST):
{
  "name": "AzureRestLinkedService",
  "properties": {
    "type": "RestService",
    "typeProperties": {
      "url": "https://dev.to/api",
      "enableServerCertificateValidation": true,
      "authenticationType": "Anonymous"
      // or "Basic"/"ServicePrincipal"/"ManagedIdentity" — include credentials in secure fields
    }
  }
}

2) Dataset (REST source):
{
  "name": "RestApiDataset",
  "properties": {
    "linkedServiceName": {
      "referenceName": "AzureRestLinkedService",
      "type": "LinkedServiceReference"
    },
    "type": "RestResource",
    "typeProperties": {
      "relativeUrl": "/articles",
      "requestMethod": "GET"
    },
    "annotations": []
  }
}

3) Linked service (ADLS Gen2):
{
  "name": "AdlsGen2LinkedService",
  "properties": {
    "type": "AzureBlobFS",
    "typeProperties": {
      "url": "https://<storageaccount>.dfs.core.windows.net",
      "authentication": "ManagedIdentity" // or service principal
    }
  }
}

4) Dataset (ADLS sink) — pointing at folder for JSON output:
{
  "name": "AdlsGen2JsonDataset",
  "properties": {
    "linkedServiceName": { "referenceName": "AdlsGen2LinkedService", "type": "LinkedServiceReference" },
    "type": "Json",
    "typeProperties": {
      "location": {
        "type": "AzureBlobFSLocation",
        "folderPath": "landing/devto/{{formatDateTime(utcnow(),'yyyy-MM-dd')}}"
      },
      "fileName": "devto_@utcnow().json",
      "collectionReference": null,
      "compression": null
    }
  }
}

Notes and practical patterns
- Pagination: REST connector supports pagination settings (nextLink, absoluteUrl, headers). Configure pagination rules in the REST dataset/linked service properties.
- Authentication: use managed identity or service principal for secure credentials. For OAuth flows (LinkedIn), use Web Activity to obtain token then pass token in Copy activity headers.
- Post-processing to Delta: ADF Copy writes raw JSON/JSONL to ADLS. Then use a Databricks Notebook activity (or Databricks Jobs) to read the raw JSON files and write them as a Delta table:
  - Databricks Job activity in pipeline calls a notebook that does:
    df = spark.read.json("abfss://container@account.dfs.core.windows.net/landing/devto/*")
    df.write.format("delta").mode("append").save("/mnt/delta/events")

References: ADF REST connector docs (learn.microsoft.com/azure/data-factory/connector-rest) and Copy activity docs show the JSON deployment format and supported source/sink types.

Q5 — Databricks Auto Loader (concrete PySpark code for incremental ingestion of new JSONL files)

Behavior summary
- Auto Loader (cloudFiles) watches a directory (cloud storage path) and incrementally discovers new files using a low-latency file notification mechanism (cloudFiles + cloudFiles.schemaLocation).
- It stores file processing state in a checkpoint (schemaLocation) to avoid reprocessing.
- Supports file notification services (Azure Event Grid) for near-real-time detection, or polling mode (listFiles) if event notifications are unavailable.
- Auto Loader can automatically infer schema and supports schema evolution (see options).

Example: ingest newline-delimited JSON (JSONL) files placed into an ADLS Gen2 path into a Delta table incrementally. This is production-style, runnable on Databricks.

Python (PySpark) — streaming ingestion with Auto Loader:
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

input_path = "abfss://container@account.dfs.core.windows.net/openclaw_sessions/"
checkpoint_path = "abfss://container@account.dfs.core.windows.net/_checkpoints/openclaw_autoloader/"
schema_location = "abfss://container@account.dfs.core.windows.net/_schema/openclaw_autoloader/"

df = (spark.readStream
      .format("cloudFiles")
      .option("cloudFiles.format", "json")                # json for JSONL or structured JSON
      .option("cloudFiles.schemaLocation", schema_location)
      .option("cloudFiles.inferColumnTypes", "true")     # optional: infer types
      .option("cloudFiles.useNotifications", "true")     # if using Event Grid notifications (recommended for low latency)
      .load(input_path)
     )

# Transform if needed
from pyspark.sql.functions import from_unixtime, col
df2 = df.select(
  col("session_id"),
  col("timestamp"),
  col("user"),
  col("event"),
  col("payload")
)

# Write incrementally to Delta (append)
(df2.writeStream
    .format("delta")
    .option("checkpointLocation", checkpoint_path)
    .outputMode("append")
    .option("mergeSchema", "true")   # allow schema evolution if new fields appear
    .start("/mnt/delta/openclaw_sessions")   # Delta table path
)

Important options explained
- cloudFiles.format: underlying file format (json, parquet, csv).
- cloudFiles.schemaLocation: location where Auto Loader stores discovered schema and file processing info.
- cloudFiles.useNotifications: set true and enable Event Grid notifications on ADLS for near-real-time file discovery (reduces list/polling).
- checkpointLocation: required for writeStream to track streaming progress; necessary for exactly-once semantics for streaming writes to Delta.
- mergeSchema: allows schema to be extended when new fields appear.

How Auto Loader detects files incrementally
- In notification mode: Databricks subscribes to storage events (Event Grid) to get file arrival notifications; Auto Loader then ingests new files quickly and atomically.
- In listing mode (useNotifications=false): Auto Loader periodically lists the directory and detects new files by comparing against its schemaLocation/checkpoint state — more latency and cost.
- Auto Loader maintains a file manifest (in the schemaLocation) to avoid re-processing.

Q6 — Structured Streaming in practice (concrete PySpark/Delta example)

Goal: process events as they arrive and write processed results to a Delta table in streaming fashion.

Example: read events from Kafka (common source), transform, and write to Delta sink. Use foreachBatch for micro-batch upserts or simple streaming append when appropriate.

PySpark (Structured Streaming) — read from Kafka → transform → upsert into Delta:
from pyspark.sql import SparkSession
from pyspark.sql.functions import from_json, col, to_timestamp
from delta.tables import DeltaTable

spark = SparkSession.builder.appName("events_stream").getOrCreate()

kafka_bootstrap = "kafka-broker:9092"
topic = "openclaw-events"

raw = (spark.readStream
       .format("kafka")
       .option("kafka.bootstrap.servers", kafka_bootstrap)
       .option("subscribe", topic)
       .option("startingOffsets", "latest")
       .load()
      )

# Assume value is JSON string
schema = "session_id STRING, timestamp LONG, user STRING, event STRING, payload STRING"
events = (raw.selectExpr("CAST(value AS STRING) as json_str")
             .select(from_json(col("json_str"), schema).alias("data"))
             .select("data.*")
             .withColumn("ts", to_timestamp((col("timestamp")/1000).cast("long")))
         )

# Example: write to Delta in append mode
(events.writeStream
   .format("delta")
   .option("checkpointLocation", "/mnt/delta/_checkpoints/events_stream_checkpoint")
   .outputMode("append")
   .start("/mnt/delta/events_stream")
)

Upsert pattern using foreachBatch (for idempotent upserts / dedupe)
def upsert_to_delta(batch_df, batch_id):
    target_path = "/mnt/delta/events_gold"
    # If table exists, do merge upsert; otherwise create
    if DeltaTable.isDeltaTable(spark, target_path):
        deltaTable = DeltaTable.forPath(spark, target_path)
        (deltaTable.alias("t")
          .merge(batch_df.alias("s"), "t.session_id = s.session_id AND t.ts = s.ts")
          .whenMatchedUpdateAll()
          .whenNotMatchedInsertAll()
          .execute()
        )
    else:
        batch_df.write.format("delta").mode("overwrite").save(target_path)

(events.writeStream
   .foreachBatch(upsert_to_delta)
   .option("checkpointLocation", "/mnt/delta/_checkpoints/events_foreach_checkpoint")
   .start()
)

How Structured Streaming differs from batch
- Streaming processes data incrementally using micro-batches (or continuous processing depending on engine). You set a checkpointLocation to maintain progress and ensure exactly-once processing in many sinks (Delta provides transactional guarantees).
- Batch reads the entire dataset (or a specified partition) and processes it once; batch writes overwrite/append but are not incremental in the same way.
- Streaming job stays running and continuously ingests new records; batch job is scheduled and runs to completion.
- Checkpointing: streaming requires checkpointing (checkpointLocation) to enable recovery and exactly-once semantics.
- Latency: streaming can produce low-latency results (depends on trigger interval), batch typically has higher latency (hours/daily).
- Use cases:
  - Streaming: near-real-time dashboards, stateful aggregations (sessionization), real-time enrichment.
  - Batch: full re-computation, heavy transforms that tolerate latency, backfills.

Practical notes & best practices
- Choose outputMode carefully: append / update / complete. For many event stores append is fine; for aggregations you may need update/complete.
- Use watermarking (withColumn + withWatermark) when doing aggregations over event time to bound state size.
- Use foreachBatch when you need to call idempotent merge/upsert logic into Delta (typical for slowly changing dimension writes).
- Ensure schema compatibility and use mergeSchema or schema evolution when necessary, but prefer explicit schema control in streaming to avoid surprises.
- Always set checkpointLocation for any writeStream and store it in durable storage (ADLS Gen2) so driver failures can be recovered.

References (official docs only)
- Azure Data Factory REST connector and Copy Activity: learn.microsoft.com/azure/data-factory/connector-rest and learn.microsoft.com/azure/data-factory/copy-activity-overview
- Databricks Auto Loader cloudFiles: docs.databricks.com/en/data-engineering/auto-loader/cloudfiles.html (shows cloudFiles options like schemaLocation, useNotifications)
- Structured Streaming in Apache Spark on Databricks: docs.databricks.com/en/data-engineering/streaming/structured-streaming.html and Delta Lake streaming writes: docs.databricks.com/en/delta/delta-streaming.html

If you want, I can:
- produce a complete ARM-template/ADF-pipeline JSON including linked services/datasets fully formed for a specific REST source (e.g., LinkedIn) with OAuth token retrieval pattern; or
- prepare a runnable Databricks notebook (PySpark) that configures Auto Loader (with Event Grid instructions for ADLS) and a streaming job that writes to delta with checkpointing and watermarking. Which would you like next?
