# Databricks notebook source
# MAGIC %md
# MAGIC # 02 — Vector Search Index
# MAGIC Create semantic search over Bronze events using Mosaic AI Vector Search.
# MAGIC Delta Sync Index with Databricks-managed embeddings (gte-large-en).
# MAGIC
# MAGIC ## Prerequisites
# MAGIC - `datacore.default.bronze_events` Delta table exists (run 01 first)

# COMMAND ----------

# MAGIC %sql
# MAGIC ALTER TABLE datacore.default.bronze_events SET TBLPROPERTIES (delta.enableChangeDataFeed = true);

# COMMAND ----------

# Verify CDF enabled
props = spark.sql("SHOW TBLPROPERTIES datacore.default.bronze_events").collect()
for row in props:
    if 'change' in row.key.lower():
        print(f"{row.key} = {row.value}")

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT count(*) as embeddable_events FROM datacore.default.bronze_events
# MAGIC WHERE content IS NOT NULL AND LENGTH(content) > 50;

# COMMAND ----------

# MAGIC %md
# MAGIC ## Create Vector Search Endpoint

# COMMAND ----------

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
ENDPOINT_NAME = "datacore-search"

try:
    w.vector_search_endpoints.create_endpoint(
        name=ENDPOINT_NAME, endpoint_type="STANDARD")
    print(f"Created endpoint: {ENDPOINT_NAME}")
except Exception as e:
    if "already exists" in str(e).lower():
        print(f"Endpoint {ENDPOINT_NAME} already exists")
    else:
        raise

w.vector_search_endpoints.wait_get_endpoint_vector_search_endpoint_online(ENDPOINT_NAME)
print(f"Endpoint {ENDPOINT_NAME} is ONLINE")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Create Delta Sync Index with managed embeddings

# COMMAND ----------

INDEX_NAME = "datacore.default.bronze_events_index"
SOURCE_TABLE = "datacore.default.bronze_events"
EMBEDDING_MODEL = "databricks-gte-large-en"

try:
    w.vector_search_indexes.create_index(
        name=INDEX_NAME,
        endpoint_name=ENDPOINT_NAME,
        primary_key="event_id",
        index_type="DELTA_SYNC",
        delta_sync_index_spec={
            "source_table": SOURCE_TABLE,
            "embedding_source_columns": [
                {"name": "content", "embedding_model_endpoint_name": EMBEDDING_MODEL}
            ],
            "pipeline_type": "TRIGGERED",
            "columns_to_sync": ["event_id", "timestamp", "source", "type", "content", "context_json"],
        },
    )
    print(f"Created index: {INDEX_NAME}")
except Exception as e:
    if "already exists" in str(e).lower():
        print(f"Index {INDEX_NAME} already exists")
    else:
        raise

# COMMAND ----------

# MAGIC %md
# MAGIC ## Trigger index sync

# COMMAND ----------

w.vector_search_indexes.sync_index(index_name=INDEX_NAME)
print("Sync triggered. Waiting...")

import time
for i in range(60):
    status = w.vector_search_indexes.get_index(index_name=INDEX_NAME)
    if status.status.ready:
        print(f"Index READY after {(i+1)*10}s")
        break
    print(f"  Syncing... ({(i+1)*10}s)")
    time.sleep(10)
