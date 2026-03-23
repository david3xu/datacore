# Research Areas

> 5 open questions before Silver/Gold implementation.
> Discover answers from real usage, not upfront design.

## 1. Embeddings (Silver)

Which embedding model turns Bronze events into vectors for semantic search?

Options: OpenAI text-embedding-3, local model via Ollama, Databricks Mosaic AI.
Key question: local (free, private) vs API (better quality, costs money)?

## 2. Entity types (Silver)

What entities matter? We can't design extraction without knowing what to extract.

Approach: USE Bronze search for 1-2 weeks. When a search fails or returns
too much noise, that failure reveals what entity type is missing.
Discovered so far: Account, Project, Decision, Tool/Service.

## 3. Fact curation (Gold)

How does an AI decide "this is a fact worth caching" vs noise?

The session-memory hook tried this (dump 15 messages) — too blunt.
Gold facts should be answers to questions that keep recurring.
Research: look at how RAG systems and knowledge bases handle curation.

## 4. Graph database (Gold)

Where do knowledge graph entities live?

Options: Cosmos DB Gremlin (free tier), Databricks graph tables, local SQLite.
Deferred until we have enough entities to justify a graph.

## 5. Query routing (Gold)

How does search() decide Gold vs Silver vs Bronze?

Simple version: try Gold first, fall back to Silver, then Bronze.
Research: look at how layered search / cascading retrieval works in practice.

---

See `data-architecture-complete.svg` for where each area fits in the pipeline.
See `DESIGN.md` for the full architecture context.
