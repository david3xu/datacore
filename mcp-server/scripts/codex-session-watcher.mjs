#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSharedDatacoreSession, logEventViaMcp } from "../dist/client.js";

const SESSION_ROOT =
  process.env.DATACORE_CODEX_SESSION_DIR || path.join(os.homedir(), ".codex", "sessions");
const STATE_PATH =
  process.env.DATACORE_CODEX_WATCHER_STATE_PATH ||
  path.join(os.homedir(), ".datacore", "codex-session-watcher-state.json");
const SCAN_INTERVAL_MS = resolveIntervalMs(process.env.DATACORE_CODEX_WATCHER_SCAN_MS, 2000);

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

function extractMessageText(items) {
  if (!Array.isArray(items)) {
    return undefined;
  }
  const parts = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (typeof item.text === "string" && item.text.trim()) {
      parts.push(item.text.trim());
      continue;
    }
    if (typeof item.output_text === "string" && item.output_text.trim()) {
      parts.push(item.output_text.trim());
      continue;
    }
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("\n\n");
}

function summarizeTokenCount(info) {
  const total = info?.total_token_usage;
  if (!total || typeof total !== "object") {
    return "token count update";
  }
  return [
    "token count update",
    `input=${total.input_tokens ?? 0}`,
    `cached=${total.cached_input_tokens ?? 0}`,
    `output=${total.output_tokens ?? 0}`,
    `reasoning=${total.reasoning_output_tokens ?? 0}`,
    `total=${total.total_tokens ?? 0}`,
  ].join(" ");
}

function normalizeSessionMeta(event, baseContext) {
  const payload = event.payload ?? {};
  const content =
    [
      "session meta",
      readString(payload.id),
      readString(payload.originator),
      readString(payload.agent_nickname),
      readString(payload.agent_role),
      readString(payload.cwd),
    ]
      .filter(Boolean)
      .join(" | ") || "session meta";

  return {
    source: "codex-session",
    type: "session_meta",
    content,
    context: compactRecord({
      ...baseContext,
      sessionId: readString(payload.id),
      forkedFromId: readString(payload.forked_from_id),
      cwd: readString(payload.cwd),
      originator: readString(payload.originator),
      cliVersion: readString(payload.cli_version),
      agentNickname: readString(payload.agent_nickname),
      agentRole: readString(payload.agent_role),
      modelProvider: readString(payload.model_provider),
      payload,
    }),
  };
}

function normalizeTurnContext(event, baseContext) {
  const payload = event.payload ?? {};
  const content =
    [
      "turn context",
      readString(payload.turn_id),
      readString(payload.cwd),
      readString(payload.model),
      readString(payload.timezone),
    ]
      .filter(Boolean)
      .join(" | ") || "turn context";

  return {
    source: "codex-session",
    type: "turn_context",
    content,
    context: compactRecord({
      ...baseContext,
      turnId: readString(payload.turn_id),
      cwd: readString(payload.cwd),
      currentDate: readString(payload.current_date),
      timezone: readString(payload.timezone),
      model: readString(payload.model),
      personality: readString(payload.personality),
      approvalPolicy: readString(payload.approval_policy),
      payload,
    }),
  };
}

function normalizeEventMsg(event, baseContext) {
  const payload = event.payload ?? {};
  const payloadType = readString(payload.type) ?? "event_msg";

  let type = payloadType;
  let content;

  if (payloadType === "user_message") {
    content = readString(payload.message);
  } else if (payloadType === "agent_message") {
    content = readString(payload.message);
  } else if (payloadType === "task_complete") {
    content = readString(payload.last_agent_message) || "task complete";
  } else if (payloadType === "task_started") {
    content =
      [
        "task started",
        readString(payload.turn_id),
        payload.model_context_window !== undefined
          ? `context=${payload.model_context_window}`
          : undefined,
        readString(payload.collaboration_mode_kind),
      ]
        .filter(Boolean)
        .join(" ");
  } else if (payloadType === "token_count") {
    content = summarizeTokenCount(payload.info);
  } else {
    type = "event_msg";
    content = summarizeJson(payload) || "event message";
  }

  return {
    source: "codex-session",
    type,
    content: content || "event message",
    context: compactRecord({
      ...baseContext,
      phase: readString(payload.phase),
      memoryCitation: payload.memory_citation ?? undefined,
      turnId: readString(payload.turn_id),
      payload,
    }),
  };
}

