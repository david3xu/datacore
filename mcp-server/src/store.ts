// store.ts — How is data stored?
// Primary backend: Cosmos DB (when COSMOS_ENDPOINT + COSMOS_KEY are set).
// Fallback backend: daily JSONL files at $DATACORE_BRONZE_DIR or ~/.datacore/bronze/.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BronzeRecord,
  TrustLevel,
  AppendEventInput,
  AppendEventResult,
  Filters,
  ReadAllResult,
} from './types.js';
import { isCosmosEnabled, getBronzeContainer } from './cosmos-client.js';

const VERIFIED_SOURCES = new Set(['log-session-sh']);
const AI_SOURCES = new Set([
  'claude',
  'claude-agent',
  'claude.ai',
  'claude-desktop',
  'claude-web',
  'claude-cowork',
  'codex',
  'codex-session',
  'gemini',
  'gemini-session',
  'openclaw',
  'openclaw-session',
]);

function inferTrust(source: string): TrustLevel {
  if (VERIFIED_SOURCES.has(source)) return 'verified';
  if (AI_SOURCES.has(source)) return 'ai-generated';
  return 'external';
}

function resolveBronzeDir(): string {
  return process.env.DATACORE_BRONZE_DIR || path.join(os.homedir(), '.datacore', 'bronze');
}

function dayStamp(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

export function getBronzeDir(): string {
  return resolveBronzeDir();
}

export async function listBronzeFiles(bronzeDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(bronzeDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(bronzeDir, entry.name))
      .sort()
      .reverse();
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export function matchesFilters(record: BronzeRecord, { source, type }: Filters): boolean {
  if (source) {
    const recordSource = (record._source ?? record.source ?? '').toLowerCase();
    if (!recordSource.includes(source.toLowerCase())) return false;
  }
  if (type) {
    const recordType = (record.type ?? '').toLowerCase();
    if (!recordType.includes(type.toLowerCase())) return false;
  }
  return true;
}

export async function readAllRecords(filters: Filters = {}): Promise<ReadAllResult> {
  if (isCosmosEnabled()) {
    return readAllRecordsFromCosmos(filters);
  }
  return readAllRecordsFromJsonl(filters);
}

async function readAllRecordsFromCosmos(filters: Filters): Promise<ReadAllResult> {
  const container = await getBronzeContainer();
  const conditions: string[] = [];
  const params: { name: string; value: string }[] = [];

  if (filters.source) {
    conditions.push('CONTAINS(c._source, @source, true)');
    params.push({ name: '@source', value: filters.source });
  }
  if (filters.type) {
    conditions.push('CONTAINS(c.type, @type, true)');
    params.push({ name: '@type', value: filters.type });
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { resources } = await container.items
    .query<BronzeRecord>({ query: `SELECT * FROM c ${where}`, parameters: params })
    .fetchAll();

  resources.sort((a, b) => (b._timestamp ?? '').localeCompare(a._timestamp ?? ''));
  return { bronzeDir: 'cosmos://datacore/bronze', files: [], records: resources, parseErrors: 0 };
}

async function readAllRecordsFromJsonl(filters: Filters): Promise<ReadAllResult> {
  const bronzeDir = resolveBronzeDir();
  const files = await listBronzeFiles(bronzeDir);
  const records: BronzeRecord[] = [];
  let parseErrors = 0;

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      let record: BronzeRecord;
      try {
        record = JSON.parse(line) as BronzeRecord;
      } catch {
        parseErrors += 1;
        continue;
      }
      if (!matchesFilters(record, filters)) continue;
      record._filePath = filePath;
      records.push(record);
    }
  }

  return { bronzeDir, files, records, parseErrors };
}

const MAX_CONTENT_LENGTH = 50_000;

function sanitize(text: string): string {
  // Strip null bytes and control chars (except newline, tab)
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, MAX_CONTENT_LENGTH);
}

export async function appendEvent({
  source,
  type,
  content,
  context,
}: AppendEventInput): Promise<AppendEventResult> {
  const timestamp = new Date().toISOString();
  const sanitizedSource = sanitize(source);
  const record: BronzeRecord = {
    source: sanitizedSource,
    type: sanitize(type),
    content: sanitize(content),
    ...(context !== undefined ? { context } : {}),
    _timestamp: timestamp,
    _source: sanitizedSource,
    _event_id: randomUUID(),
    _trust: inferTrust(sanitizedSource),
  };

  if (isCosmosEnabled()) {
    const container = await getBronzeContainer();
    await container.items.create({ ...record, id: record._event_id });
    return { bronzeDir: 'cosmos://datacore/bronze', filePath: '', record };
  }

  const bronzeDir = resolveBronzeDir();
  const filePath = path.join(bronzeDir, `${dayStamp(timestamp)}.jsonl`);
  await fs.mkdir(bronzeDir, { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  return { bronzeDir, filePath, record };
}
