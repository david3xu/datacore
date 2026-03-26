#!/usr/bin/env node
// promote-to-gold.mjs — Promote structured Bronze events to Gold entities

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const BRONZE_DIR = process.env.DATACORE_BRONZE_DIR || path.join(os.homedir(), '.datacore', 'bronze');
const GOLD_DIR = process.env.DATACORE_GOLD_DIR || path.join(os.homedir(), '.datacore', 'gold');

const PROMOTABLE_TYPES = new Set(['decision', 'action', 'insight', 'problem']);

function contentHash(summary, project) {
  return createHash('sha256')
    .update(`${summary.toLowerCase().trim()}::${(project ?? '').toLowerCase().trim()}`)
    .digest('hex')
    .slice(0, 16);
}

async function readBronzeEvents() {
  let files;
  try {
    const entries = await fs.readdir(BRONZE_DIR, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => path.join(BRONZE_DIR, e.name));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const events = [];
  for (const filePath of files) {
    const raw = await fs.readFile(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const event = JSON.parse(line);
        if (PROMOTABLE_TYPES.has(event.type)) {
          events.push(event);
        }
      } catch {
        // skip malformed lines
      }
    }
  }
  return events;
}

async function readExistingHashes(entityType) {
  const filePath = path.join(GOLD_DIR, `${entityType}s.jsonl`);
  const hashes = new Set();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const entity = JSON.parse(line);
        hashes.add(contentHash(entity.summary, entity.project ?? ''));
      } catch {
        // skip
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return hashes;
}

async function appendGoldEntity(entity) {
  const filePath = path.join(GOLD_DIR, `${entity.entity_type}s.jsonl`);
  await fs.appendFile(filePath, `${JSON.stringify(entity)}\n`, 'utf8');
}

async function main() {
  await fs.mkdir(GOLD_DIR, { recursive: true });

  const events = await readBronzeEvents();
  console.log(`Found ${events.length} promotable Bronze events`);

  // Pre-load existing hashes per entity type
  const hashCache = {};
  for (const type of PROMOTABLE_TYPES) {
    hashCache[type] = await readExistingHashes(type);
  }

  let promoted = 0;
  let skipped = 0;

  for (const event of events) {
    const summary = (event.content ?? '').slice(0, 500).trim();
    if (!summary) { skipped++; continue; }

    const project = event.context?.project ?? '';
    const hash = contentHash(summary, project);
    const existingHashes = hashCache[event.type] ?? new Set();

    if (existingHashes.has(hash)) {
      skipped++;
      continue;
    }

    const now = new Date().toISOString();
    const entity = {
      entity_type: event.type,
      entity_id: randomUUID(),
      summary,
      project: project || undefined,
      tags: event.context?.tags ?? [],
      source_events: [event._event_id].filter(Boolean),
      data: event.context ?? undefined,
      created_at: now,
      updated_at: now,
    };

    await appendGoldEntity(entity);
    existingHashes.add(hash);
    promoted++;
  }

  console.log(
    `Promoted ${promoted} events → ${promoted} unique Gold entities (${skipped} duplicates skipped)`
  );
}

main().catch((err) => {
  console.error('promote-to-gold failed:', err.message);
  process.exit(1);
});
