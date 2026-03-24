#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, StdioClientTransport } from "../dist/runtime-deps.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "datacore-mcp-smoke-"));
const bronzeDir = path.join(tempDir, "bronze");
const serverPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../dist/index.js");

const transport = new StdioClientTransport({
  command: "node",
  args: [serverPath],
  env: {
    ...process.env,
    DATACORE_BRONZE_DIR: bronzeDir,
  },
  stderr: "pipe",
});

if (transport.stderr) {
  transport.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      process.stderr.write(`${text}\n`);
    }
  });
}

const client = new Client({
  name: "datacore-smoke",
  version: "0.1.0",
});

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["get_tasks", "log_event", "search"]);

  const logResult = await client.callTool({
    name: "log_event",
    arguments: {
      source: "smoke-test",
      type: "note",
      content: "Azure account check for datacore MCP smoke test",
      context: {
        test: true,
      },
    },
  });

  assert.equal(logResult.isError, undefined);

  const searchResult = await client.callTool({
    name: "search",
    arguments: {
      query: "azure account",
      max_results: 5,
    },
  });

  assert.equal(searchResult.isError, undefined);
  assert.ok(Array.isArray(searchResult.content));

  const responseText = searchResult.content
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n");

  assert.match(responseText, /Found 1 match/);

  // ─── Task lifecycle test ──────────────────────────────────────────
  // Create a task
  const taskCreateResult = await client.callTool({
    name: "log_event",
    arguments: {
      source: "smoke-test",
      type: "task_created",
      content: "Smoke test task — verify get_tasks tool works end to end. This tests the full task lifecycle: create, assign, complete, query.",
      context: {
        task_id: "SMOKE-1",
        task_type: "test",
        status: "created",
        problem: "Need to verify task management tools work",
        impact: "Without this, we can't trust task queries",
        project: "datacore",
        workflow_stage: "BUILD",
        phase: "phase-1",
        pattern: "Standard smoke test pattern",
        acceptance: ["get_tasks returns the task", "status is correct"],
        tags: ["smoke-test"],
      },
    },
  });
  assert.equal(taskCreateResult.isError, undefined);

  // Assign the task
  await client.callTool({
    name: "log_event",
    arguments: {
      source: "smoke-test",
      type: "task_assigned",
      content: "SMOKE-1 assigned to smoke test runner for automated verification.",
      context: { task_id: "SMOKE-1", status: "assigned", assigned_to: "smoke-test" },
    },
  });

  // Query active tasks — should find SMOKE-1
  const activeTasksResult = await client.callTool({
    name: "get_tasks",
    arguments: { status: "active" },
  });
  assert.equal(activeTasksResult.isError, undefined);
  const activeText = activeTasksResult.content
    .filter((e) => e.type === "text")
    .map((e) => e.text)
    .join("\n");
  assert.match(activeText, /SMOKE-1/);
  assert.match(activeText, /ASSIGNED/);

  // Complete the task
  await client.callTool({
    name: "log_event",
    arguments: {
      source: "smoke-test",
      type: "task_completed",
      content: "SMOKE-1 complete. All assertions passed. Task lifecycle works.",
      context: { task_id: "SMOKE-1", status: "completed" },
    },
  });

  // Query task history
  const historyResult = await client.callTool({
    name: "get_tasks",
    arguments: { task_id: "SMOKE-1" },
  });
  assert.equal(historyResult.isError, undefined);
  const historyText = historyResult.content
    .filter((e) => e.type === "text")
    .map((e) => e.text)
    .join("\n");
  assert.match(historyText, /task_created/);
  assert.match(historyText, /task_assigned/);
  assert.match(historyText, /task_completed/);

  // Query with source filter on search
  const filteredSearch = await client.callTool({
    name: "search",
    arguments: { query: "smoke", source: "smoke-test", max_results: 5 },
  });
  assert.equal(filteredSearch.isError, undefined);

  const bronzeFiles = await fs.readdir(bronzeDir);
  assert.ok(bronzeFiles.some((name) => name.endsWith(".jsonl")));

  process.stdout.write("datacore MCP smoke test passed (including task lifecycle)\n");
} finally {
  await client.close().catch(() => {});
  await transport.close().catch(() => {});
  await fs.rm(tempDir, { recursive: true, force: true });
}
