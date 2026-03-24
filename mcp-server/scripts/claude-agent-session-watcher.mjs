#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSharedDatacoreSession, logEventViaMcp } from "../dist/client.js";

const SESSION_ROOT =
  process.env.DATACORE_CLAUDE_AGENT_SESSION_DIR || path.join(os.homedir(), "Library", "Application Support", "Claude", "local-agent-mode-sessions");
const STATE_PATH =
  process.env.DATACORE_CLAUDE_AGENT_WATCHER_STATE_PATH ||
  path.join(os.homedir(), ".datacore", "claude-agent-watcher-state.json");
const SCAN_INTERVAL_MS = resolveIntervalMs(process.env.DATACORE_CLAUDE_AGENT_WATCHER_SCAN_MS, 2000);

function resolveIntervalMs(rawValue, fallbackMs) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function readString(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function compactRecord(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null),
  );
}

function sessionFileLabel(filePath) {
  return path.relative(SESSION_ROOT, filePath).replaceAll(path.sep, "/");
}

function summarizeJson(value, maxLength = 1200) {
  const text = JSON.stringify(value);
  if (!text) {
    return undefined;
  }
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

function extractText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      // Prefer text blocks over thinking blocks
      if (typeof item.text === "string" && item.text.trim()) {
        parts.push(item.text.trim());
      }
    }
    return parts.join("\n\n");
  }
  return undefined;
}

function normalizeClaudeEvent(event, filePath) {
  if (!event || typeof event !== "object") return null;

  const eventType = readString(event.type);
  if (!eventType) return null;

  const baseContext = compactRecord({
    app: "claude-agent",
    sessionFile: sessionFileLabel(filePath),
    observedAt: readString(event.timestamp) ?? new Date().toISOString(),
    originalType: eventType,
  });

  let type = eventType;
  let content = "event";
  let context = { ...baseContext };

  if (eventType === "user" || eventType === "system") {
    type = eventType === "user" ? "human_message" : "system_message";
    content = extractText(event.message) || `${eventType} message`;
  } else if (eventType === "assistant") {
    type = "assistant_message";
    content = extractText(event.message) || "assistant message";
  } else if (eventType === "tool_use_summary") {
    type = "tool_summary";
    content = readString(event.summary) || "tool used";
    context.toolUseIds = event.tool_use_ids;
  } else if (eventType === "result") {
    type = "tool_result";
    // Depending on schema, result could be an object or string
    content = typeof event.result === "string" ? event.result : summarizeJson(event.result) || "tool result";
    context.isError = event.is_error;
    context.stopReason = event.stop_reason;
    context.cost = event.cost;
    context.usage = event.usage;
  } else if (eventType === "queue-operation" || eventType === "progress" || eventType === "rate_limit_event" || eventType === "last-prompt") {
    if (eventType === "queue-operation") type = "queue_operation";
    if (eventType === "rate_limit_event") type = "rate_limit";
    if (eventType === "last-prompt") type = "last_prompt";
    
    content = `${eventType} event`;
    context.payload = Object.fromEntries(
        Object.entries(event).filter(([k]) => k !== "type" && k !== "timestamp")
    );
  } else {
    type = "event";
    content = summarizeJson(event) || "event";
  }

  return {
    source: "claude-agent",
    type,
    content,
    context: compactRecord(context)
  };
}

async function loadState() {
  try {
    const raw = await fsp.readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      files: parsed?.files && typeof parsed.files === "object" ? parsed.files : {},
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        version: 1,
        files: {},
      };
    }
    throw error;
  }
}

async function saveState(state) {
  const dir = path.dirname(STATE_PATH);
  const tempPath = `${STATE_PATH}.tmp`;
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fsp.rename(tempPath, STATE_PATH);
}

