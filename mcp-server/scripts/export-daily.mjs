#!/usr/bin/env node
// export-daily.mjs — Export Bronze as per-day filtered JSONL files
// Auto Loader needs incremental files — one per day, only new ones get ingested.
// Output: ~/.datacore/export/daily/2026-03-21.jsonl, 2026-03-22.jsonl, etc.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { shouldEmbed, validateForSilver, extractContentSummary } from './embeddable.mjs';

const BRONZE_DIR = process.env.DATACORE_BRONZE_DIR || path.join(os.homedir(), '.datacore', 'bronze');
const EXPORT_DIR = path.join(os.homedir(), '.datacore', 'export', 'daily');
const LOG_DIR = path.join(os.homedir(), '.datacore', 'logs');
const REJECT_LOG = path.join(LOG_DIR, 'rejected-events.log');

function cleanRecord(r, bronzeFile) {
  const content = r.content ?? '';
  const contentSummary = extractContentSummary(content);
  return {
    event_id: r._event_id ?? null,
    timestamp: r._timestamp ?? null,
    source: r._source ?? r.source ?? null,
    type: r.type ?? null,
    content,
    ...(contentSummary !== null ? { content_summary: contentSummary } : {}),
    context_json: r.context ? JSON.stringify(r.context) : null,
    bronze_file: bronzeFile,
  };
}

fs.mkdirSync(EXPORT_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const bronzeFiles = fs.readdirSync(BRONZE_DIR)
  .filter(f => f.endsWith('.jsonl')).sort();

let totalEvents = 0, totalEmbeddable = 0, totalRejected = 0, newFiles = 0, skippedFiles = 0;
const rejections = [];

for (const file of bronzeFiles) {
  const exportPath = path.join(EXPORT_DIR, file);

  // Skip if export already exists and source hasn't changed
  if (fs.existsSync(exportPath)) {
    const srcStat = fs.statSync(path.join(BRONZE_DIR, file));
    const expStat = fs.statSync(exportPath);
    if (expStat.mtimeMs >= srcStat.mtimeMs) {
      skippedFiles++;
      continue;
    }
  }

  const lines = fs.readFileSync(path.join(BRONZE_DIR, file), 'utf8')
    .split('\n').filter(Boolean);
  const records = [];
  for (const line of lines) {
    try { records.push(JSON.parse(line)); }
    catch { /* skip malformed */ }
  }

  const embeddable = records.filter(shouldEmbed);
  const validated = [];
  for (const r of embeddable) {
    const { valid, reasons } = validateForSilver(r);
    if (valid) {
      validated.push(r);
    } else {
      totalRejected++;
      rejections.push({ file, id: r._event_id ?? '?', reasons });
    }
  }
  totalEvents += records.length;
  totalEmbeddable += validated.length;

  if (validated.length === 0) {
    skippedFiles++;
    continue;
  }

  const output = validated.map(r => JSON.stringify(cleanRecord(r, file))).join('\n') + '\n';
  fs.writeFileSync(exportPath, output);
  newFiles++;
  console.log(`  ${file}: ${validated.length}/${records.length} events${totalRejected > 0 ? ` (${rejections.filter(r => r.file === file).length} rejected)` : ''}`);
}

console.log(`\nExport complete:`);
console.log(`  Bronze files:  ${bronzeFiles.length}`);
console.log(`  New/updated:   ${newFiles}`);
console.log(`  Skipped:       ${skippedFiles}`);
console.log(`  Accepted:      ${totalEmbeddable}`);
console.log(`  Rejected:      ${totalRejected}`);
console.log(`  Output dir:    ${EXPORT_DIR}`);

if (rejections.length > 0) {
  const ts = new Date().toISOString();
  const lines = rejections.map(r =>
    `${ts} ${r.file} ${r.id} ${r.reasons.join('; ')}`
  ).join('\n') + '\n';
  fs.appendFileSync(REJECT_LOG, lines);
  console.log(`  Rejection log: ${REJECT_LOG}`);
}
