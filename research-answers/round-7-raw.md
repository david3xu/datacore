
Continue research. Search ONLY official docs (learn.microsoft.com, databricks.com, azure.microsoft.com). Concrete answers.

ROUND 7 — Cost and Feasibility: What Can a Student Actually Use?

Q18. What does Azure Databricks cost? Is there a free tier or student option? What does a minimal workspace cost per month for light usage (a few notebooks, small Delta tables, no cluster running 24/7)?

Q19. What Azure services are available on Azure for Students (A$100 credit)? Can I use ADLS Gen2, Data Factory, Databricks, Cosmos DB, AI Search on student credits? What is blocked?

Q20. What is Databricks Community Edition? What can and cannot it do compared to a full workspace? Can I build a Medallion pipeline on it? What are the limitations?
'

Short answers up front — then concrete details and commands/links you can follow to verify.

Q18 — Azure Databricks cost, free tier, and a minimal-light workspace estimate
- No perpetual free tier for Azure Databricks in the production service. Databricks is billed as compute (DBU) + underlying VM costs; there is sometimes a free trial or promotional credits but not a permanent free tier for production work. Databricks Community Edition (free) exists separately (see Q20) but is limited and not a production workspace.
- Pricing model (high level, official):
  - Databricks Units (DBUs): Databricks defines DBU consumption per VM type / cluster type + runtime. You pay for DBUs × DBU price for your chosen tier (standard, enterprise) plus the cloud VM cost (Azure VM hourly rates).
  - For serverless SQL or Databricks Jobs there are different DBU rates; interactive clusters incur DBUs while running.
  - Official pricing pages list DBU/hour by SKU and region and give examples; always consult the Azure Databricks pricing page for current per-DBU and VM rates in your region.

Minimal workspace cost estimate for light student usage (example, order‑of‑magnitude)
- Assumptions for a light student/dev setup:
  - Use small single-node interactive cluster only when you run notebooks; stop cluster when idle.
  - Use small VM (e.g., Standard_DS3_v2 / Standard_D4s_v3 class or equivalent) for development; run for a few hours/day.
  - Store small Delta tables in ADLS Gen2 (cheap object storage).
- Rough monthly example (illustrative):
  - Compute: 1 small cluster run ~ 2 vCPUs, 8–16GB RAM — if used 2 hours/day × 22 days ≈ 44 hours/month.
  - VM compute cost: say AU$0.10–0.50/hour depending on VM (example only; check Azure VM pricing).
  - DBU cost: small clusters may consume ~0.1–1 DBU/hour in some SKUs — DBU price varies; example DBU × hours might be AU$10–100/month.
  - Storage: ADLS Gen2 storing ~10–50 GB — few dollars/month.
  - Total (very small/light use): low tens to low hundreds AUD per month (not free). Exact numbers depend on region, chosen VM, and Databricks SKU.
- How to minimize cost:
  - Shutdown clusters when idle (don’t leave cluster running).
  - Use spot/preemptible VMs for heavy experiments.
  - Use small clusters for development and do heavy training on rented GPU time only when needed.
- Authoritative action: check the Azure Databricks pricing page for DBU rates in your region and the Azure VM pricing calculator to produce an exact monthly estimate for your intended hours.

Q19 — Azure for Students (A$100 credit) — what services you can use and common limits
- Azure for Students provides a free credit (typically US$100 or local equivalent) and some free services for 12 months; eligibility and service list may change — always confirm the current offer page in Microsoft Learn / Azure student documentation.
- Common facts (official docs pattern):
  - You get a fixed credit balance to spend on eligible Azure services. Most Azure services are billable against the credit unless explicitly listed as “free services” included in the student offer.
  - Some paid marketplace offerings or third‑party resources may not be eligible for the free credits or may require separate billing.
- Typical availability for student credits (what you can usually do):
  - ADLS Gen2 (Azure Storage) — yes, you can create storage accounts and consume student credits.
  - Azure Data Factory — generally available and can be used against credits.
  - Azure Cognitive Search — billable and usable against credits.
  - Cosmos DB — usable but can be costly; free tier (if enabled) or small provisioned throughput can be used to reduce cost.
  - Databricks on Azure — in many cases Databricks is billable on top of Azure credits (Databricks is not typically included as a managed free service in the student offer). You can consume student credits for Databricks usage, but Databricks may require additional signup and billing setup (and some marketplace SKUs may not accept credit). Confirm on the Azure for Students page and Databricks on Azure marketplace entry.
- Blocked / limited items:
  - Some third-party Marketplace or reserved resources might require payment method and not accept student credits; some promotional or partner credits are limited in scope.
  - Enterprise features (e.g., enterprise Databricks SKUs or reserved capacity) may not be covered.
- Action to verify for your account:
  - Sign in to the Azure for Students page in the Azure portal → check “Subscriptions” and the list of included services and apply the pricing calculator. The Azure docs and the Azure for Students page list current inclusions and exclusions.

Q20 — Databricks Community Edition: capabilities and limitations (concrete)
- What it is:
  - Databricks Community Edition is a free tier offered by Databricks for learning and light experimentation. It provides a small personal workspace, a notebook environment, and a single (shared) small cluster.
- What you can do (typical official facts):
  - Run notebooks with a small cluster (limited compute / limited runtime).
  - Work with small datasets, experiment with Spark SQL, basic Delta Lake operations, and learn Databricks APIs.
  - Good for learning Spark, Delta basics, and prototyping simple ETL logic.
- Limitations vs full Databricks workspace:
  - No multiple clusters or autoscaling, limited CPU/RAM, no production job scheduling, limited concurrency.
  - No support for Unity Catalog, Delta Live Tables (DLT), Databricks Jobs with full scheduling, and many enterprise features (access control integration, mounting ADLS using managed identity, large-scale autoscaling).
  - Integration with enterprise Azure resources (ADLS Gen2 with managed identities, Unity Catalog, and many cloud integrations) is limited or unavailable.
  - Marketplace integrations, partner credits, and some premium runtimes/DBU SKUs are not available.
- Can you build a Medallion pipeline on Community Edition?
  - You can prototype a simple Medallion flow locally in Community Edition (ingest → transform → aggregate) using notebooks and local Delta storage within the Community environment, but:
    - You’ll be limited by compute and cluster features (no Auto Loader with Event Grid notifications in some cases, limited throughput).
    - You cannot fully test production orchestration (DLT, Unity Catalog, multi-cluster scaling).
  - Recommendation: use Community Edition to validate transformations and small proofs-of-concept; for production‑scale Medallion pipelines you’ll need a full Databricks workspace on Azure with proper storage (ADLS Gen2) and Unity Catalog/DLT if you need governance and production scheduling.

Concrete authoritative verification steps (official docs to read next)
- Azure Databricks pricing and DBU details: check the official Azure Databricks pricing page on docs.databricks.com and the Azure Marketplace listing for Databricks (region-specific DBU and VM pricing).
- Azure for Students: check the official Azure for Students page on learn.microsoft.com / portal.azure.com to see what services are included and whether Marketplace items accept student credits.
- Databricks Community Edition: read the official Databricks Community Edition page and documentation for exact current feature list and limits.

If you want, I can:
- Fetch the current official pricing pages (Databricks pricing & Azure VM pricing calculator) and produce a concrete line-item monthly cost estimate for a precise cluster size and usage hours you expect (I’ll need the cluster VM type and hours/day you expect).
- Sign into Azure with your account to check which services your Azure for Students credit allows (you would need to sign me in or paste subscription info).
Which would you like next?
