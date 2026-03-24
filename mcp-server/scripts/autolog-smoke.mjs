import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import hook from "../../hooks/datacore-mcp-log/handler.js";
import { closeSharedDatacoreSession } from "../dist/client.js";
import { searchEvents } from "../dist/search.js";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "datacore-autolog-"));
const bronzeDir = path.join(tempDir, "bronze");
const originalBronzeDir = process.env.DATACORE_BRONZE_DIR;

process.env.DATACORE_BRONZE_DIR = bronzeDir;

try {
  await hook({
    type: "message",
    action: "preprocessed",
    sessionKey: "openclaw:test-session",
    timestamp: new Date(),
    messages: [],
    context: {
      from: "telegram:user:alice",
      to: "telegram:bot:datacore",
      body: "🎤 [Audio]",
      bodyForAgent: "Auto-log inbound smoke message",
      transcript: "Auto-log inbound smoke message",
      channelId: "telegram",
      conversationId: "chat:smoke",
      messageId: "msg-pre",
      provider: "telegram",
      surface: "telegram",
      isGroup: false,
    },
  });

  await hook({
    type: "message",
    action: "sent",
    sessionKey: "openclaw:test-session",
    timestamp: new Date(),
    messages: [],
    context: {
      to: "telegram:user:alice",
      content: "Auto-log outbound smoke reply",
      success: true,
      channelId: "telegram",
      conversationId: "chat:smoke",
      messageId: "msg-sent",
      isGroup: false,
    },
  });

  const inbound = await searchEvents({
    query: "Auto-log inbound smoke message",
    maxResults: 5,
  });
  const outbound = await searchEvents({
    query: "Auto-log outbound smoke reply",
    maxResults: 5,
  });

  assert.equal(inbound.results.length, 1, "expected inbound event to be logged");
  assert.equal(outbound.results.length, 1, "expected outbound event to be logged");

  process.stdout.write("Datacore auto-log smoke test passed\n");
} finally {
  await closeSharedDatacoreSession().catch(() => {});
  if (originalBronzeDir === undefined) {
    delete process.env.DATACORE_BRONZE_DIR;
  } else {
    process.env.DATACORE_BRONZE_DIR = originalBronzeDir;
  }
  await fs.rm(tempDir, { recursive: true, force: true });
}