async function listSessionFiles(rootDir) {
  const files = [];
  let entries = [];
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return files;
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSessionFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

const state = await loadState();
const partialLineBuffers = new Map();
let scanQueued = false;
let scanInFlight = false;
let stateDirty = false;
let stopped = false;

async function processFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  let stats;
  try {
    stats = await fsp.stat(resolvedPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      delete state.files[resolvedPath];
      partialLineBuffers.delete(resolvedPath);
      stateDirty = true;
      return;
    }
    throw error;
  }

  if (!stats.isFile()) {
    return;
  }

  const entry = state.files[resolvedPath] ?? { offset: 0 };
  if (stats.size < entry.offset) {
    entry.offset = 0;
    partialLineBuffers.delete(resolvedPath);
  }
  if (stats.size === entry.offset) {
    state.files[resolvedPath] = entry;
    return;
  }

  const handle = await fsp.open(resolvedPath, "r");
  let chunkText = "";
  try {
    const bytesToRead = stats.size - entry.offset;
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, entry.offset);
    chunkText = buffer.toString("utf8");
  } finally {
    await handle.close();
  }

  const bufferedPrefix = partialLineBuffers.get(resolvedPath) ?? "";
  const combined = `${bufferedPrefix}${chunkText}`;
  const lastNewlineIndex = combined.lastIndexOf("\n");
  if (lastNewlineIndex === -1) {
    partialLineBuffers.set(resolvedPath, combined);
    state.files[resolvedPath] = entry;
    return;
  }

  const completeText = combined.slice(0, lastNewlineIndex);
  const remainder = combined.slice(lastNewlineIndex + 1);
  if (remainder) {
    partialLineBuffers.set(resolvedPath, remainder);
  } else {
    partialLineBuffers.delete(resolvedPath);
  }

  const lines = completeText.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      console.warn(`[claude-agent-watcher] Skipping invalid JSON in ${resolvedPath}: ${String(error)}`);
      continue;
    }

    const bronzeEvent = normalizeClaudeEvent(event, resolvedPath);
    if (!bronzeEvent) {
      continue;
    }

    try {
      await logEventViaMcp(bronzeEvent, { shared: true });
    } catch (err) {
      console.warn(`[claude-agent-watcher] Failed to log event: ${String(err)}`);
    }
  }

  const processedChunk = combined.slice(0, lastNewlineIndex + 1);
  entry.offset += Buffer.byteLength(processedChunk, "utf8") - Buffer.byteLength(bufferedPrefix, "utf8");
  entry.size = stats.size;
  entry.mtimeMs = stats.mtimeMs;
  state.files[resolvedPath] = entry;
  stateDirty = true;
}

async function scanSessions() {
  const files = await listSessionFiles(SESSION_ROOT);
  for (const filePath of files) {
    await processFile(filePath);
  }
  if (stateDirty) {
    await saveState(state);
    stateDirty = false;
  }
}

function scheduleScan() {
  if (scanQueued || stopped) {
    return;
  }
  scanQueued = true;
  setTimeout(async () => {
    if (scanInFlight || stopped) {
      scanQueued = false;
      return;
    }
    scanQueued = false;
    scanInFlight = true;
    try {
      await scanSessions();
    } catch (error) {
      console.error(`[claude-agent-watcher] Scan failed: ${String(error)}`);
    } finally {
      scanInFlight = false;
    }
  }, 50);
}

const pollTimer = setInterval(scheduleScan, SCAN_INTERVAL_MS);
let watchHandle = null;
let watchDisabled = false;

function disableFsWatch(reason) {
  if (watchDisabled) {
    return;
  }
  watchDisabled = true;
  console.warn(`[claude-agent-watcher] fs.watch disabled, polling only: ${String(reason)}`);
  watchHandle?.close();
  watchHandle = null;
}

try {
  watchHandle = fs.watch(SESSION_ROOT, { recursive: true }, scheduleScan);
  watchHandle.on("error", (error) => {
    disableFsWatch(error);
  });
} catch (error) {
  disableFsWatch(error);
}

async function shutdown(signal) {
  if (stopped) {
    return;
  }
  stopped = true;
  clearInterval(pollTimer);
  watchHandle?.close();
  await closeSharedDatacoreSession().catch(() => {});
  try {
    await scanSessions();
  } catch (error) {
    console.error(`[claude-agent-watcher] Final scan failed during ${signal}: ${String(error)}`);
  }
  await closeSharedDatacoreSession().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

console.log(`[claude-agent-watcher] Watching ${SESSION_ROOT}`);
console.log(`[claude-agent-watcher] State file ${STATE_PATH}`);

await scanSessions();
