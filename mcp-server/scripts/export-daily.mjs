#!/usr/bin/env node
// export-daily.mjs — Export Bronze as per-day filtered JSONL files
// Auto Loader needs incremental files — one per day, only new ones get ingested.
// Output: ~/.datacore/export/daily/2026-03-21.jsonl, 2026-03-22.jsonl, etc.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { shouldEmbed } from './embeddable.mjs';

const BRONZE_DIR = process.env.DATACORE_BRONZE_DIR || path.join(os.homedir(), '.datacore', 'bronze');
const EXPORT_DIR = path.join(os.homedir(), '.datacore', 'export', 'daily');

function cleanRecord(r, bronzeFile) {
  return {
    event_id: r._event_id ?? null,
    timestamp: r._timestamp ?? null,
    source: r._source ?? r.source ?? null,
    type: r.type ?? null,
    content: r.content ?? '',
    context_json: r.context ? JSON.stringify(r.context) : null,
    bronze_file: bronzeFile,
  };
}

fs.mkdirSync(EXPORT_DIR, { recursive: true });

const bronzeFiles = fs.readdirSync(BRONZE_DIR)
  .filter(f => f.endsWith('.jsonl')).sort();

let totalEvents = 0, totalEmbeddable = 0, newFiles = 0, skippedFiles = 0;

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
  totalEvents += records.length;
  totalEmbeddable += embeddable.length;

  if (embeddable.length === 0) {
    skippedFiles++;
    continue;
  }

  const output = embeddable.map(r => JSON.stringify(cleanRecord(r, file))).join('\n') + '\n';
  fs.writeFileSync(exportPath, output);
  newFiles++;
  console.log(`  ${file}: ${embeddable.length}/${records.length} events`);
}

console.log(`\nExport complete:`);
console.log(`  Bronze files:  ${bronzeFiles.length}`);
console.log(`  New/updated:   ${newFiles}`);
console.log(`  Skipped:       ${skippedFiles}`);
console.log(`  Output dir:    ${EXPORT_DIR}`);
