import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendEvent, getBronzeDir } from '../dist/bronze-store.js';

let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datacore-test-'));
  process.env.DATACORE_BRONZE_DIR = tmpDir;
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.DATACORE_BRONZE_DIR;
});

describe('log_event (appendEvent)', () => {
  it('writes an event to a JSONL file', async () => {
    const result = await appendEvent({
      source: 'test',
      type: 'conversation',
      content: 'Hello from test',
    });

    assert.ok(result.record._event_id, 'should return an event id');
    assert.ok(result.record._timestamp, 'should return a timestamp');
    assert.equal(result.record.source, 'test');
    assert.equal(result.record.type, 'conversation');
  });

  it('creates a YYYY-MM-DD.jsonl file', async () => {
    await appendEvent({
      source: 'test',
      type: 'action',
      content: 'File creation test',
    });

    const files = await fs.readdir(tmpDir);
    assert.ok(files.length > 0, 'should create at least one file');
    assert.ok(files[0].endsWith('.jsonl'), 'file should be .jsonl');
    assert.match(files[0], /^\d{4}-\d{2}-\d{2}\.jsonl$/, 'filename should be YYYY-MM-DD.jsonl');
  });

  it('stores valid JSON per line', async () => {
    await appendEvent({
      source: 'test',
      type: 'decision',
      content: 'JSON validity test',
      context: { session: 'test-session' },
    });

    const files = await fs.readdir(tmpDir);
    const data = await fs.readFile(path.join(tmpDir, files[0]), 'utf-8');
    const lines = data.trim().split('\n');

    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed._event_id, 'each line should have an _event_id');
      assert.ok(parsed._timestamp, 'each line should have a _timestamp');
      assert.ok(parsed.content, 'each line should have content');
    }
  });

  it('includes context when provided', async () => {
    const result = await appendEvent({
      source: 'test',
      type: 'insight',
      content: 'Context test',
      context: { project: 'datacore', phase: 'testing' },
    });

    const files = await fs.readdir(tmpDir);
    const data = await fs.readFile(path.join(tmpDir, files[0]), 'utf-8');
    const lines = data.trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);

    assert.equal(last.context.project, 'datacore');
    assert.equal(last.context.phase, 'testing');
  });
});
