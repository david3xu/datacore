// cosmos-client.ts — How does the MCP server connect to Cosmos DB?
// Lazy singleton. Enabled only when COSMOS_ENDPOINT + COSMOS_KEY are set.
// When disabled, store.ts / gold-store.ts fall back to local JSONL files.

import { CosmosClient, type Container } from '@azure/cosmos';

let client: CosmosClient | null = null;

export function isCosmosEnabled(): boolean {
  // If an explicit local Bronze dir is set (e.g. in tests), honour file-based isolation
  // regardless of whether Cosmos credentials are present.
  if (process.env.DATACORE_BRONZE_DIR || process.env.DATACORE_GOLD_DIR) return false;
  return !!(process.env.COSMOS_ENDPOINT && process.env.COSMOS_KEY);
}

function getClient(): CosmosClient {
  if (!client) {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;
    if (!endpoint || !key) {
      throw new Error('COSMOS_ENDPOINT and COSMOS_KEY must be set when Cosmos is enabled');
    }
    client = new CosmosClient({ endpoint, key });
  }
  return client;
}

const DB = 'datacore';

export async function getBronzeContainer(): Promise<Container> {
  return getClient().database(DB).container('bronze');
}

export async function getGoldContainer(): Promise<Container> {
  return getClient().database(DB).container('gold');
}

// Verify connectivity — used at startup and in health checks
export async function pingCosmos(): Promise<void> {
  const db = getClient().database(DB);
  await db.read();
}
