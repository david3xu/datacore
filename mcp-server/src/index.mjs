#!/usr/bin/env node

import { appendEvent, getBronzeDir, searchEvents, getTasks } from './bronze-store.mjs';
import { McpServer, StdioServerTransport, z } from './runtime-deps.mjs';

function toTextResult(text, structuredContent) {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
  };
}

const server = new McpServer({
  name: 'datacore',
  version: '0.2.0',
});

// ─── log_event ───────────────────────────────────────────────────────
// Write any event to Bronze. For task events, use type "task_created",
// "task_assigned", etc. and include context with task_id and the three
// layers (WHY, WHERE, HOW). Content must be plain searchable text.
server.tool(
  'log_event',
  'Append a raw event to the local Bronze JSONL store. For task management, use task lifecycle types (task_created, task_assigned, task_started, task_completed, task_reviewed, etc.) with context containing task_id, status, and the three layers: WHY (problem, impact), WHERE (project, workflow_stage, phase), HOW (pattern, lessons, acceptance). Content MUST be plain searchable text — a self-contained briefing, not a title.',
  {
    source: z.string().min(1),
    type: z.string().min(1),
    content: z.string().min(1),
    context: z.record(z.string(), z.unknown()).optional(),
  },
  {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  async ({ source, type, content, context }) => {
    const logged = await appendEvent({ source, type, content, context });
    return toTextResult(`Logged ${type} from ${source} to ${logged.filePath}`, {
      status: 'ok',
      bronzeDir: logged.bronzeDir,
      filePath: logged.filePath,
      event: logged.record,
    });
  },
);

// ─── search ──────────────────────────────────────────────────────────
// Full-text search across all Bronze events, with optional source/type
// filtering to narrow results.
server.tool(
  'search',
  "Search collected Bronze events using case-insensitive full-text matching. Use source and type filters to narrow results (e.g. source='gemini' to find only Gemini events, type='conversation' for conversation logs, type='task_' for all task events).",
  {
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(100).optional(),
    source: z
      .string()
      .optional()
      .describe("Filter by source (e.g. 'gemini', 'claude-cowork', 'codex-session')"),
    type: z
      .string()
      .optional()
      .describe("Filter by event type (e.g. 'conversation', 'decision', 'task_created')"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async ({ query, max_results: maxResults, source, type }) => {
    const result = await searchEvents({ query, maxResults, source, type });

    if (result.results.length === 0) {
      const filters = [source && `source=${source}`, type && `type=${type}`]
        .filter(Boolean)
        .join(', ');
      const filterNote = filters ? ` (filters: ${filters})` : '';
      return toTextResult(
        `No events matched "${query}"${filterNote} in ${result.bronzeDir}`,
        result,
      );
    }

    const summary = result.results
      .map((match, index) => {
        const timestamp = match.timestamp ?? '?';
        const src = match.source ?? '?';
        const typ = match.type ?? '?';
        return `${index + 1}. [${src}/${typ}] ${timestamp} ${match.snippet}`;
      })
      .join('\n');

    return toTextResult(
      `Found ${result.results.length} match(es) for "${query}" in ${getBronzeDir()}\n${summary}`,
      result,
    );
  },
);

// ─── get_tasks ───────────────────────────────────────────────────────
// Query task events from Bronze. Tasks are events with type starting
// with "task_", grouped by context.task_id. Returns either a board view
// (all tasks with current status) or a history view (all events for one task).
server.tool(
  'get_tasks',
  'Query task board from Bronze events. Returns active tasks by default (the Jira board view). Use task_id to get full history of a specific task (all events from creation to review). Tasks carry three layers of context: WHY (problem, impact), WHERE (project, stage, constraints), HOW (pattern, lessons, acceptance criteria).',
  {
    status: z
      .enum(['active', 'completed', 'failed', 'all'])
      .optional()
      .describe(
        "Filter: 'active' (default) = created/assigned/in_progress/blocked, 'completed', 'failed', 'all'",
      ),
    assigned_to: z
      .string()
      .optional()
      .describe("Filter by assignee (e.g. 'codex', 'gemini', 'claude', 'david')"),
    task_type: z
      .string()
      .optional()
      .describe("Filter by task type (e.g. 'code', 'research', 'config', 'test')"),
    task_id: z
      .string()
      .optional()
      .describe("Get full event history for a specific task (e.g. 'R9', 'R11')"),
    limit: z.number().int().min(1).max(50).optional().describe('Max tasks to return (default: 20)'),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async ({ status, assigned_to, task_type, task_id, limit }) => {
    const result = await getTasks({ status, assigned_to, task_type, task_id, limit });

    // History mode: show all events for one task
    if (result.mode === 'history') {
      if (result.events.length === 0) {
        return toTextResult(`No task events found for task_id "${task_id}"`, result);
      }

      const timeline = result.events
        .map((ev, i) => {
          const ts = ev.timestamp ?? '?';
          const src = ev.source ?? '?';
          return `${i + 1}. [${ev.type}] ${ts} by ${src}\n   ${ev.content}`;
        })
        .join('\n\n');

      // Include full context from first event (task_created)
      const created = result.events[0];
      const ctx = created.context ?? {};
      const contextSummary = [
        ctx.problem && `Problem: ${ctx.problem}`,
        ctx.impact && `Impact: ${ctx.impact}`,
        ctx.project && `Project: ${ctx.project}`,
        ctx.workflow_stage && `Stage: ${ctx.workflow_stage}`,
        ctx.phase && `Phase: ${ctx.phase}`,
        ctx.pattern && `Pattern: ${ctx.pattern}`,
        ctx.constraints && `Constraints: ${ctx.constraints}`,
        ctx.acceptance && `Acceptance: ${ctx.acceptance.join('; ')}`,
        ctx.lessons && `Lessons: ${ctx.lessons.join('; ')}`,
        ctx.assigned_to && `Assigned to: ${ctx.assigned_to}`,
        ctx.spec_file && `Spec: ${ctx.spec_file}`,
      ]
        .filter(Boolean)
        .join('\n');

      return toTextResult(
        `Task ${task_id} — ${result.totalEvents} events\n\n` +
          (contextSummary ? `--- Context ---\n${contextSummary}\n\n` : '') +
          `--- Timeline ---\n${timeline}`,
        result,
      );
    }

    // Board mode: show task summaries
    if (result.tasks.length === 0) {
      return toTextResult(`No ${status ?? 'active'} tasks found`, result);
    }

    const board = result.tasks
      .map((t) => {
        const parts = [
          `[${t.task_id}] ${t.status.toUpperCase()}`,
          t.assigned_to ? `→ ${t.assigned_to}` : '→ unassigned',
          t.task_type ? `(${t.task_type})` : '',
          t.score !== null ? `score: ${t.score}/10` : '',
        ];
        const header = parts.filter(Boolean).join(' ');
        const lines = [header];
        if (t.summary) lines.push(`  Summary: ${t.summary.slice(0, 200)}`);
        if (t.problem) lines.push(`  Why: ${t.problem}`);
        if (t.project)
          lines.push(
            `  Project: ${t.project} | Stage: ${t.workflow_stage ?? '?'} | Phase: ${t.phase ?? '?'}`,
          );
        if (t.latest_update && t.latest_update !== t.summary) {
          lines.push(`  Latest: [${t.latest_type}] ${t.latest_update.slice(0, 150)}`);
        }
        if (t.tags) lines.push(`  Tags: ${t.tags.join(', ')}`);
        return lines.join('\n');
      })
      .join('\n\n');

    return toTextResult(
      `Task Board (${status ?? 'active'}) — ${result.total_tasks} task(s)\n\n${board}`,
      result,
    );
  },
);

await server.connect(new StdioServerTransport());

// Graceful shutdown
async function shutdown() {
  await server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
