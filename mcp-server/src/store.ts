// store.ts — How is data stored?

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BronzeRecord,
  AppendEventInput,
  AppendEventResult,
  Filters,
  ReadAllResult,
} from './types.js';

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

export async function appendEvent({
  source,
  type,
  content,
  context,
}: AppendEventInput): Promise<AppendEventResult> {
  const bronzeDir = resolveBronzeDir();
  const timestamp = new Date().toISOString();
  const record: BronzeRecord = {
    source,
    type,
    content,
    ...(context !== undefined ? { context } : {}),
    _timestamp: timestamp,
    _source: source,
    _event_id: randomUUID(),
  };
  const filePath = path.join(bronzeDir, `${dayStamp(timestamp)}.jsonl`);

  await fs.mkdir(bronzeDir, { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');

  return { bronzeDir, filePath, record };
}