else:
    print("Still syncing after 10 min. Check status manually.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Test semantic search

# COMMAND ----------

results = w.vector_search_indexes.query_index(
    index_name=INDEX_NAME,
    columns=["event_id", "source", "type", "content", "timestamp"],
    query_text="architecture decisions",
    num_results=5,
)

print("=== Semantic: 'architecture decisions' ===\n")
for doc in results.result.data_array:
    print(f"[{doc[1]}/{doc[2]}] {doc[4]}")
    print(f"  {doc[3][:200]}\n")

# COMMAND ----------

# Hybrid search (keyword + semantic)
results = w.vector_search_indexes.query_index(
    index_name=INDEX_NAME,
    columns=["source", "type", "content"],
    query_text="MCP server",
    num_results=5,
    query_type="HYBRID",
)

print("=== Hybrid: 'MCP server' ===\n")
for doc in results.result.data_array:
    print(f"[{doc[0]}/{doc[1]}] {doc[2][:200]}\n")

# COMMAND ----------

# MAGIC %md
# MAGIC ## REST API details for MCP tool

# COMMAND ----------

workspace_url = spark.conf.get("spark.databricks.workspaceUrl")
print(f"Workspace URL:  https://{workspace_url}")
print(f"Endpoint:       {ENDPOINT_NAME}")
print(f"Index:          {INDEX_NAME}")
print(f"")
print(f"REST API:")
print(f"  POST https://{workspace_url}/api/2.0/vector-search/indexes/{INDEX_NAME}/query")
print(f"  Authorization: Bearer <PAT_TOKEN>")
print(f"  Body: {{\"columns\": [...], \"query_text\": \"...\", \"num_results\": 5}}")
print(f"")
print(f"Set in ~/.zshrc:")
print(f'  export DATABRICKS_HOST="https://{workspace_url}"')
print(f'  export DATABRICKS_TOKEN="dapi..."')

# COMMAND ----------

# MAGIC %md
# MAGIC ## Done! Add `deep_search` MCP tool to local server.

# COMMAND ----------

# MAGIC %md
# MAGIC ## Trigger sync and wait

# COMMAND ----------

import time

w.vector_search_indexes.sync_index(index_name=INDEX_NAME)
print("Sync triggered. Waiting...")

for i in range(60):
    status = w.vector_search_indexes.get_index(index_name=INDEX_NAME)
    if status.status.ready:
        print(f"Index READY after {(i+1)*10}s")
        break
    print(f"  Syncing... ({(i+1)*10}s)")
    time.sleep(10)
else:
    print("Still syncing after 10 min. Check manually.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Test semantic search

# COMMAND ----------

results = w.vector_search_indexes.query_index(
    index_name=INDEX_NAME,
    columns=["event_id", "source", "type", "content", "timestamp"],
    query_text="what architecture decisions were made?",
    num_results=5,
)

print("=== Semantic: 'architecture decisions' ===\n")
for doc in results.result.data_array:
    print(f"[{doc[1]}/{doc[2]}] {doc[4]}")
    print(f"  {doc[3][:200]}\n")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Test hybrid search (keyword + semantic)

# COMMAND ----------

test_queries = [
    "MCP server tools",
    "TypeScript migration",
    "cost budget Azure credits",
    "medallion pattern bronze silver gold",
]

for q in test_queries:
    r = w.vector_search_indexes.query_index(
        index_name=INDEX_NAME,
        columns=["source", "type", "content"],
        query_text=q, num_results=3, query_type="HYBRID",
    )
    print(f"\n=== '{q}' ===")
    for doc in r.result.data_array:
        print(f"  [{doc[0]}/{doc[1]}] {doc[2][:150]}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## REST API details for MCP tool

# COMMAND ----------

workspace_url = spark.conf.get("spark.databricks.workspaceUrl")
print(f"Workspace URL:  https://{workspace_url}")
print(f"Endpoint:       {ENDPOINT_NAME}")
print(f"Index:          {INDEX_NAME}")
print()
print("REST API call from local MCP server:")
print(f"  POST https://{workspace_url}/api/2.0/vector-search/indexes/{INDEX_NAME}/query")
print(f"  Headers: Authorization: Bearer <PAT_TOKEN>")
print(f'  Body: {{"columns": [...], "query_text": "...", "num_results": 5}}')
print()
print("Environment variables to set in ~/.zshrc:")
print(f'  export DATABRICKS_HOST="https://{workspace_url}"')
print(f'  export DATABRICKS_TOKEN="dapi..."  # Generate in User Settings > Developer')

# COMMAND ----------

# MAGIC %md
# MAGIC ## Done! Next: add `deep_search` MCP tool to local server.
