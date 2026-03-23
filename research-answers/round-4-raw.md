
Continue research. Search ONLY official Microsoft Learn and Databricks docs. Concrete answers with code examples.

ROUND 4 — Governance: How Data Stays Trustworthy

Q10. What does Unity Catalog actually do? How do you set it up? Show the commands to create a catalog, schema, and table with access controls. How does lineage tracking work — if I query a Gold table, can I trace back to which Bronze sources fed it?

Q11. How does Azure Purview compare to Unity Catalog? When do you use which? If I am on Azure Databricks, do I need both?

Q12. What are data quality checks in practice? Show how to define expectations like "timestamp must not be null" and "source must be one of [openclaw, claude, git, linkedin]" using DLT expectations or Delta constraints. What happens when a record fails?
'

Q10 — Unity Catalog: what it does, how to set up, commands, and lineage tracing

What Unity Catalog provides (short)
- Central, fine‑grained governance for Databricks: catalogs → schemas (databases) → tables/views, with unified identity-based access controls (GRANTs) across workspaces and SQL/REST visibility.
- Object‑level access control (catalog/schema/table/column/volume), centralized metastore, and built‑in data lineage and audit (query history & lineage graph).
- Integrates with cloud storage: tables can map to Delta locations on ADLS/ S3 / GCS but Unity Catalog stores metadata & ACLs centrally.

Minimal setup & example SQL (Databricks SQL / SQL notebook)
- Precondition: Unity Catalog enabled for your workspace and your metastore created (done in admin console). Then use SQL or REST to create catalogs/schemas/tables.

1) Create a catalog
-- run as a metastore admin
CREATE CATALOG IF NOT EXISTS my_catalog;

2) Create a schema (database) in that catalog and grant ownership
CREATE SCHEMA IF NOT EXISTS my_catalog.sales
COMMENT 'Sales data for analytics';

-- give a principal permission to use catalog & create objects
GRANT USAGE ON CATALOG my_catalog TO `account_users`;
GRANT CREATE ON SCHEMA my_catalog.sales TO `data_engineer_role`;

3) Create a managed Delta table in the schema
-- this creates metadata in Unity Catalog and data files at the table location
CREATE TABLE my_catalog.sales.orders (
  order_id STRING,
  customer_id STRING,
  order_ts TIMESTAMP,
  amount DOUBLE
)
USING DELTA
COMMENT 'Orders (gold)';

4) Or create an external table pointing at an existing Delta path
CREATE TABLE my_catalog.sales.events
USING DELTA
LOCATION 'abfss://raw@myaccount.dfs.core.windows.net/delta/bronze/events';

5) Grant fine‑grained access (column/row-level available via Unity Catalog features)
GRANT SELECT ON TABLE my_catalog.sales.orders TO `analyst_role`;
GRANT SELECT ON COLUMN my_catalog.sales.orders(order_id) TO `etl_service`;

6) Inspect table metadata and history (useful for tracing)
-- show table metadata (registered location, owner, comment)
DESCRIBE DETAIL my_catalog.sales.orders;

-- show transaction history (versioned log — maps to _delta_log)
DESCRIBE HISTORY my_catalog.sales.orders;   -- returns versions, operation, userId, timestamp

Lineage & tracing
- Unity Catalog stores lineage produced by Databricks jobs/pipeline engines and captures query lineage (table→table and table→file relationships) when jobs run on Databricks with Unity Catalog enabled.
- How to trace:
  - Use the Unity Catalog Lineage UI in Databricks to view upstream/downstream lineage (visual graph) for a table.
  - Programmatically: query the Unity Catalog Lineage REST API (or the Unity Catalog Experience in Databricks) to retrieve lineage edges.
  - Use DESCRIBE HISTORY to see which operations (notebook/job) wrote which table versions; each DESCRIBE HISTORY entry shows the commitInfo (user, operation, jobId) so you can map a Gold row back to the Bronze write transactions and their source file paths (the transaction log includes AddFile entries).
