// gold-store.ts — How are Gold entities stored and retrieved?
// Primary backend: Cosmos DB (when COSMOS_ENDPOINT + COSMOS_KEY are set).
// Fallback backend: per-type JSONL files at $DATACORE_GOLD_DIR or ~/.datacore/gold/.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type {
  GoldEntity,
  AddEntityInput,
  AddEntityResult,
  GetFactsInput,
  GetFactsResult,
} from './types.js';
import { isCosmosEnabled, getGoldContainer } from './cosmos-client.js';

function pluralize(word: string): string {
  if (word.endsWith('y')) return word.slice(0, -1) + 'ies';
  if (word.endsWith('s') || word.endsWith('x') || word.endsWith('sh') || word.endsWith('ch'))
    return word + 'es';
  return word + 's';
}

function resolveGoldDir(): string {
  return process.env.DATACORE_GOLD_DIR || path.join(os.homedir(), '.datacore', 'gold');
}

export function getGoldDir(): string {
  return resolveGoldDir();
}

function goldFilePath(entityType: string): string {
  return path.join(resolveGoldDir(), `${pluralize(entityType)}.jsonl`);
}

export async function readGoldEntities(entityType?: string): Promise<GoldEntity[]> {
  if (isCosmosEnabled()) {
    return readGoldEntitiesFromCosmos(entityType);
  }
  return readGoldEntitiesFromJsonl(entityType);
}

async function readGoldEntitiesFromCosmos(entityType?: string): Promise<GoldEntity[]> {
  const container = await getGoldContainer();
  const querySpec = entityType
    ? {
        query: 'SELECT * FROM c WHERE c.entity_type = @et',
        parameters: [{ name: '@et', value: entityType }],
      }
    : { query: 'SELECT * FROM c' };
  const { resources } = await container.items.query<GoldEntity>(querySpec).fetchAll();
  return resources;
}

async function readGoldEntitiesFromJsonl(entityType?: string): Promise<GoldEntity[]> {
  const goldDir = resolveGoldDir();

  let filePaths: string[];
  if (entityType) {
    filePaths = [goldFilePath(entityType)];
  } else {
    try {
      const entries = await fs.readdir(goldDir, { withFileTypes: true });
      filePaths = entries
        .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
        .map((e) => path.join(goldDir, e.name));
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  const entities: GoldEntity[] = [];
  for (const filePath of filePaths) {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const entity = JSON.parse(line) as GoldEntity;
        entities.push(entity);
      } catch {
        // skip malformed lines
      }
    }
  }
  return entities;
}

function contentHash(summary: string, project: string): string {
  return createHash('sha256')
    .update(`${summary.toLowerCase().trim()}::${(project ?? '').toLowerCase().trim()}`)
    .digest('hex')
    .slice(0, 16);
}

export async function upsertEntity(input: AddEntityInput): Promise<AddEntityResult> {
  if (isCosmosEnabled()) {
    return upsertEntityToCosmos(input);
  }
  return upsertEntityToJsonl(input);
}

async function upsertEntityToCosmos(input: AddEntityInput): Promise<AddEntityResult> {
  const container = await getGoldContainer();
  const { entity_type, summary, project = '', tags = [], source_events = [], data } = input;
  const hash = contentHash(summary, project);
  const now = new Date().toISOString();

  // Check for duplicate by content hash
  const { resources } = await container.items
    .query<
      GoldEntity & { id: string }
    >({ query: 'SELECT * FROM c WHERE c.entity_type = @et', parameters: [{ name: '@et', value: entity_type }] })
    .fetchAll();

  const duplicate = resources.find((e) => contentHash(e.summary, e.project ?? '') === hash);

  if (duplicate) {
    const updated: GoldEntity = {
      ...duplicate,
      tags: Array.from(new Set([...(duplicate.tags ?? []), ...tags])),
      source_events: Array.from(new Set([...(duplicate.source_events ?? []), ...source_events])),
      data: data !== undefined ? data : duplicate.data,
      updated_at: now,
    };
    await container.items.upsert({ ...updated, id: duplicate.entity_id });
    return { entity_id: updated.entity_id, file_path: 'cosmos://datacore/gold', action: 'updated' };
  }

  const entity: GoldEntity = {
    entity_type,
    entity_id: randomUUID(),
    summary,
    project: project || undefined,
    tags,
    source_events,
    data,
    created_at: now,
    updated_at: now,
  };
  await container.items.create({ ...entity, id: entity.entity_id });
  return { entity_id: entity.entity_id, file_path: 'cosmos://datacore/gold', action: 'created' };
}

async function upsertEntityToJsonl(input: AddEntityInput): Promise<AddEntityResult> {
  const goldDir = resolveGoldDir();
  await fs.mkdir(goldDir, { recursive: true });

  const { entity_type, summary, project = '', tags = [], source_events = [], data } = input;
  const filePath = goldFilePath(entity_type);
  const hash = contentHash(summary, project);

  const existing = await readGoldEntities(entity_type);
  const duplicate = existing.find((e) => contentHash(e.summary, e.project ?? '') === hash);
  const now = new Date().toISOString();

  if (duplicate) {
    const updated: GoldEntity = {
      ...duplicate,
      tags: Array.from(new Set([...(duplicate.tags ?? []), ...tags])),
      source_events: Array.from(new Set([...(duplicate.source_events ?? []), ...source_events])),
      data: data !== undefined ? data : duplicate.data,
      updated_at: now,
    };
    const others = existing.filter((e) => contentHash(e.summary, e.project ?? '') !== hash);
    const all = [...others, updated];
    await fs.writeFile(filePath, all.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
    return { entity_id: updated.entity_id, file_path: filePath, action: 'updated' };
  }

  const entity: GoldEntity = {
    entity_type,
    entity_id: randomUUID(),
    summary,
    project: project || undefined,
    tags,
    source_events,
    data,
    created_at: now,
    updated_at: now,
  };
  await fs.appendFile(filePath, `${JSON.stringify(entity)}\n`, 'utf8');
  return { entity_id: entity.entity_id, file_path: filePath, action: 'created' };
}

export async function queryEntities(input: GetFactsInput): Promise<GetFactsResult> {
  const { entity_type, project, tag, query } = input;
  const all = await readGoldEntities(entity_type);

  let filtered = all;

  if (project) {
    filtered = filtered.filter((e) =>
      (e.project ?? '').toLowerCase().includes(project.toLowerCase()),
    );
  }

  if (tag) {
    filtered = filtered.filter((e) =>
      (e.tags ?? []).some((t) => t.toLowerCase().includes(tag.toLowerCase())),
    );
  }

  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.summary.toLowerCase().includes(q) ||
        JSON.stringify(e.data ?? '')
          .toLowerCase()
          .includes(q),
    );
  }

  return { entities: filtered, total: filtered.length };
}
