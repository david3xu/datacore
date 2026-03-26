// embeddable.mjs — Which event types are worth embedding?
// Shared between export-for-databricks.mjs and export-daily.mjs.
// Single source of truth for what goes to Databricks Silver layer.

export const EMBEDDABLE_TYPES = new Set([
  'assistant_message', 'human_message', 'conversation',
  'decision', 'action', 'insight', 'problem',
  'task_created', 'task_completed', 'task_reviewed', 'task_started',
  'message_preprocessed', 'message_sent',
  'tool_summary', 'response_message', 'agent_message', 'message',
  'tool_result', 'record', 'reasoning',
]);

export const MIN_CONTENT_LENGTH = 50;

export function shouldEmbed(record) {
  if (!EMBEDDABLE_TYPES.has(record.type ?? '')) return false;
  if ((record.content ?? '').length < MIN_CONTENT_LENGTH) return false;
  return true;
}
