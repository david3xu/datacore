import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, searchEvents } from '../dist/bronze-store.js';

let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datacore-test-'));
  process.env.DATACORE_BRONZE_DIR = tmpDir;

  // Seed test data
  await appendEvent({
    source: 'claude.ai',
    type: 'decision',
    content: 'Chose MCP over REST for agent communication',
  });
  await appendEvent({
    source: 'openclaw',
    type: 'action',
    content: 'Deployed gateway with rate limit fix',
  });
  await appendEvent({
    source: 'claude-desktop',
    type: 'conversation',
    content: 'Discussed memory architecture layers',
  });
  await appendEvent({
    source: 'codex-session',
    type: 'insight',
    content: 'TypeScript catches more errors than plain JS',
  });
  await appendEvent({
    source: 'claude.ai',
    type: 'decision',
    content: 'Bronze store uses JSONL not SQLite',
  });
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.DATACORE_BRONZE_DIR;
});

describe('search', () => {
  it('finds events by content keyword', async () => {
    const results = await searchEvents({ query: 'MCP' });
    assert.ok(results.results.length >= 1, 'should find at least 1 MCP event');
    assert.ok(
      results.results.some((r) => r.snippet.includes('MCP')),
      'result should contain MCP in snippet',
    );
  });

  it('returns empty for non-matching query', async () => {
    const results = await searchEvents({ query: 'xyznonexistent123' });
    assert.equal(results.results.length, 0, 'should find no results');
  });

  it('is case-insensitive', async () => {
    const lower = await searchEvents({ query: 'mcp' });
    const upper = await searchEvents({ query: 'MCP' });
    assert.equal(lower.results.length, upper.results.length, 'case should not matter');
  });

  it('filters by source', async () => {
    const results = await searchEvents({ query: 'decision', source: 'claude.ai' });
    for (const r of results.results) {
      assert.equal(r.source, 'claude.ai', 'all results should be from claude.ai');
    }
  });

  it('filters by type', async () => {
    const results = await searchEvents({ query: 'architecture', type: 'conversation' });
    for (const r of results.results) {
      assert.equal(r.type, 'conversation', 'all results should be conversations');
    }
  });

  it('respects maxResults', async () => {
    const results = await searchEvents({ query: 'e', maxResults: 2 });
    assert.ok(results.results.length <= 2, 'should return at most 2 results');
  });

  it('returns metadata with results', async () => {
    const results = await searchEvents({ query: 'MCP' });
    const first = results.results[0];
    assert.ok(first.eventId, 'result should have eventId');
    assert.ok(first.timestamp, 'result should have timestamp');
    assert.ok(first.source, 'result should have source');
    assert.ok(first.type, 'result should have type');
    assert.ok(first.snippet, 'result should have snippet');
  });
});
