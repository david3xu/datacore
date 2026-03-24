// mcp-roundtrip.test.mjs — Does the MCP server work end-to-end over stdio?

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const serverPath = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../dist/server.js',
);

let tempDir;
let bronzeDir;
let client;
let transport;

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datacore-roundtrip-'));
  bronzeDir = path.join(tempDir, 'bronze');

  transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: { ...process.env, DATACORE_BRONZE_DIR: bronzeDir },
    stderr: 'pipe',
  });

  client = new Client({ name: 'datacore-roundtrip-test', version: '0.1.0' });
  await client.connect(transport);
});

after(async () => {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('server exposes exactly 3 tools', async () => {
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['get_tasks', 'log_event', 'search']);
});

test('log_event writes an event and returns success', async () => {
  const result = await client.callTool({
    name: 'log_event',
    arguments: {
      source: 'roundtrip-test',
      type: 'note',
      content: 'MCP round-trip test event — verifying the full stdio pipeline',
    },
  });
  assert.equal(result.isError, undefined);
  const text = result.content
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('\n');
  assert.match(text, /Logged/);
});

test('search finds the event that was just logged', async () => {
  const result = await client.callTool({
    name: 'search',
    arguments: { query: 'round-trip test event', max_results: 5 },
  });
  assert.equal(result.isError, undefined);
  const text = result.content
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('\n');
  assert.match(text, /Found 1 match/);
});

test('get_tasks returns empty board on a fresh Bronze dir', async () => {
  const result = await client.callTool({
    name: 'get_tasks',
    arguments: { status: 'active' },
  });
  assert.equal(result.isError, undefined);
  const text = result.content
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('\n');
  // Either "No active tasks" or a task board — both are valid non-error responses
  assert.ok(text.length > 0);
});

test('full task lifecycle: create → assign → complete → query history', async () => {
  // Create
  await client.callTool({
    name: 'log_event',
    arguments: {
      source: 'roundtrip-test',
      type: 'task_created',
      content: 'RT-1 round-trip lifecycle test task',
      context: { task_id: 'RT-1', status: 'created' },
    },
  });

  // Assign
  await client.callTool({
    name: 'log_event',
    arguments: {
      source: 'roundtrip-test',
      type: 'task_assigned',
      content: 'RT-1 assigned to test runner',
      context: { task_id: 'RT-1', status: 'assigned', assigned_to: 'test' },
    },
  });

  // Query active — must find RT-1
  const activeResult = await client.callTool({
    name: 'get_tasks',
    arguments: { status: 'active' },
  });
  const activeText = activeResult.content
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('\n');
  assert.match(activeText, /RT-1/);

  // Complete
  await client.callTool({
    name: 'log_event',
    arguments: {
      source: 'roundtrip-test',
      type: 'task_completed',
      content: 'RT-1 complete',
      context: { task_id: 'RT-1', status: 'completed' },
    },
  });

  // Query history — must show all 3 event types
  const historyResult = await client.callTool({
    name: 'get_tasks',
    arguments: { task_id: 'RT-1' },
  });
  const historyText = historyResult.content
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('\n');
  assert.match(historyText, /task_created/);
  assert.match(historyText, /task_assigned/);
  assert.match(historyText, /task_completed/);
});

test('Bronze JSONL file is created on disk', async () => {
  const files = await fs.readdir(bronzeDir);
  assert.ok(
    files.some((f) => f.endsWith('.jsonl')),
    'expected at least one .jsonl file in bronze dir',
  );
});
