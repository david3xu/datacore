// embeddable.mjs — Which event types are worth embedding? What's valid for Silver?
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


// Known sources — events from unknown sources get flagged
export const KNOWN_SOURCES = new Set([
  'claude', 'claude-agent', 'claude.ai', 'claude-desktop', 'claude-web', 'claude-cowork',
  'codex', 'codex-session',
  'gemini', 'gemini-session',
  'openclaw', 'openclaw-session',
  'log-session-sh',
]);

const MAX_CONTENT_LENGTH = 50_000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// Validate an event for Silver ingestion. Returns { valid, reasons[] }
export function validateForSilver(record) {
  const reasons = [];

  if (!record._event_id) reasons.push('missing _event_id');
  if (!record._timestamp) {
    reasons.push('missing _timestamp');
  } else if (!ISO_DATE_RE.test(record._timestamp)) {
    reasons.push(`invalid _timestamp: ${String(record._timestamp).slice(0, 30)}`);
  }

  const source = record._source ?? record.source;
  if (!source) {
    reasons.push('missing source');
  } else if (!KNOWN_SOURCES.has(source)) {
    reasons.push(`unknown source: ${source}`);
  }

  if (!record.type) reasons.push('missing type');
  const content = record.content ?? '';
  if (typeof content !== 'string') {
    reasons.push('content is not a string');
  } else if (content.length < MIN_CONTENT_LENGTH) {
    reasons.push(`content too short (${content.length} < ${MIN_CONTENT_LENGTH})`);
  } else if (content.length > MAX_CONTENT_LENGTH) {
    reasons.push(`content too long (${content.length} > ${MAX_CONTENT_LENGTH})`);
  }

  return { valid: reasons.length === 0, reasons };
}

const SUMMARY_MIN_CONTENT_LENGTH = 200;

/**
 * Extract a compact summary from event content for better Silver embeddings.
 * Rule-based only — no LLM calls. For content >200 chars: first sentence + key entities.
 * Returns null for short content (embed as-is).
 */
export function extractContentSummary(content) {
  if (!content || content.length < SUMMARY_MIN_CONTENT_LENGTH) {
    return null;
  }

  const firstSentenceMatch = content.match(/^(.{20,300}?[.!?])(?:\s|$)/s);
  const firstSentence = firstSentenceMatch
    ? firstSentenceMatch[1].trim()
    : content.slice(0, 200).trim();

  const entityPattern =
    /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*|[A-Z]{2,}|v\d+\.\d+[\w.]*|R\d{1,3}(?:-\w+)?)\b/g;
  const entities = [...new Set((content.match(entityPattern) ?? []))].slice(0, 8);

  const summary = entities.length > 0
    ? `${firstSentence} [${entities.join(', ')}]`
    : firstSentence;

  return summary.length < content.length * 0.8 ? summary : null;
}
