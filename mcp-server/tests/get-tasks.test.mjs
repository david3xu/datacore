import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendEvent } from '../dist/store.js';
import { getTasks } from '../dist/tasks.js';

let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datacore-test-'));
  process.env.DATACORE_BRONZE_DIR = tmpDir;

  // Seed task lifecycle events
  await appendEvent({
    source: 'claude.ai',
    type: 'task_created',
    content: 'Add Prettier formatter to datacore',
    context: { task_id: 'T1', status: 'created', assigned_to: 'codex' },
  });
  await appendEvent({
    source: 'openclaw',
    type: 'task_started',
    content: 'Starting Prettier setup',
    context: { task_id: 'T1', status: 'in_progress', assigned_to: 'codex' },
  });
  await appendEvent({
    source: 'claude.ai',
    type: 'task_created',
    content: 'Write unit tests for MCP tools',
    context: { task_id: 'T2', status: 'created', assigned_to: 'claude' },
  });
  await appendEvent({
    source: 'codex-session',
    type: 'task_completed',
    content: 'Prettier configured and all files formatted',
    context: { task_id: 'T1', status: 'completed', assigned_to: 'codex' },
  });
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.DATACORE_BRONZE_DIR;
});

describe('get_tasks', () => {
  it('returns active tasks by default', async () => {
    const result = await getTasks({ status: 'active' });
    assert.ok(result.tasks, 'should have tasks array');
    const active = result.tasks.filter((t) => t.status !== 'completed');
    assert.ok(active.length >= 1, 'should have at least 1 active task');
  });

  it('returns completed tasks when filtered', async () => {
    const result = await getTasks({ status: 'completed' });
    for (const task of result.tasks) {
      assert.equal(task.status, 'completed', 'all should be completed');
    }
  });

  it('returns all tasks when status is all', async () => {
    const result = await getTasks({ status: 'all' });
    assert.ok(result.tasks.length >= 2, 'should return both tasks');
  });

  it('returns full history for a specific task_id', async () => {
    const result = await getTasks({ task_id: 'T1' });
    assert.equal(result.mode, 'history', 'should be in history mode');
    assert.equal(result.task_id, 'T1');
    assert.ok(result.events.length >= 3, 'T1 should have 3 lifecycle events');
  });

  it('filters by assigned_to', async () => {
    const result = await getTasks({ status: 'all', assigned_to: 'claude' });
    for (const task of result.tasks) {
      assert.equal(task.assigned_to, 'claude', 'all should be assigned to claude');
    }
  });

  it('respects limit', async () => {
    const result = await getTasks({ status: 'all', limit: 1 });
    assert.ok(result.tasks.length <= 1, 'should return at most 1 task');
  });
});