- Practical trace steps (SQL + file inspection):
  1. DESCRIBE HISTORY my_catalog.sales.gold_table LIMIT 10; note version N and commitInfo.
  2. Use DESCRIBE DETAIL or read the transaction log for version N to see AddFile/RemoveFile entries (these point to parquet files in the Bronze path).
     - Example: spark.read.format("delta").option("versionAsOf", N).load("/mnt/delta/gold/...") — inspect provenance, or examine _delta_log/0000000000000000000N.json
  3. Use Unity Catalog Lineage UI to show the graph from gold_table → silver_table → bronze_table → source files.

References (Databricks docs): Unity Catalog concepts, GRANT syntax, DESCRIBE HISTORY / DESCRIBE DETAIL and the Lineage UI.

Q11 — Azure Purview vs Unity Catalog (concise, when to use which, do you need both)

What Azure Purview (Microsoft Purview) is
- Enterprise data governance, discovery, classification, and cataloging across many Azure and non‑Azure systems (ADLS, Synapse, SQL, Power BI, SaaS sources). Purview scans sources, extracts metadata, builds a searchable catalog, applies classification & sensitive-data labels, and provides cross‑system lineage.

What Unity Catalog is
- Databricks‑native governance & metastore focused on Databricks tables, workloads, and Delta tables with enforcement of fine‑grained access control and Databricks lineage. Unity Catalog is operational (ACL enforcement at query time) as well as metadata management for Databricks.

When to use each
- Use Unity Catalog when:
  - You need centralized access controls, table/column ACL enforcement, and lineage/metadata for Databricks-managed data (Delta).
  - You want the Databricks-native catalog that enforces access at query time and supports Unity Catalog features (sharing, Delta Sharing integration).
- Use Microsoft Purview when:
  - You need an organization‑wide data catalog that covers many systems beyond Databricks (Azure SQL, Synapse, on‑prem, SaaS).
  - You need automated data classification, sensitive data discovery, policy-driven classification and enterprise compliance reports.
- Do you need both on Azure Databricks?
  - Common pattern: run Unity Catalog for Databricks governance/enforcement and also register/ingest Unity Catalog metadata into Purview (or connect the two) for enterprise-wide discovery and compliance. Purview gives a single pane for non‑Databricks systems and enterprise policies; Unity Catalog enforces access and serves as the Databricks metastore.
  - You do not strictly need Purview if your governance scope is only Databricks and small, but for enterprise compliance and cross‑service lineage you typically deploy Purview in addition to Unity Catalog.

Concrete interoperability note
- Databricks can export or integrate metadata so Purview can index Databricks assets, enabling combined lineage & cataloging across the enterprise (check Purview connectors for Databricks / Azure Databricks metastore ingestion in Microsoft docs).

Q12 — Data quality checks in practice (DLT expectations, Delta constraints, behavior when records fail)

Options for defining data quality in Databricks:
1) Delta Live Tables (DLT) expectations — declarative, pipeline-level checks with configurable behavior (metrics, drop, quarantine, or fail).
2) Delta table constraints (CHECK constraints) — enforced at write time by Delta (write fails if constraint violated).
3) Custom validations in ETL (PySpark/SQL) — drop/flag/break pipeline as desired.

A — DLT expectations (example Python DLT)
- dlt.expect registers an expectation (rule) and collects metrics; you can choose to drop failing rows or have the pipeline fail depending on pipeline configuration.

Example DLT notebook code:
import dlt
from pyspark.sql.functions import col

@dlt.table
@dlt.expect("timestamp_not_null", "timestamp IS NOT NULL")
@dlt.expect("source_allowed", "source IN ('openclaw','claude','git','linkedin')")
def silver_events():
    df = dlt.read("bronze_raw")
    # optional: use expect_or_drop to drop failing rows immediately
    df = dlt.expect_or_drop(df, "timestamp_not_null")
    return df.selectExpr("id as event_id", "timestamp", "source", "content", "actor", "event_type")

