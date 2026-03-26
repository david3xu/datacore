// deep-search.ts — How does deep semantic search work?
// Calls Azure Databricks Vector Search REST API for semantic + hybrid queries.
// Uses a circuit breaker to prevent hammering a failing API.

import { deepSearchBreaker } from './circuit-breaker.js';

export { CircuitOpenError } from './circuit-breaker.js';

export interface DeepSearchInput {
  query: string;
  numResults?: number;
  source?: string;
  type?: string;
  mode?: 'hybrid' | 'semantic';
}

export interface DeepSearchResult {
  eventId: string | null;
  timestamp: string | null;
  source: string | null;
  type: string | null;
  content: string | null;
}

export interface DeepSearchOutput {
  query: string;
  mode: string;
  indexName: string;
  totalResults: number;
  results: DeepSearchResult[];
}

function getConfig(): { host: string; token: string; indexName: string } {
  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;
  const indexName =
    process.env.DATABRICKS_INDEX_NAME || 'datacore_databricks.datacore.bronze_events_index';

  if (!host || !token) {
    throw new Error(
      'DATABRICKS_HOST and DATABRICKS_TOKEN must be set. ' +
        'Get a token from Databricks > User Settings > Developer > Access tokens.',
    );
  }
  return { host: host.replace(/\/$/, ''), token, indexName };
}

export async function deepSearch(input: DeepSearchInput): Promise<DeepSearchOutput> {
  const { host, token, indexName } = getConfig();
  const { query, numResults = 5, source, type, mode = 'hybrid' } = input;

  const columns = ['event_id', 'timestamp', 'source', 'type', 'content'];
  const body: Record<string, unknown> = {
    columns,
    query_text: query,
    num_results: Math.min(numResults, 20),
    query_type: mode === 'semantic' ? 'ANN' : 'HYBRID',
  };

  const filters: Record<string, string[]> = {};
  if (source) filters['source'] = [source];
  if (type) filters['type'] = [type];
  if (Object.keys(filters).length > 0) {
    body.filters_json = JSON.stringify(filters);
  }

  const url = `${host}/api/2.0/vector-search/indexes/${indexName}/query`;

  // Tag 4xx errors so the outer catch can call ignore() after onFailure() runs
  class CallerError extends Error {}

  try {
    return await deepSearchBreaker.call(async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status >= 400 && response.status < 500) {
          // Tag as caller error — will be unwrapped below after breaker.onFailure() runs
          throw new CallerError(`Databricks API ${response.status}: ${text}`);
        }
        // 5xx / 429 — server-side failure, let the breaker count it
        throw new Error(`Databricks API ${response.status}: ${text}`);
      }

      const data = (await response.json()) as {
        manifest: { columns: Array<{ name: string }> };
        result: { data_array: string[][] };
      };

      const colNames = data.manifest.columns.map((c) => c.name);
      const results: DeepSearchResult[] = data.result.data_array.map((row) => {
        const obj: Record<string, string | null> = {};
        colNames.forEach((name, i) => {
          obj[name] = row[i] ?? null;
        });
        return {
          eventId: obj['event_id'] ?? null,
          timestamp: obj['timestamp'] ?? null,
          source: obj['source'] ?? null,
          type: obj['type'] ?? null,
          content: obj['content'] ?? null,
        };
      });

      return { query, mode, indexName, totalResults: results.length, results };
    });
  } catch (err) {
    // 4xx caller errors: undo the failure that breaker.call() just counted
    if (err instanceof CallerError) {
      deepSearchBreaker.ignore();
      throw new Error(err.message, { cause: err });
    }
    throw err;
  }
}
