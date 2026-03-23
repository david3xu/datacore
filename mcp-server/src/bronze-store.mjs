import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_MAX_RESULTS = 10;

function resolveBronzeDir() {
  return process.env.DATACORE_BRONZE_DIR || path.join(os.homedir(), '.datacore', 'bronze');
}

function dayStamp(isoTimestamp) {
  return isoTimestamp.slice(0, 10);
}

function buildSearchHaystack(record) {
  const parts = [
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

function buildSnippet(haystack, query) {
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

function incrementCounter(counter, value) {
  if (typeof value !== 'string') {
    return;
  }
  const key = value.trim();
  if (!key) {
    return;
  }
  counter[key] = (counter[key] ?? 0) + 1;
}

async function listBronzeFiles(bronzeDir) {
  try {
    const entries = await fs.readdir(bronzeDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(bronzeDir, entry.name))
      .sort()
      .reverse();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Check if a record matches the given source and type filters.
 */
function matchesFilters(record, { source, type }) {
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

/**
 * Read all Bronze records, with optional source/type pre-filtering.
 * Returns parsed records with filePath attached.
 */
async function readAllRecords({ source, type } = {}) {
  const bronzeDir = resolveBronzeDir();
  const files = await listBronzeFiles(bronzeDir);
  const records = [];
  let parseErrors = 0;

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        parseErrors += 1;
        continue;
      }
      if (!matchesFilters(record, { source, type })) continue;
      record._filePath = filePath;
      records.push(record);
    }
  }

  return { bronzeDir, files, records, parseErrors };
}

export function getBronzeDir() {
  return resolveBronzeDir();
}

export async function appendEvent({ source, type, content, context }) {
  const bronzeDir = resolveBronzeDir();
  const timestamp = new Date().toISOString();
  const record = {
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

  return {
    bronzeDir,
    filePath,
    record,
  };
}

export async function searchEvents({ query, maxResults = DEFAULT_MAX_RESULTS, source, type }) {
  const bronzeDir = resolveBronzeDir();
  const files = await listBronzeFiles(bronzeDir);
  const normalizedQuery = query.trim().toLowerCase();
  const limit = Number.isFinite(maxResults)
    ? Math.max(1, Math.min(100, maxResults))
    : DEFAULT_MAX_RESULTS;
  const results = [];
  const sourceCounts = {};
  const typeCounts = {};
  let eventsScanned = 0;
  let parseErrors = 0;

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      eventsScanned += 1;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        parseErrors += 1;
        continue;
      }

      incrementCounter(sourceCounts, record._source ?? record.source);
      incrementCounter(typeCounts, record.type);

      // Apply source/type filters before text search
      if (!matchesFilters(record, { source, type })) {
        continue;
      }

      if (!normalizedQuery) {
        continue;
      }

      const haystack = buildSearchHaystack(record);
      if (!haystack.toLowerCase().includes(normalizedQuery)) {
        continue;
      }

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

/**
 * Query task events from Bronze.
 *
 * Tasks are events whose type starts with "task_". They are grouped by
 * context.task_id. The latest event per task determines current status.
 *
 * @param {object} opts
 * @param {string} [opts.status] - Filter: "active" (created|assigned|in_progress|blocked),
 *                                  "completed", "failed", or "all" (default: "active")
 * @param {string} [opts.assigned_to] - Filter by assignee
 * @param {string} [opts.task_type] - Filter by task_type (code, research, etc.)
 * @param {string} [opts.task_id] - Get full history of a specific task
 * @param {number} [opts.limit] - Max tasks to return (default: 20)
 */
export async function getTasks({
  status = 'active',
  assigned_to,
  task_type,
  task_id,
  limit = 20,
} = {}) {
  const { bronzeDir, records, parseErrors } = await readAllRecords({ type: 'task_' });

  // Only task events (type starts with "task_")
  const taskEvents = records.filter((r) => (r.type ?? '').startsWith('task_'));

  // If requesting a specific task, return full history
  if (task_id) {
    const history = taskEvents
      .filter((r) => r.context?.task_id === task_id)
      .sort((a, b) => (a._timestamp ?? '').localeCompare(b._timestamp ?? ''));

    return {
      bronzeDir,
      mode: 'history',
      task_id,
      events: history.map(formatTaskEvent),
      totalEvents: history.length,
    };
  }

  // Group by task_id
  const taskMap = new Map();
  for (const record of taskEvents) {
    const tid = record.context?.task_id;
    if (!tid) continue;
    if (!taskMap.has(tid)) taskMap.set(tid, []);
    taskMap.get(tid).push(record);
  }

  // Build task summaries from latest event per task
  const ACTIVE_STATUSES = new Set(['created', 'assigned', 'in_progress', 'blocked']);
  const tasks = [];

  for (const [tid, events] of taskMap) {
    // Sort by timestamp ascending, pick latest for current state
    events.sort((a, b) => (a._timestamp ?? '').localeCompare(b._timestamp ?? ''));
    const latest = events[events.length - 1];
    const created = events[0];

    // Merge context across all events (latest wins per field)
    const mergedContext = {};
    for (const ev of events) {
      if (ev.context) Object.assign(mergedContext, ev.context);
    }

    const currentStatus = mergedContext.status ?? 'unknown';

    // Status filter
    if (status === 'active' && !ACTIVE_STATUSES.has(currentStatus)) continue;
    if (status === 'completed' && currentStatus !== 'completed') continue;
    if (status === 'failed' && currentStatus !== 'failed') continue;

    // Assignee filter
    if (
      assigned_to &&
      (mergedContext.assigned_to ?? '').toLowerCase() !== assigned_to.toLowerCase()
    )
      continue;

    // Task type filter
    if (task_type && (mergedContext.task_type ?? '').toLowerCase() !== task_type.toLowerCase())
      continue;

    tasks.push({
      task_id: tid,
      status: currentStatus,
      task_type: mergedContext.task_type ?? null,
      assigned_to: mergedContext.assigned_to ?? null,
      score: mergedContext.score ?? null,
      // Layer 1: WHY
      problem: mergedContext.problem ?? null,
      impact: mergedContext.impact ?? null,
      // Layer 2: WHERE
      project: mergedContext.project ?? null,
      workflow_stage: mergedContext.workflow_stage ?? null,
      phase: mergedContext.phase ?? null,
      depends_on: mergedContext.depends_on ?? null,
      // Layer 3: HOW
      pattern: mergedContext.pattern ?? null,
      acceptance: mergedContext.acceptance ?? null,
      spec_file: mergedContext.spec_file ?? null,
      // Content
      summary: created.content ?? null,
      latest_update: latest.content ?? null,
      latest_type: latest.type ?? null,
      // Metadata
      created_at: created._timestamp ?? null,
      updated_at: latest._timestamp ?? null,
      event_count: events.length,
      tags: mergedContext.tags ?? null,
      lessons: mergedContext.lessons ?? null,
    });
  }

  // Sort by most recently updated
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

function formatTaskEvent(record) {
  return {
    eventId: record._event_id ?? null,
    timestamp: record._timestamp ?? null,
    source: record._source ?? record.source ?? null,
    type: record.type ?? null,
    content: record.content ?? null,
    context: record.context ?? null,
  };
}
