import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBundleMcpToolRuntime } from "../../../openclaw/src/agents/pi-bundle-mcp-tools.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(scriptDir, "../src/index.mjs");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "datacore-openclaw-mcp-"));
const bronzeDir = path.join(tempDir, "bronze");

const runtime = await createBundleMcpToolRuntime({
  workspaceDir: tempDir,
  cfg: {
    mcp: {
      servers: {
        datacore: {
          command: "node",
          args: [serverPath],
          env: {
            DATACORE_BRONZE_DIR: bronzeDir,
          },
        },
      },
    },
  },
});

try {
  const toolNames = runtime.tools.map((tool) => tool.name).sort();
  assert.deepEqual(toolNames, ["log_event", "search"]);

  const logTool = runtime.tools.find((tool) => tool.name === "log_event");
  const searchTool = runtime.tools.find((tool) => tool.name === "search");
  assert.ok(logTool, "log_event tool missing");
  assert.ok(searchTool, "search tool missing");

  const logResult = await logTool.execute(
    "openclaw-log-event",
    {
      source: "openclaw-smoke",
      type: "note",
      content: "Datacore MCP event written through OpenClaw runtime",
      context: {
        test: true,
      },
    },
    undefined,
    undefined,
  );

  const logText = logResult.content
    .filter((entry) => entry.type === "text")
    .map((entry) => String(entry.text ?? ""))
    .join("\n");
  assert.match(logText, /Logged note from openclaw-smoke/);

  const searchResult = await searchTool.execute(
    "openclaw-search",
    {
      query: "OpenClaw runtime",
      max_results: 5,
    },
    undefined,
    undefined,
  );

  const searchText = searchResult.content
    .filter((entry) => entry.type === "text")
    .map((entry) => String(entry.text ?? ""))
    .join("\n");
  assert.match(searchText, /Found 1 match/);

  process.stdout.write("OpenClaw MCP smoke test passed\n");
} finally {
  await runtime.dispose();
  await fs.rm(tempDir, { recursive: true, force: true });
}
