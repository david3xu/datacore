// gold-store.test.mjs — Does Gold entity CRUD work correctly?

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

// Import from dist (tests always run against compiled output)
const distPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist');
const { upsertEntity, queryEntities, readGoldEntities, getGoldDir } = await import(
  path.join(distPath, 'gold-store.js')
);

let tempDir;

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datacore-gold-'));
  process.env.DATACORE_GOLD_DIR = tempDir;
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  delete process.env.DATACORE_GOLD_DIR;
});

test('getGoldDir returns env-configured path', () => {
  assert.equal(getGoldDir(), tempDir);
});

test('upsertEntity creates a new entity', async () => {
  const result = await upsertEntity({
    entity_type: 'decision',
    summary: 'Chose Databricks Vector Search over local LanceDB',
    project: 'datacore',
    tags: ['databricks', 'architecture'],
    source_events: ['evt-001'],
  });

  assert.equal(result.action, 'created');
  assert.ok(result.entity_id.length > 0);
  assert.ok(result.file_path.endsWith('decisions.jsonl'));
});

test('upsertEntity returns same entity_id on duplicate summary+project', async () => {
  const first = await upsertEntity({
    entity_type: 'fact',
    summary: 'Azure Databricks is free for students',
    project: 'datacore',
    tags: ['azure'],
  });

  const second = await upsertEntity({
    entity_type: 'fact',
    summary: 'Azure Databricks is free for students',
    project: 'datacore',
    tags: ['cost'],
    source_events: ['evt-002'],
  });

  assert.equal(second.action, 'updated');
  assert.equal(second.entity_id, first.entity_id);
});

test('upsertEntity merges tags on update', async () => {
  await upsertEntity({
    entity_type: 'tool',
    summary: 'deep_search uses Databricks Vector Search',
    project: 'datacore',
    tags: ['databricks'],
  });

  await upsertEntity({
    entity_type: 'tool',
    summary: 'deep_search uses Databricks Vector Search',
    project: 'datacore',
    tags: ['vector-search'],
  });

  const all = await readGoldEntities('tool');
  const entity = all.find((e) => e.summary === 'deep_search uses Databricks Vector Search');
  assert.ok(entity, 'entity should exist');
  assert.ok(entity.tags.includes('databricks'));
  assert.ok(entity.tags.includes('vector-search'));
});

test('queryEntities filters by entity_type', async () => {
  const result = await queryEntities({ entity_type: 'decision' });
  assert.ok(result.total >= 1);
  assert.ok(result.entities.every((e) => e.entity_type === 'decision'));
});

test('queryEntities filters by project', async () => {
  const result = await queryEntities({ project: 'datacore' });
  assert.ok(result.total >= 1);
  assert.ok(result.entities.every((e) => (e.project ?? '').includes('datacore')));
});

test('queryEntities filters by tag', async () => {
  const result = await queryEntities({ tag: 'databricks' });
  assert.ok(result.total >= 1);
  assert.ok(result.entities.every((e) => (e.tags ?? []).some((t) => t.includes('databricks'))));
});

test('queryEntities filters by keyword query', async () => {
  const result = await queryEntities({ query: 'LanceDB' });
  assert.ok(result.total >= 1);
  assert.ok(result.entities.some((e) => e.summary.toLowerCase().includes('lancedb')));
});

test('queryEntities returns empty result for unknown type', async () => {
  const result = await queryEntities({ entity_type: 'nonexistent' });
  assert.equal(result.total, 0);
  assert.deepEqual(result.entities, []);
});