function normalizeResponseItem(event, baseContext) {
  const payload = event.payload ?? {};
  const payloadType = readString(payload.type) ?? "response_item";

  let type = payloadType;
  let content;

  if (payloadType === "message") {
    type = "response_message";
    content =
      extractMessageText(payload.content) ||
      [readString(payload.role), "response message"].filter(Boolean).join(" ");
  } else if (payloadType === "reasoning") {
    const summaryText = Array.isArray(payload.summary)
      ? payload.summary
          .map((entry) => {
            if (typeof entry === "string") {
              return entry.trim();
            }
            return entry && typeof entry === "object" && typeof entry.text === "string"
              ? entry.text.trim()
              : "";
          })
          .filter(Boolean)
          .join("\n")
      : "";
    content = summaryText || "reasoning event";
  } else if (payloadType === "function_call") {
    content =
      [
        readString(payload.name),
        readString(payload.arguments),
      ]
        .filter(Boolean)
        .join("\n") || "function call";
  } else if (payloadType === "function_call_output") {
    content =
      readString(payload.output) ||
      summarizeJson(payload.output) ||
      [readString(payload.call_id), "function call output"].filter(Boolean).join(" ");
  } else {
    type = "response_item";
    content = summarizeJson(payload) || "response item";
  }

  return {
    source: "codex-session",
    type,
    content: content || "response item",
    context: compactRecord({
      ...baseContext,
      role: readString(payload.role),
      name: readString(payload.name),
      callId: readString(payload.call_id),
      hasEncryptedContent:
        payload.encrypted_content !== undefined ? Boolean(payload.encrypted_content) : undefined,
      payload,
    }),
  };
}

function normalizeCodexEvent(event, filePath) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const eventType = readString(event.type);
  if (!eventType) {
    return null;
  }

  const baseContext = compactRecord({
    app: "codex",
    sessionFile: sessionFileLabel(filePath),
    observedAt: readString(event.timestamp) ?? new Date().toISOString(),
    codexEventType: eventType,
    codexPayloadType: readString(event.payload?.type),
  });

  if (eventType === "session_meta") {
    return normalizeSessionMeta(event, baseContext);
  }
  if (eventType === "turn_context") {
    return normalizeTurnContext(event, baseContext);
  }
  if (eventType === "event_msg") {
    return normalizeEventMsg(event, baseContext);
  }
  if (eventType === "response_item") {
    return normalizeResponseItem(event, baseContext);
  }

  return {
    source: "codex-session",
    type: eventType,
    content: summarizeJson(event.payload) || eventType,
    context: compactRecord({
      ...baseContext,
      payload: event.payload,
    }),
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
      console.warn(`[codex-session-watcher] Skipping invalid JSON in ${resolvedPath}: ${String(error)}`);
      continue;
    }

    const bronzeEvent = normalizeCodexEvent(event, resolvedPath);
    if (!bronzeEvent) {
      continue;
    }

    await logEventViaMcp(bronzeEvent, { shared: true });
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
      console.error(`[codex-session-watcher] Scan failed: ${String(error)}`);
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
  console.warn(`[codex-session-watcher] fs.watch disabled, polling only: ${String(reason)}`);
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
    console.error(`[codex-session-watcher] Final scan failed during ${signal}: ${String(error)}`);
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

console.log(`[codex-session-watcher] Watching ${SESSION_ROOT}`);
console.log(`[codex-session-watcher] State file ${STATE_PATH}`);

await scanSessions();
