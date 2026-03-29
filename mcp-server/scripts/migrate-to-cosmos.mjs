#!/usr/bin/env node
// scripts/migrate-to-cosmos.mjs — One-time migration from local JSONL → Cosmos DB
//
// Usage:
//   COSMOS_ENDPOINT=https://cosmos-datacore.documents.azure.com:443/ \
//   COSMOS_KEY=<primary-key> \
//   node mcp-server/scripts/migrate-to-cosmos.mjs [--dry-run]
//
// Idempotent: uses upsert so safe to run multiple times.
// Skips records whose _event_id / entity_id already exist in Cosmos.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { CosmosClient } from '@azure/cosmos';

const DRY_RUN = process.argv.includes('--dry-run');
const DB = 'datacore';

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;

if (!endpoint || !key) {
  console.error('ERROR: COSMOS_ENDPOINT and COSMOS_KEY must be set.');
  process.exit(1);
}

const client = new CosmosClient({ endpoint, key });
const bronzeContainer = client.database(DB).container('bronze');
const goldContainer = client.database(DB).container('gold');

const bronzeDir = process.env.DATACORE_BRONZE_DIR ?? join(os.homedir(), '.datacore', 'bronze');
const goldDir = process.env.DATACORE_GOLD_DIR ?? join(os.homedir(), '.datacore', 'gold');

// ─── Bronze migration ─────────────────────────────────────────────────────────

async function migrateBronze() {
  console.log(`\n=== Bronze migration from ${bronzeDir} ===`);
  let files;
  try {
    const entries = await readdir(bronzeDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => join(bronzeDir, e.name))
      .sort();
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('Bronze dir not found — nothing to migrate.');
      return;
    }
    throw err;
  }

  console.log(`Found ${files.length} JSONL file(s).`);
  let total = 0;
  let skipped = 0;
  let errors = 0;

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    console.log(`  ${filePath} — ${lines.length} events`);

    const records = [];
    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        if (record._event_id) records.push({ ...record, id: record._event_id });
        else errors += 1;
      } catch {
        errors += 1;
      }
    }

    if (!DRY_RUN) {
      // Parallel upserts in batches of 50
      const BATCH = 50;
      for (let i = 0; i < records.length; i += BATCH) {
        const chunk = records.slice(i, i + BATCH);
        const results = await Promise.allSettled(chunk.map((r) => bronzeContainer.items.upsert(r)));
        for (const r of results) {
          if (r.status === 'fulfilled') total += 1;
          else if (r.reason?.code === 409) skipped += 1;
          else { console.error(`    ERROR: ${r.reason?.message}`); errors += 1; }
        }
      }
    } else {
      total += records.length;
    }
  }

  console.log(`Bronze: ${total} upserted, ${skipped} already existed, ${errors} errors.`);
}

// ─── Gold migration ───────────────────────────────────────────────────────────

async function migrateGold() {
  console.log(`\n=== Gold migration from ${goldDir} ===`);
  let files;
  try {
    const entries = await readdir(goldDir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
      .map((e) => join(goldDir, e.name))
      .sort();
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('Gold dir not found — nothing to migrate.');
      return;
    }
    throw err;
  }

  console.log(`Found ${files.length} JSONL file(s).`);
  let total = 0;
  let skipped = 0;
  let errors = 0;

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    console.log(`  ${filePath} — ${lines.length} entities`);

    const entities = [];
    for (const line of lines) {
      try {
        const entity = JSON.parse(line);
        if (entity.entity_id) entities.push({ ...entity, id: entity.entity_id });
        else errors += 1;
      } catch {
        errors += 1;
      }
    }

    if (!DRY_RUN) {
      const results = await Promise.allSettled(entities.map((e) => goldContainer.items.upsert(e)));
      for (const r of results) {
        if (r.status === 'fulfilled') total += 1;
        else if (r.reason?.code === 409) skipped += 1;
        else { console.error(`    ERROR: ${r.reason?.message}`); errors += 1; }
      }
    } else {
      total += entities.length;
    }
  }

  console.log(`Gold: ${total} upserted, ${skipped} already existed, ${errors} errors.`);
}

// ─── Verify connectivity ──────────────────────────────────────────────────────

async function verify() {
  console.log('\n=== Verifying Cosmos connectivity ===');
  const { resource } = await client.database(DB).read();
  console.log(`Connected to database: ${resource.id}`);

  const { resources: bronzeItems } = await bronzeContainer.items.query('SELECT VALUE COUNT(1) FROM c').fetchAll();
  const { resources: goldItems } = await goldContainer.items.query('SELECT VALUE COUNT(1) FROM c').fetchAll();
  console.log(`Bronze container: ${bronzeItems[0] ?? 0} documents`);
  console.log(`Gold container:   ${goldItems[0] ?? 0} documents`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log('DRY RUN — no writes will be made.\n');
}

try {
  await verify();
  await migrateBronze();
  await migrateGold();
  console.log('\nMigration complete.');
  if (DRY_RUN) {
    console.log('(No data was written — remove --dry-run to apply.)');
  }
} catch (err) {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
}
