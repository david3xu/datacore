// tasks.ts — How are tasks tracked?

import type { BronzeRecord, TaskInput, TaskEvent, TaskSummary, TaskResult } from './types.js';
import { readAllRecords } from './store.js';

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
}: TaskInput = {}): Promise<TaskResult> {
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
