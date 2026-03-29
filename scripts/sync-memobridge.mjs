#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const requiredEnv = ["DATABRICKS_HOST", "DATABRICKS_TOKEN", "MEMOBRIDGE_WAREHOUSE"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const WAREHOUSE = process.env.MEMOBRIDGE_WAREHOUSE;
const LIMIT = Number(process.env.SYNC_LIMIT ?? "500");
const BRONZE_DIR = process.env.DATACORE_BRONZE_DIR || path.join(os.homedir(), ".datacore", "bronze");
const MARKER_FILE = path.join(os.homedir(), ".datacore", ".memobridge-sync-marker");
fs.mkdirSync(BRONZE_DIR, { recursive: true });

const tablePath = buildTablePath();
const lastTimestamp = readMarker();

const sql = `SELECT source, type, content, CAST(timestamp AS STRING) AS timestamp\nFROM ${tablePath}\nWHERE timestamp > TIMESTAMP '${escapeSql(lastTimestamp)}'\nORDER BY timestamp ASC\nLIMIT ${LIMIT}`;

const statement = await submitStatement(sql);
const rows = await collectRows(statement);

if (rows.length === 0) {
  console.log(`No new MemoBridge events found after ${lastTimestamp}.`);
  process.exit(0);
}

const columnIndex = buildColumnIndex(statement);
const fileName = `${new Date().toISOString().slice(0, 10)}.jsonl`;
const bronzeFile = path.join(BRONZE_DIR, fileName);
let latestRemoteTs = lastTimestamp;
let imported = 0;

for (const row of rows) {
  const event = buildEvent(row, columnIndex, tablePath);
  fs.appendFileSync(bronzeFile, `${JSON.stringify(event)}\n`);
  imported += 1;
  const remoteTs = event.context?.source_timestamp;
  if (remoteTs && remoteTs > latestRemoteTs) {
    latestRemoteTs = remoteTs;
  }
}

writeMarker(latestRemoteTs);
console.log(`Imported ${imported} MemoBridge event(s) into ${bronzeFile}. Last timestamp: ${latestRemoteTs}`);

function buildTablePath() {
  const explicit = process.env.MEMOBRIDGE_TABLE?.trim();
  if (explicit && explicit.includes(".")) {
    return explicit;
  }
  const base = explicit && !explicit.includes(".") ? explicit : "default.memobridge_events";
  const schema = process.env.MEMOBRIDGE_SCHEMA?.trim();
  const catalog = process.env.MEMOBRIDGE_CATALOG?.trim();
  if (schema && catalog) return `${catalog}.${schema}.${base}`;
  if (schema) return `${schema}.${base}`;
  if (catalog) return `${catalog}.${base}`;
  return base;
}

function readMarker() {
  try {
    const value = fs.readFileSync(MARKER_FILE, "utf8").trim();
    return value || "1970-01-01T00:00:00Z";
  } catch {
    return "1970-01-01T00:00:00Z";
  }
}

function writeMarker(value) {
  fs.mkdirSync(path.dirname(MARKER_FILE), { recursive: true });
  fs.writeFileSync(MARKER_FILE, value);
}

function escapeSql(input) {
  return input.replace(/'/g, "''");
}

async function submitStatement(statementSql) {
  const payload = {
    statement: statementSql,
    warehouse_id: WAREHOUSE,
    wait_timeout: "30s",
  };
  const initial = await databricksRequest("/api/2.0/sql/statements/", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return waitForCompletion(initial);
}

async function waitForCompletion(response) {
  let current = response;
  let state = current.status?.state;
  const statementId = current.statement_id;
  const maxAttempts = Number(process.env.STATEMENT_MAX_ATTEMPTS ?? "60");
  const intervalMs = Number(process.env.STATEMENT_POLL_INTERVAL_MS ?? "2000");

  if (!statementId) {
    throw new Error("Databricks response missing statement_id");
  }

  let attempts = 0;
  while (state !== "SUCCEEDED") {
    if (state === "FAILED" || state === "CANCELED") {
      const reason = current.error?.message || state;
      throw new Error(`Databricks statement ${state}: ${reason}`);
    }
    if (attempts >= maxAttempts) {
      throw new Error("Timed out waiting for Databricks statement to finish");
    }
    await sleep(intervalMs);
    current = await databricksRequest(`/api/2.0/sql/statements/${statementId}?chunk_index=0`);
    state = current.status?.state;
    attempts += 1;
  }
  return current;
}

async function collectRows(statement) {
  const rows = [];
  let chunk = statement;
  const statementId = statement.statement_id;
  while (true) {
    const data = chunk.result?.data_array ?? [];
    for (const row of data) {
      rows.push(row);
    }
    const nextLink = chunk.next_chunk_internal_link || buildChunkLink(statementId, chunk.next_chunk_index);
    if (!nextLink) break;
    chunk = await databricksRequest(nextLink);
  }
  return rows;
}

function buildChunkLink(statementId, nextIndex) {
  if (typeof nextIndex !== "number") return null;
  return `/api/2.0/sql/statements/${statementId}?chunk_index=${nextIndex}`;
}

function buildColumnIndex(statement) {
  const columns = statement.manifest?.schema?.columns ?? [];
  const map = new Map();
  columns.forEach((col, index) => {
    if (col?.name) {
      map.set(col.name.toLowerCase(), index);
    }
  });
  return map;
}

function buildEvent(row, columnIndex, tableName) {
  const values = Array.isArray(row) ? row : [];
  const source = pickColumn(values, columnIndex, "source") || "memobridge";
  const type = pickColumn(values, columnIndex, "type") || "conversation";
  const content = pickColumn(values, columnIndex, "content") || "";
  const timestamp = pickColumn(values, columnIndex, "timestamp");
  const now = new Date().toISOString();

  const context = {
    origin: "memobridge",
    table: tableName,
    source_timestamp: timestamp ?? null,
    imported_at: now,
  };
  if (!context.source_timestamp) {
    delete context.source_timestamp;
  }

  return {
    source,
    type,
    content,
    context,
    _timestamp: timestamp ?? now,
    _source: source,
    _event_id: crypto.randomUUID(),
  };
}

function pickColumn(values, columnIndex, name) {
  const idx = columnIndex.get(name);
  if (idx === undefined) return null;
  return values[idx] ?? null;
}

async function databricksRequest(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `https://${HOST}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    ...options,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Databricks request failed (${response.status} ${response.statusText}): ${body}`);
  }
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
