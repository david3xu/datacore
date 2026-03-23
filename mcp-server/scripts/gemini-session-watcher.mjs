#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeSharedDatacoreSession, logEventViaMcp } from "../src/client.mjs";

const SESSION_ROOT =
  process.env.DATACORE_GEMINI_SESSION_DIR || path.join(os.homedir(), ".gemini", "tmp");
const STATE_PATH =
  process.env.DATACORE_GEMINI_WATCHER_STATE_PATH ||
  path.join(os.homedir(), ".datacore", "gemini-session-watcher-state.json");
const SCAN_INTERVAL_MS = resolveIntervalMs(process.env.DATACORE_GEMINI_WATCHER_SCAN_MS, 2000);

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

function extractText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const parts = [];
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      if (typeof item.text === "string" && item.text.trim()) {
        parts.push(item.text.trim());
      }
    }
    return parts.join("\n\n");
  }
  return undefined;
}

function normalizeGeminiEvent(msg, sessionObject, filePath) {
  if (!msg || typeof msg !== "object") return null;

  const msgType = readString(msg.type);
  if (!msgType) return null;

  const baseContext = compactRecord({
    app: "gemini",
    sessionFile: sessionFileLabel(filePath),
    sessionId: readString(sessionObject.sessionId),
    projectHash: readString(sessionObject.projectHash),
    messageId: readString(msg.id),
    observedAt: readString(msg.timestamp) ?? new Date().toISOString(),
    model: readString(msg.model) || readString(sessionObject.model),
    tokens: msg.tokens,
    originalType: msgType,
  });

  let type = msgType;
  let content = extractText(msg.content) || `${msgType} message`;

  if (msgType === "user") {
    type = "human_message";
  } else if (msgType === "gemini") {
    type = "assistant_message";
  } else {
    type = "event";
    content = `${msgType} event`;
  }

  // Preserve thoughts from assistant
  if (msg.thoughts && Array.isArray(msg.thoughts)) {
      baseContext.thoughts = msg.thoughts;
  }

  return {
    source: "gemini-session",
    type,
    content,
    context: compactRecord(baseContext)
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
  await fsp.writeFile(tempPath, `${JSON.stringify(state, null, 0)}\n`, "utf8");
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
    
    // Check if ends with .json and is in a sequence like /chats/session-xxx.json
    if (entry.isFile() && entry.name.endsWith(".json") && entry.name.startsWith("session-")) {
      // Very loose check, we only want the actual session files.
      if (fullPath.includes("/chats/session-") || fullPath.includes("\\chats\\session-")) {
          files.push(fullPath);
      }
    }
  }

  return files.sort();
}

const state = await loadState();
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
      stateDirty = true;
      return;
    }
    throw error;
  }

  if (!stats.isFile()) {
    return;
  }

  const entry = state.files[resolvedPath] ?? { size: 0, mtimeMs: 0, seenIds: [] };
  
  // If the file matches exactly our last sizes, we can skip rewriting parsing.
  if (stats.size === entry.size && stats.mtimeMs === entry.mtimeMs) {
    return;
  }

  let sessionData;
  try {
    const raw = await fsp.readFile(resolvedPath, "utf8");
    sessionData = JSON.parse(raw);
  } catch (e) {
    console.warn(`[gemini-watcher] Skipping unparseable JSON in ${resolvedPath}: ${e.message}`);
    // Update mtime to prevent infinite retry parsing bad json
    entry.size = stats.size;
    entry.mtimeMs = stats.mtimeMs;
    state.files[resolvedPath] = entry;
    stateDirty = true;
    return;
  }

  if (!sessionData.messages || !Array.isArray(sessionData.messages)) {
    entry.size = stats.size;
    entry.mtimeMs = stats.mtimeMs;
    state.files[resolvedPath] = entry;
    stateDirty = true;
    return;
  }

  const seenIdsSet = new Set(entry.seenIds || []);
  let newEventsProcessed = false;

  for (const msg of sessionData.messages) {
    if (!msg.id) continue;
    if (seenIdsSet.has(msg.id)) continue;

    const bronzeEvent = normalizeGeminiEvent(msg, sessionData, resolvedPath);
    if (!bronzeEvent) {
      continue;
    }

    try {
      await logEventViaMcp(bronzeEvent, { shared: true });
      seenIdsSet.add(msg.id);
      newEventsProcessed = true;
    } catch (err) {
      console.warn(`[gemini-watcher] Failed to log event: ${String(err)}`);
    }
  }

  entry.seenIds = Array.from(seenIdsSet);
  entry.size = stats.size;
  entry.mtimeMs = stats.mtimeMs;
  state.files[resolvedPath] = entry;
  
  // Even if no NEW events were added, the file size changed, so dirty is true.
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
      console.error(`[gemini-watcher] Scan failed: ${String(error)}`);
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
  console.warn(`[gemini-watcher] fs.watch disabled, polling only: ${String(reason)}`);
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
    console.error(`[gemini-watcher] Final scan failed during ${signal}: ${String(error)}`);
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

console.log(`[gemini-watcher] Watching ${SESSION_ROOT}`);
console.log(`[gemini-watcher] State file ${STATE_PATH}`);

await scanSessions();
