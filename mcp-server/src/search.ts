// search.ts — How is data found?
// When Cosmos is enabled: SQL CONTAINS query with in-memory snippet generation.
// Fallback: full JSONL file scan.

import fs from 'node:fs/promises';
import type { BronzeRecord, SearchInput, SearchResult, SearchOutput } from './types.js';
import { getBronzeDir, listBronzeFiles, matchesFilters } from './store.js';
import { isCosmosEnabled, getBronzeContainer } from './cosmos-client.js';

const DEFAULT_MAX_RESULTS = 10;

function buildSearchHaystack(record: BronzeRecord): string {
  const parts: string[] = [
    typeof record.content === 'string' ? record.content : '',
    typeof record.type === 'string' ? record.type : '',
    typeof record.source === 'string' ? record.source : '',
  ];
  if (record.context !== undefined) {
    parts.push(JSON.stringify(record.context));
  }
  parts.push(JSON.stringify(record));
  return parts.filter(Boolean).join('\n');
}

function buildSnippet(haystack: string, query: string): string {
  const normalizedHaystack = haystack.replace(/\s+/g, ' ').trim();
  const lowerHaystack = normalizedHaystack.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerHaystack.indexOf(lowerQuery);

  if (index === -1) {
    return normalizedHaystack.slice(0, 180);
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(normalizedHaystack.length, index + query.length + 80);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedHaystack.length ? '...' : '';
  return `${prefix}${normalizedHaystack.slice(start, end)}${suffix}`;
}

function incrementCounter(counter: Record<string, number>, value: unknown): void {
  if (typeof value !== 'string') return;
  const key = value.trim();
  if (!key) return;
  counter[key] = (counter[key] ?? 0) + 1;
}

export async function searchEvents(input: SearchInput): Promise<SearchOutput> {
  if (isCosmosEnabled()) {
    return searchEventsFromCosmos(input);
  }
  return searchEventsFromJsonl(input);
}

async function searchEventsFromCosmos({
  query,
  maxResults = DEFAULT_MAX_RESULTS,
  source,
  type,
}: SearchInput): Promise<SearchOutput> {
  const container = await getBronzeContainer();
  const normalizedQuery = query.trim();
  const limit = Math.max(1, Math.min(100, maxResults ?? DEFAULT_MAX_RESULTS));

  const conditions: string[] = [
    'CONTAINS(c.content, @q, true) OR CONTAINS(c.type, @q, true) OR CONTAINS(c.source, @q, true)',
  ];
  const params: { name: string; value: string | number }[] = [
    { name: '@q', value: normalizedQuery },
  ];

  if (source) {
    conditions.push('CONTAINS(c._source, @source, true)');
    params.push({ name: '@source', value: source });
  }
  if (type) {
    conditions.push('CONTAINS(c.type, @typeFilter, true)');
    params.push({ name: '@typeFilter', value: type });
  }

  const where = conditions.join(' AND ');
  const { resources } = await container.items
    .query<BronzeRecord>({ query: `SELECT * FROM c WHERE ${where}`, parameters: params })
    .fetchAll();

  resources.sort((a, b) => (b._timestamp ?? '').localeCompare(a._timestamp ?? ''));

  const sourceCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const r of resources) {
    incrementCounter(sourceCounts, r._source ?? r.source);
    incrementCounter(typeCounts, r.type);
  }

  const results: SearchResult[] = resources.slice(0, limit).map((r) => ({
    eventId: r._event_id ?? null,
    timestamp: r._timestamp ?? null,
    source: r._source ?? r.source ?? null,
    type: r.type ?? null,
    trust: r._trust ?? null,
    snippet: buildSnippet(buildSearchHaystack(r), query),
    filePath: '',
  }));

  return {
    bronzeDir: 'cosmos://datacore/bronze',
    filesScanned: 0,
    eventsScanned: resources.length,
    parseErrors: 0,
    totalMatches: results.length,
    results,
    sourceCounts,
    typeCounts,
  };
}

async function searchEventsFromJsonl({
  query,
  maxResults = DEFAULT_MAX_RESULTS,
  source,
  type,
}: SearchInput): Promise<SearchOutput> {
  const bronzeDir = getBronzeDir();
  const files = await listBronzeFiles(bronzeDir);
  const normalizedQuery = query.trim().toLowerCase();
  const limit = Number.isFinite(maxResults)
    ? Math.max(1, Math.min(100, maxResults))
    : DEFAULT_MAX_RESULTS;
  const results: SearchResult[] = [];
  const sourceCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  let eventsScanned = 0;
  let parseErrors = 0;

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      eventsScanned += 1;
      let record: BronzeRecord;
      try {
        record = JSON.parse(line) as BronzeRecord;
      } catch {
        parseErrors += 1;
        continue;
      }

      incrementCounter(sourceCounts, record._source ?? record.source);
      incrementCounter(typeCounts, record.type);

      if (!matchesFilters(record, { source, type })) continue;
      if (!normalizedQuery) continue;

      const haystack = buildSearchHaystack(record);
      if (!haystack.toLowerCase().includes(normalizedQuery)) continue;

      if (results.length < limit) {
        results.push({
          eventId: record._event_id ?? null,
          timestamp: record._timestamp ?? null,
          source: record._source ?? record.source ?? null,
          type: record.type ?? null,
          trust: record._trust ?? null,
          snippet: buildSnippet(haystack, query),
          filePath,
        });
      }
    }
  }

  return {
    bronzeDir,
    filesScanned: files.length,
    eventsScanned,
    parseErrors,
    totalMatches: results.length,
    results,
    sourceCounts,
    typeCounts,
  };
}
