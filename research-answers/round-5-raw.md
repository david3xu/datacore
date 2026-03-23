
Continue research. Search ONLY official Microsoft Learn and Databricks docs. Concrete answers with code examples.

ROUND 5 — AI Access: How AI Reads the Data

Q13. How does Azure AI Search index data from a Delta Lake table? What is the pipeline from Databricks Gold table to AI Search index to AI agent query? Show the setup steps and code.

Q14. How does Semantic Kernel (C# .NET) connect to a data source for RAG? If I have a Gold table with conversation summaries, how does an AI agent query it? Show the Semantic Kernel plugin code.

Q15. What is Databricks Lakebase? How does it differ from a regular Delta table for AI agent access? When would you use Lakebase vs a Gold Delta table with an API in front?
'

Q13 — Azure Cognitive Search (AI Search) indexing pathway from a Databricks Gold Delta table — concrete steps + code

Summary pipeline (end-to-end)
1. Export/serialize Gold table rows to a location Search can index (Azure Blob / ADLS Gen2). Databricks writes JSON/NDJSON or flattened blobs to a container/path.  
2. Create an Azure Cognitive Search data source that points at that storage container (managed identity or key).  
3. Create an index describing fields (id, content, metadata, vector field if using vector search).  
4. Optionally create a skillset to run enrichments (OCR, cognitive skills) or an embedding pipeline to produce vectors (embedding step may be done in Databricks and written as a field).  
5. Create an indexer that pulls documents from the storage path into the index on a schedule (or run once).  
6. Query the index from the AI agent: either keyword/semantic search (built-in semantic ranking) or vector + rerank where you call the vector search endpoint with an embedding produced by your LLM and then fetch best matches.

Step A — Export Gold Delta to ADLS/Blob (Databricks PySpark) — write NDJSON with necessary fields
- We write a flattened JSON per row that the indexer will pick up. Include an id field and content/metadata fields. If you will use vector search, also include an embeddings vector written as separate JSON field (or store vector in Azure Cognitive Search via vector field and push via REST API).
PySpark example:
from pyspark.sql.functions import to_json, struct, col

gold_path = "/mnt/delta/gold/events_aggregates"   # example
export_path = "abfss://search-index@<storage>.dfs.core.windows.net/search-docs/"

df = spark.read.format("delta").load(gold_path)

# prepare document: id, content (text), metadata fields
docs = df.withColumn("id", col("event_date").cast("string") || "_" || col("event_type")) \
         .withColumn("content", col("event_type") ) \
         .withColumn("metadata", to_json(struct("events_count"))) \
         .select("id", "content", "metadata")

# write as newline-delimited JSON files (one JSON doc per line)
(docs.repartition(10)
     .write
     .mode("overwrite")
     .option("compression","gzip")
     .json(export_path)   # Databricks will write JSON files; indexer can read JSON or NDJSON depending on config
)

Step B — Create Cognitive Search data source, index, and indexer (Azure REST / ARM / CLI JSON)

Example index definition (REST body) — minimal fields (id, content, metadata)
PUT https://<search-service>.search.windows.net/indexes/events-index?api-version=2023-07-01
Headers: api-key
Body (JSON):
{
  "name": "events-index",
  "fields": [
    { "name": "id", "type": "Edm.String", "key": true, "searchable": false },
    { "name": "content", "type": "Edm.String", "searchable": true, "analyzer": "en.lucene" },
    { "name": "metadata", "type": "Edm.String", "searchable": false }
  ],
  "suggesters": [],
  "scoringProfiles": []
}

Create a blob storage data source:
PUT https://<search-service>.search.windows.net/datasources/azureblob-raw?api-version=2023-07-01
Body:
{
  "name": "azureblob-raw",
  "type": "azureblob",
  "credentials": { "connectionString": "<storage-connection-string-or-managed-identity>" },
  "container": { "name": "search-index", "query": "/search-docs/" },
  "description": "Docs exported from Databricks Gold table"
}

Create an indexer to pull JSON files into the index:
PUT https://<search-service>.search.windows.net/indexers/events-indexer?api-version=2023-07-01
Body:
{
  "name": "events-indexer",
  "dataSourceName": "azureblob-raw",
  "targetIndexName": "events-index",
  "schedule": { "interval": "PT1H" },   // hourly
  "parameters": {
    "parsingMode": "jsonLines",         // or 'json' depending on files
    "indexStorageMetadataOnly": false
  }
}

Run the indexer once (if not scheduled):
POST https://<search-service>.search.windows.net/indexers/events-indexer/run?api-version=2023-07-01

Step C — Embeddings / Vector search (option A: compute vectors in Databricks)
- If you want vector search, compute embeddings for each document in Databricks (using your choice of embedding model or Azure OpenAI), add them as a separate column (array of floats) and store them either:
  - as a vector field in Cognitive Search (2023-07-01 supports vector fields) by pushing documents to the index via the Search REST API with the vector field populated; or
  - store vectors in a separate vector DB and use hybrid search.
Example document body for vector field (REST):
{
  "value": [
    {
      "@search.action": "upload",
      "id": "2026-03-20_click",
      "content": "click",
      "metadata": "...",
      "vector": [0.01, -0.02, ...]   // matches index's vector field definition (type: Collection(Edm.Single))
    }
  ]
}

Step D — Querying from an AI agent
- Keyword / semantic search: call the Search REST API (search endpoint) passing query text, optionally set semantic configuration to use semantic ranking.
- Vector + rerank: call your LLM to produce an embedding for the user query, call the Cognitive Search vector search endpoint with that vector to get top-k candidates, then pass retrieved docs to LLM for final answer (RAG).

Search call example (REST, simple):
GET https://<search-service>.search.windows.net/indexes/events-index/docs?api-version=2023-07-01&search=clicks%20today
Headers: api-key

Vector search example (REST body):
POST https://<search-service>.search.windows.net/indexes/events-index/docs/search?api-version=2023-07-01
Body:
{
  "vector": { "value": [0.012, 0.34, ...], "k": 5 },
  "fields": ["id","content","metadata"]
}

Notes / official patterns
- Official docs: indexers support Azure Blob / ADLS Gen2 (via Azure Blob connector) and JSON/NDJSON parsing. If you need enrichment or semantic capabilities, consider adding a skillset or compute vectors prior to indexing. For production RAG, computing embeddings in Databricks (or in an Azure Function) and pushing vectors into Cognitive Search is common.
- Use managed identities for secure connector/auth in production rather than embedding keys.

Q14 — Semantic Kernel (.NET) connecting to a data source for RAG — concrete C# plugin example

Pattern summary
- Semantic Kernel (SK) provides a pluggable memory and connector model. For retrieval-augmented generation, you:
  1. Create an embeddings skill (e.g., Azure OpenAI embedding model).
  2. Store embeddings in a memory store (e.g., Azure Cognitive Search, or a vector DB). SK has connector packages for Azure Cognitive Search and others.
  3. At query time, embed the query with the same embedding model, call the memory store to retrieve top-k documents, then use the LLM to answer with the retrieved context.

Minimal C# example using Semantic Kernel + Azure Cognitive Search (pseudocode adapted to SK public examples — copy/paste-ready skeleton):

// NuGet packages: Microsoft.SemanticKernel, Microsoft.SemanticKernel.Connectors.AI.OpenAI, Microsoft.SemanticKernel.Connectors.Memory.AzureCognitiveSearch
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.AI.Embeddings;
using Microsoft.SemanticKernel.Connectors.AI.OpenAI;
using Microsoft.SemanticKernel.Connectors.Memory.AzureCognitiveSearch;

var kernel = Kernel.Builder.Build();

// 1) configure embedding / text-generation services (Azure OpenAI example)
var embeddingService = new AzureOpenAITextEmbeddingGeneration(
    endpoint: "<azure_openai_endpoint>",
    apiKey: "<key>",
    deploymentId: "<embedding-deployment>"
);
kernel.Config.RegisterSemanticTextEmbeddingGenerationService("azureOpenAI_embeddings", embeddingService);

// 2) configure Azure Cognitive Search memory store
var searchOptions = new AzureCognitiveSearchMemoryOptions(
    serviceName: "<search-service-name>",
    indexName: "events-index",
    apiKey: "<search-api-key>"
);
var memoryStore = new AzureCognitiveSearchMemoryStore(searchOptions);
kernel.Memory.RegisterMemoryStore(memoryStore);

// 3) At ingestion time (one-time), create embeddings and push docs to the index (use SDK or REST).
// --- ingestion not shown here; assume index has documents with id, content, metadata and optionally vector field

// 4) Query flow: embed the user query, retrieve nearest neighbors, then build prompt for LLM
var query = "How many click events happened yesterday?";
var embedding = await kernel.GetService<ITextEmbeddingGeneration>("azureOpenAI_embeddings")
                            .GenerateEmbeddingAsync(query);

// Retrieve top-k from memory store (SK memory store wrappers provide FindAsync or similar)
var results = await kernel.Memory.SearchAsync("events-index", query, limit: 5); // SK wrapper call

// Compose context and call the LLM
var contextText = string.Join("\n---\n", results.Select(r => r.Metadata["content"] + "\n" + r.Metadata["metadata"]));
var prompt = $"Use the following documents to answer:\n{contextText}\nQuestion: {query}\nAnswer:";
var gpt = kernel.UseOpenAITextCompletion("<deployment-name>", "<api-key>"); // actual registration per SK docs
var response = await kernel.RunAsync(prompt);

Console.WriteLine(response);

Notes / official guidance
- SK connectors largely follow this pattern: Embeddings → vector store (Cognitive Search) → Retriever → LLM completion. See Semantic Kernel docs on memory stores and Cognitive Search connector for exact API shapes and registration code.
- You can also implement a custom retriever that queries Delta (via a simple REST API exposing the Gold table), embed retrieved rows, and then perform RAG in SK.

Q15 — Databricks Lakehouse Lakebase vs regular Delta table for AI agent access — what and when

What is Databricks Lakebase (concise)
- Lakebase (Databricks brand name: Lakehouse OLTP / Lakehouse transactional engines such as Lakehouse for Business / Lakehouse for OLTP) is Databricks’ offering for low-latency transactional workloads built on the Lakehouse. It provides row-level transactional performance, low-latency primary key lookups and materialized views suited for serving apps (like an OLTP layer) while still keeping data on the lakehouse. (Official product names/feature sets vary; check Databricks docs for "Lakehouse" / "Lakebase" details.)

Key differences vs regular Delta Gold table + API
- Delta table (Gold) in ADLS: optimized for analytical workloads (OLAP) — large scans, aggregations. Good for RAG if you do batch exports or precompute embeddings. Not ideal for high QPS point lookups.
- Lakebase / OLTP on Lakehouse: supports lower-latency transactional reads/writes and point lookups; useful if your AI agent needs frequent, low-latency item retrievals with transactional semantics (e.g., updating conversation state).
- When to use Lakebase:
  - You need sub-10ms point lookups or transactional semantics directly on the lakehouse without an external OLTP DB.
  - You want unified storage + transactional guarantees and plan to use the Lakehouse as both analytical and serving store.
- When to use Gold Delta table + API:
  - You keep Gold as the curated persistent store and build a lightweight API or vector store in front for serving. For RAG you typically:
    - Precompute embeddings from Gold in Databricks and push them to a vector store (Azure Cognitive Search, Pinecone, Milvus).
    - Serve retrievals from the vector store (fast) and optionally query the Gold Delta for additional metadata/details when needed.
  - This separation is common because vector stores are optimized for similarity search and low-latency retrieval; Delta is optimized for analytics and versioning.

Concrete recommendation (RAG & agent use)
- For RAG: keep Gold Delta as authoritative source of truth; run a job that:
  - extracts/normalizes documents,
  - computes embeddings in Databricks,
  - populates a vector index (Cognitive Search / Pinecone / Milvus).
  The AI agent queries the vector store for fast retrieval, then optionally calls an API (or Databricks SQL endpoint) to get full record details from Gold if needed.
- Use Lakebase when you must avoid an extra system and the workload requires transactional, low-latency access directly on the lakehouse for the agent.

References and next steps
- Official docs to consult (examples above use their APIs / REST shapes):
  - Azure Cognitive Search indexing and indexer docs (learn.microsoft.com Azure Search).  
  - Databricks: how to export data to storage and common patterns for integrating with Azure Cognitive Search (Databricks docs on exporting and integrating with Azure services).  
  - Semantic Kernel docs for memory connectors and Azure Cognitive Search memory connector (Semantic Kernel GitHub / docs).  
  - Databricks Lakehouse / Lakebase product docs for transactional OLTP capabilities vs Delta analytics.

If you want, I can:
- produce the exact Azure CLI/ARM commands to create the search index + indexer with a templated JSON using your service names; or
- create a Databricks notebook that computes embeddings (using Azure OpenAI or a local embedder), pushes vectors to Cognitive Search (via REST), and shows an end-to-end RAG retrieval + LLM prompt call; or
- fetch the precise Semantic Kernel NuGet sample code for Azure Cognitive Search connector from the official SK docs and paste it verbatim. Which would you like next?