Behavior:
- dlt.expect: records the metric (number and fraction of passing rows) in DLT pipeline monitoring. By default it does not drop rows; it lets you view the results. You can pair with dlt.expect_or_drop to drop failing rows.
- Pipeline policy: DLT pipeline settings let you fail the pipeline on threshold breaches, or route failing rows to a quarantine table for investigation.
- DLT stores expectation metrics in pipeline UI and exposes them via REST / monitoring.

B — Delta CHECK constraints (example SQL)
- Delta supports CHECK constraints declared on tables. If a write violates a CHECK constraint, the write fails (enforced).

Create table with constraints example:
CREATE TABLE my_catalog.sales.events (
  event_id STRING,
  timestamp TIMESTAMP,
  source STRING,
  content STRING
)
USING DELTA
TBLPROPERTIES ()
-- Add a constraint: timestamp not null and allowed source values
ALTER TABLE my_catalog.sales.events
ADD CONSTRAINT ck_timestamp_not_null CHECK (timestamp IS NOT NULL);

ALTER TABLE my_catalog.sales.events
ADD CONSTRAINT ck_source_enum CHECK (source IN ('openclaw','claude','git','linkedin'));

Behavior:
- Enforced at write/merge time: writes that would insert rows violating constraints raise an error and are rejected (transaction abort).
- Use-cases: strong enforcement when you want hard guarantees at storage level.

C — Hybrid / production pattern
- Use DLT expectations early (bronze/silver) to collect metrics and quarantine bad records; set expectations to drop or quarantine so ETL continues.
- After cleaning & backfill, add Delta CHECK constraints on Gold tables for hard enforcement to prevent corrupt data reaching consumers.
- Example flow:
  1. Bronze: ingest raw data (no constraints).
  2. Silver: DLT expectations detect & quarantine invalid rows (dlt.expect_or_drop or @dlt.expect + quarantine).
  3. Gold: after cleaning and validation, create Delta CHECK constraints to enforce invariants; this prevents malformed rows from being written.

What happens when a record fails?
- DLT expectation fail:
  - If you used dlt.expect only: pipeline records metric; rows remain (no automatic drop).
  - If you used dlt.expect_or_drop: failing rows are dropped (and optionally stored in a quarantined table if configured).
  - DLT can be configured to mark a pipeline as FAILED when metrics cross thresholds.
- Delta CHECK constraint violation:
  - The write/merge operation throws an error and the transaction is aborted; no partial commit.
  - You must correct or filter offending rows before retrying.

Concrete examples you can copy

1) DLT expectation + drop example:
@dlt.table
@dlt.expect("valid_source", "source IN ('openclaw','claude','git','linkedin')")
def silver():
    df = dlt.read("bronze_raw")
    df = dlt.expect_or_drop(df, "valid_source")   # drops invalid rows
    return df

2) Add Delta CHECK constraint on an existing table:
ALTER TABLE my_catalog.sales.events
ADD CONSTRAINT ck_ts_not_null CHECK (timestamp IS NOT NULL);

3) Write that would violate constraint (example will error):
INSERT INTO my_catalog.sales.events (event_id, timestamp, source, content)
VALUES ('e-1', NULL, 'openclaw', 'payload');
-- Fails with constraint violation (transaction aborted)

Summary recommendations
- Use DLT expectations for observability & soft enforcement early in pipeline; quarantine or drop as appropriate.
- Use Delta CHECK constraints for strong, hard enforcement on Gold tables where you want writes to be rejected if invariant violated.
- Use DESCRIBE HISTORY + Unity Catalog Lineage + DLT metrics to trace failing records back to their Bronze source and the pipeline step that mutated them.

If you want, next I can:
- Produce a ready‑to‑run Databricks notebook that (1) creates a Unity Catalog catalog/schema/table, (2) runs a DLT example with expectations, and (3) demonstrates a constraint violation and how DESCRIBE HISTORY + the Lineage UI map the writes back to Bronze files.
