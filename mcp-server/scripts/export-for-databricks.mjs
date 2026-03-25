#!/usr/bin/env node
// export-for-databricks.mjs — Prepare Bronze data for Databricks upload
// Reads all local JSONL, filters to embeddable events, outputs clean file

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BRONZE_DIR = process.env.DATACORE_BRONZE_DIR || path.join(os.homedir(), '.datacore', 'bronze');
const OUTPUT = process.argv[2] || path.join(os.homedir(), '.datacore', 'export', 'bronze-all.jsonl');

const EMBEDDABLE_TYPES = new Set([
  'assistant_message', 'human_message', 'conversation',
  'decision', 'action', 'insight', 'problem',
  'task_created', 'task_completed', 'task_reviewed', 'task_started',
  'message_preprocessed', 'message_sent',
  'tool_summary', 'response_message', 'agent_message', 'message',
  'tool_result', 'record', 'reasoning',
]);

const MIN_CONTENT_LENGTH = 50;

function readBronzeFiles() {
  const files = fs.readdirSync(BRONZE_DIR).filter(f => f.endsWith('.jsonl')).sort();
  const records = [];
  let parseErrors = 0;
  for (const file of files) {
    const lines = fs.readFileSync(path.join(BRONZE_DIR, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        records.push({ ...JSON.parse(line), _bronze_file: file });
      } catch { parseErrors++; }
    }
  }
  return { records, parseErrors, fileCount: files.length };
}

function shouldEmbed(record) {
  if (!EMBEDDABLE_TYPES.has(record.type ?? '')) return false;
  if ((record.content ?? '').length < MIN_CONTENT_LENGTH) return false;
  return true;
}

const { records, parseErrors, fileCount } = readBronzeFiles();
const embeddable = records.filter(shouldEmbed);

const clean = embeddable.map(r => ({
  event_id: r._event_id ?? null,
  timestamp: r._timestamp ?? null,
  source: r._source ?? r.source ?? null,
  type: r.type ?? null,
  content: r.content ?? '',
  context_json: r.context ? JSON.stringify(r.context) : null,
  bronze_file: r._bronze_file ?? null,
}));

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, clean.map(r => JSON.stringify(r)).join('\n') + '\n');

console.log(`Bronze files:     ${fileCount}`);
console.log(`Total events:     ${records.length}`);
console.log(`Parse errors:     ${parseErrors}`);
console.log(`Embeddable:       ${embeddable.length}`);
console.log(`Output:           ${OUTPUT}`);
console.log(`Output size:      ${(fs.statSync(OUTPUT).size / 1024 / 1024).toFixed(1)} MB`);
