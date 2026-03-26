// tools.ts — What can agents do?

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { appendEvent, getBronzeDir } from './store.js';
import { searchEvents } from './search.js';
import { getTasks } from './tasks.js';
import { deepSearch } from './deep-search.js';
import { upsertEntity, queryEntities, getGoldDir } from './gold-store.js';
import { getQuestions } from './questions.js';

function toTextResult(text: string, structuredContent?: unknown) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent !== undefined
      ? { structuredContent: structuredContent as Record<string, unknown> }
      : {}),
  };
}

export function registerTools(server: McpServer): void {
  // ─── log_event ─────────────────────────────────────────────
  server.tool(
    'log_event',
    'Append a raw event to the local Bronze JSONL store.',
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

  // ─── search ───────────────────────────────────────────────
  server.tool(
    'search',
    'Search collected Bronze events using case-insensitive full-text matching.',
    {
      query: z.string().min(1),
      max_results: z.number().int().min(1).max(100).optional(),
      source: z.string().optional().describe('Filter by source'),
      type: z.string().optional().describe('Filter by event type'),
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

  // ─── get_tasks ─────────────────────────────────────────────
  server.tool(
    'get_tasks',
    'Query task board from Bronze events.',
    {
      status: z.enum(['active', 'completed', 'failed', 'all']).optional(),
      assigned_to: z.string().optional(),
      task_type: z.string().optional(),
      task_id: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async ({ status, assigned_to, task_type, task_id, limit }) => {
      const result = await getTasks({ status, assigned_to, task_type, task_id, limit });

      if (result.mode === 'history') {
        const { events, totalEvents } = result;
        if (events.length === 0) {
          return toTextResult(`No task events found for task_id "${task_id}"`, result);
        }

        const timeline = events
          .map((ev, i) => {
            const ts = ev.timestamp ?? '?';
            const src = ev.source ?? '?';
            return `${i + 1}. [${ev.type}] ${ts} by ${src}\n   ${ev.content}`;
          })
          .join('\n\n');

        const created = events[0]!;
        const ctx = created.context ?? {};
        const contextSummary = [
          ctx.problem && `Problem: ${ctx.problem}`,
          ctx.impact && `Impact: ${ctx.impact}`,
          ctx.project && `Project: ${ctx.project}`,
          ctx.assigned_to && `Assigned to: ${ctx.assigned_to}`,
        ]
          .filter(Boolean)
          .join('\n');

        return toTextResult(
          `Task ${task_id} — ${totalEvents} events\n\n` +
            (contextSummary ? `--- Context ---\n${contextSummary}\n\n` : '') +
            `--- Timeline ---\n${timeline}`,
          result,
        );
      }

      // Board mode
      const { tasks, total_tasks } = result;
      if (tasks.length === 0) {
        return toTextResult(`No ${status ?? 'active'} tasks found`, result);
      }

      const board = tasks
        .map((t) => {
          const parts = [
            `[${t.task_id}] ${t.status.toUpperCase()}`,
            t.assigned_to ? `→ ${t.assigned_to}` : '→ unassigned',
            t.task_type ? `(${t.task_type})` : '',
          ];
          const header = parts.filter(Boolean).join(' ');
          const lines = [header];
          if (t.summary) lines.push(`  Summary: ${t.summary.slice(0, 200)}`);
          if (t.problem) lines.push(`  Why: ${t.problem}`);
          return lines.join('\n');
        })
        .join('\n\n');

      return toTextResult(
        `Task Board (${status ?? 'active'}) — ${total_tasks} task(s)\n\n${board}`,
        result,
      );
    },
  );

  // ─── deep_search ─────────────────────────────────────────
  server.tool(
    'deep_search',
    'Semantic search over Bronze events using Azure Databricks Vector Search. ' +
      'Finds events by meaning, not just keywords. Requires DATABRICKS_HOST and DATABRICKS_TOKEN.',
    {
      query: z.string().min(1).describe('Natural language search query'),
      num_results: z.number().int().min(1).max(20).optional().describe('Max results (default 5)'),
      source: z.string().optional().describe('Filter by source'),
      type: z.string().optional().describe('Filter by event type'),
      mode: z
        .enum(['hybrid', 'semantic'])
        .optional()
        .describe("'hybrid' (default) = keyword+semantic, 'semantic' = vector only"),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async ({ query, num_results: numResults, source, type, mode }) => {
      try {
        const result = await deepSearch({ query, numResults, source, type, mode });

        if (result.results.length === 0) {
          return toTextResult(`No semantic matches for "${query}"`, result);
        }

        const summary = result.results
          .map((r, i) => {
            const ts = r.timestamp ?? '?';
            const src = r.source ?? '?';
            const typ = r.type ?? '?';
            const content = (r.content ?? '').slice(0, 200);
            return `${i + 1}. [${src}/${typ}] ${ts}\n   ${content}`;
          })
          .join('\n\n');

        return toTextResult(
          `Found ${result.totalResults} semantic match(es) for "${query}" (${result.mode} mode)\n\n${summary}`,
          result,
        );
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes('DATABRICKS_HOST')) {
          return toTextResult(
            'deep_search not configured. Set DATABRICKS_HOST and DATABRICKS_TOKEN env vars. ' +
              'Run Databricks notebooks 01 and 02 first.',
          );
        }
        return toTextResult(`deep_search error: ${msg}`);
      }
    },
  );

  // ─── get_facts ────────────────────────────────────────────
  server.tool(
    'get_facts',
    'Query Gold entities — structured facts extracted from Bronze events. ' +
      'Answers "what do we know about X?" rather than fuzzy search.',
    {
      entity_type: z
        .string()
        .optional()
        .describe('Filter by entity type: decision, fact, project, tool'),
      project: z.string().optional().describe('Filter by project name (partial match)'),
      tag: z.string().optional().describe('Filter by tag (partial match)'),
      query: z.string().optional().describe('Keyword search within entity summaries and data'),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ entity_type, project, tag, query }) => {
      const result = await queryEntities({ entity_type, project, tag, query });

      if (result.total === 0) {
        const filters = [
          entity_type && `type=${entity_type}`,
          project && `project=${project}`,
          tag && `tag=${tag}`,
          query && `query="${query}"`,
        ]
          .filter(Boolean)
          .join(', ');
        return toTextResult(
          `No Gold entities found${filters ? ` (${filters})` : ''} in ${getGoldDir()}`,
          result,
        );
      }

      const lines = result.entities
        .map((e, i) => {
          const meta = [
            e.project && `project=${e.project}`,
            e.tags?.length && `tags=[${e.tags.join(', ')}]`,
            e.source_events?.length && `sources=${e.source_events.length}`,
          ]
            .filter(Boolean)
            .join(' ');
          return `${i + 1}. [${e.entity_type}] ${e.summary}${meta ? `\n   ${meta}` : ''}`;
        })
        .join('\n\n');

      return toTextResult(
        `Found ${result.total} Gold ${result.total === 1 ? 'entity' : 'entities'}\n\n${lines}`,
        result,
      );
    },
  );

  // ─── add_entity ───────────────────────────────────────────
  server.tool(
    'add_entity',
    'Create or update a Gold entity (structured fact). ' +
      'Upserts by summary+project — same summary in same project updates rather than duplicates.',
    {
      entity_type: z
        .string()
        .min(1)
        .describe('Entity type: decision, fact, project, tool, or custom'),
      summary: z.string().min(1).describe('One-sentence summary of the entity'),
      project: z.string().optional().describe('Project this entity belongs to'),
      tags: z.array(z.string()).optional().describe('Tags for filtering'),
      source_events: z
        .array(z.string())
        .optional()
        .describe('Bronze event IDs that inform this entity'),
      data: z.record(z.string(), z.unknown()).optional().describe('Structured entity data'),
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ entity_type, summary, project, tags, source_events, data }) => {
      const result = await upsertEntity({
        entity_type,
        summary,
        project,
        tags,
        source_events,
        data,
      });
      return toTextResult(
        `${result.action === 'created' ? 'Created' : 'Updated'} Gold entity ${result.entity_id} in ${result.file_path}`,
        result,
      );
    },
  );

  // ─── get_questions ────────────────────────────────────────
  server.tool(
    'get_questions',
    'Query async questions between AI agents. ' +
      'Agents post questions via log_event(type="question"), others answer via log_event(type="answer"). ' +
      'Check at session start for pending questions directed to you.',
    {
      directed_to: z
        .string()
        .optional()
        .describe('Filter by who the question is directed to (e.g. "claude-desktop")'),
      status: z
        .enum(['open', 'answered', 'all'])
        .optional()
        .describe('Filter by status: open (unanswered), answered, or all. Default: open'),
      task_id: z.string().optional().describe('Filter by task_id in question context'),
      limit: z.number().optional().describe('Max results to return. Default: 10'),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async ({ directed_to, status, task_id, limit }) => {
      const result = await getQuestions({ directed_to, status, task_id, limit });

      if (result.total === 0) {
        const filters = [
          directed_to && `directed_to=${directed_to}`,
          status && `status=${status}`,
          task_id && `task_id=${task_id}`,
        ]
          .filter(Boolean)
          .join(', ');
        return toTextResult(
          `No questions found${filters ? ` (${filters})` : ''} in ${result.bronzeDir}`,
          result,
        );
      }

      const lines = result.questions
        .map((q, i) => {
          const meta = [
            q.asked_by && `from=${q.asked_by}`,
            q.directed_to && `to=${q.directed_to}`,
            q.task_id && `task=${q.task_id}`,
          ]
            .filter(Boolean)
            .join(' ');
          const statusIcon = q.status === 'open' ? '❓' : '✅';
          let line = `${i + 1}. ${statusIcon} [${q.thread_id}] ${q.question.slice(0, 200)}`;
          if (meta) line += `\n   ${meta}`;
          if (q.answer) line += `\n   → ${q.answer.slice(0, 200)}`;
          return line;
        })
        .join('\n\n');

      return toTextResult(
        `Found ${result.total} question${result.total === 1 ? '' : 's'}\n\n${lines}`,
        result,
      );
    },
  );
}
