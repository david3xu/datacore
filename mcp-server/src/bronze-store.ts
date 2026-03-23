import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────

export interface BronzeRecord {
  source: string;
  type: string;
  content: string;
  context?: Record<string, unknown>;
  _timestamp: string;
  _source: string;
  _event_id: string;
  _filePath?: string;
}

export interface AppendEventInput {
  source: string;
  type: string;
  content: string;
  context?: Record<string, unknown>;
}

export interface AppendEventResult {
  bronzeDir: string;
  filePath: string;
  record: BronzeRecord;
}

export interface SearchInput {
  query: string;
  maxResults?: number;
  source?: string;
  type?: string;
}

export interface SearchResult {
  eventId: string | null;
  timestamp: string | null;
  source: string | null;
  type: string | null;
  snippet: string;
  filePath: string;
}

export interface SearchOutput {
  bronzeDir: string;
  filesScanned: number;
  eventsScanned: number;
  parseErrors: number;
  totalMatches: number;
  results: SearchResult[];
  sourceCounts: Record<string, number>;
  typeCounts: Record<string, number>;
}

export interface TaskInput {
  status?: string;
  assigned_to?: string;
  task_type?: string;
  task_id?: string;
  limit?: number;
}

export interface TaskSummary {
  task_id: string;
  status: string;
  task_type: string | null;
  assigned_to: string | null;
  score: unknown;
  problem: unknown;
  impact: unknown;
  project: unknown;
  workflow_stage: unknown;
  phase: unknown;
  depends_on: unknown;
  pattern: unknown;
  acceptance: unknown;
  spec_file: unknown;
  summary: string | null;
  latest_update: string | null;
  latest_type: string | null;
  created_at: string | null;
  updated_at: string | null;
  event_count: number;
  tags: unknown;
  lessons: unknown;
}

export interface TaskEvent {
  eventId: string | null;
  timestamp: string | null;
  source: string | null;
  type: string | null;
  content: string | null;
  context: Record<string, unknown> | null;
}

// ── Private helpers ─────────────────────────────────────────

const DEFAULT_MAX_RESULTS = 10;

function resolveBronzeDir(): string {
  return process.env.DATACORE_BRONZE_DIR || path.join(os.homedir(), '.datacore', 'bronze');
}

function dayStamp(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

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

async function listBronzeFiles(bronzeDir: string): Promise<string[]> {
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

interface Filters {
  source?: string;
  type?: string;
}

function matchesFilters(record: BronzeRecord, { source, type }: Filters): boolean {
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

async function readAllRecords(
  filters: Filters = {},
): Promise<{ bronzeDir: string; files: string[]; records: BronzeRecord[]; parseErrors: number }> {
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

// ── Exported functions ──────────────────────────────────────

export function getBronzeDir(): string {
  return resolveBronzeDir();
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

export async function searchEvents({
  query,
  maxResults = DEFAULT_MAX_RESULTS,
  source,
  type,
}: SearchInput): Promise<SearchOutput> {
  const bronzeDir = resolveBronzeDir();
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

function formatTaskEvent(record: BronzeRecord): TaskEvent {
  return {
    eventId: record._event_id ?? null,
    timestamp: record._timestamp ?? null,
    source: record._source ?? record.source ?? null,
    type: record.type ?? null,
    content: record.content ?? null,
    context: (record.context as Record<string, unknown>) ?? null,
  };
}

export async function getTasks({
  status = 'active',
  assigned_to,
  task_type,
  task_id,
  limit = 20,
}: TaskInput = {}): Promise<{
  bronzeDir: string;
  mode: string;
  [key: string]: unknown;
}> {
  const { bronzeDir, records, parseErrors } = await readAllRecords({ type: 'task_' });
  const taskEvents = records.filter((r) => (r.type ?? '').startsWith('task_'));

  if (task_id) {
    const history = taskEvents
      .filter((r) => (r.context as Record<string, unknown>)?.task_id === task_id)
      .sort((a, b) => (a._timestamp ?? '').localeCompare(b._timestamp ?? ''));

    return {
      bronzeDir,
      mode: 'history',
      task_id,
      events: history.map(formatTaskEvent),
      totalEvents: history.length,
    };
  }

  const taskMap = new Map<string, BronzeRecord[]>();
  for (const record of taskEvents) {
    const tid = (record.context as Record<string, unknown>)?.task_id as string | undefined;
    if (!tid) continue;
    if (!taskMap.has(tid)) taskMap.set(tid, []);
    taskMap.get(tid)!.push(record);
  }

  const ACTIVE_STATUSES = new Set(['created', 'assigned', 'in_progress', 'blocked']);
  const tasks: TaskSummary[] = [];

  for (const [tid, events] of taskMap) {
    events.sort((a, b) => (a._timestamp ?? '').localeCompare(b._timestamp ?? ''));
    const latest = events[events.length - 1]!;
    const created = events[0]!;

    const mergedContext: Record<string, unknown> = {};
    for (const ev of events) {
      if (ev.context) Object.assign(mergedContext, ev.context);
    }

    const currentStatus = (mergedContext.status as string) ?? 'unknown';

    if (status === 'active' && !ACTIVE_STATUSES.has(currentStatus)) continue;
    if (status === 'completed' && currentStatus !== 'completed') continue;
    if (status === 'failed' && currentStatus !== 'failed') continue;

    if (
      assigned_to &&
      ((mergedContext.assigned_to as string) ?? '').toLowerCase() !== assigned_to.toLowerCase()
    )
      continue;

    if (
      task_type &&
      ((mergedContext.task_type as string) ?? '').toLowerCase() !== task_type.toLowerCase()
    )
      continue;

    tasks.push({
      task_id: tid,
      status: currentStatus,
      task_type: (mergedContext.task_type as string) ?? null,
      assigned_to: (mergedContext.assigned_to as string) ?? null,
      score: mergedContext.score ?? null,
      problem: mergedContext.problem ?? null,
      impact: mergedContext.impact ?? null,
      project: mergedContext.project ?? null,
      workflow_stage: mergedContext.workflow_stage ?? null,
      phase: mergedContext.phase ?? null,
      depends_on: mergedContext.depends_on ?? null,
      pattern: mergedContext.pattern ?? null,
      acceptance: mergedContext.acceptance ?? null,
      spec_file: mergedContext.spec_file ?? null,
      summary: created.content ?? null,
      latest_update: latest.content ?? null,
      latest_type: latest.type ?? null,
      created_at: created._timestamp ?? null,
      updated_at: latest._timestamp ?? null,
      event_count: events.length,
      tags: mergedContext.tags ?? null,
      lessons: mergedContext.lessons ?? null,
    });
  }

  tasks.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));

  return {
    bronzeDir,
    mode: 'board',
    status_filter: status,
    total_tasks: tasks.length,
    tasks: tasks.slice(0, limit),
    parseErrors,
  };
}
