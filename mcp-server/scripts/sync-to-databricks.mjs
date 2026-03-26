#!/usr/bin/env node
// sync-to-databricks.mjs — One command to refresh Databricks Silver layer
// Exports local Bronze → uploads to DBFS → overwrites Delta table → syncs Vector Search
//
// Usage: node scripts/sync-to-databricks.mjs
// Requires: DATABRICKS_HOST, DATABRICKS_TOKEN env vars

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const BRONZE_DIR = process.env.DATACORE_BRONZE_DIR || path.join(os.homedir(), '.datacore', 'bronze');
const EXPORT_DIR = path.join(os.homedir(), '.datacore', 'export');
const EXPORT_FILE = path.join(EXPORT_DIR, 'bronze-all.jsonl');
const DBFS_PATH = '/FileStore/datacore/bronze-all.jsonl';
const TABLE = 'datacore_databricks.datacore.bronze_events';
const INDEX = 'datacore_databricks.datacore.bronze_events_index';

const HOST = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;

if (!HOST || !TOKEN) {
  console.error('Set DATABRICKS_HOST and DATABRICKS_TOKEN env vars');
  process.exit(1);
}

// ─── Step 1: Export ───
console.log('=== Step 1: Export Bronze → JSONL ===');
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
execFileSync('node', [path.join(scriptDir, 'export-for-databricks.mjs')], { stdio: 'inherit' });
const fileSize = fs.statSync(EXPORT_FILE).size;
console.log(`  Output: ${EXPORT_FILE} (${(fileSize / 1024 / 1024).toFixed(1)} MB)\n`);

// ─── Helpers ───
async function api(endpoint, data, method = 'POST') {
  const url = `${HOST}${endpoint}`;
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  };
  if (data) opts.body = JSON.stringify(data);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

async function uploadToDbfs(localPath, dbfsPath) {
  const CHUNK = 400_000;
  const { handle } = await api('/api/2.0/dbfs/create', { path: dbfsPath, overwrite: true });
  const data = fs.readFileSync(localPath);
  let offset = 0;
  let chunks = 0;
  while (offset < data.length) {
    const chunk = data.subarray(offset, offset + CHUNK);
    const b64 = chunk.toString('base64');
    await api('/api/2.0/dbfs/add-block', { handle, data: b64 });
    offset += CHUNK;
    chunks++;
  }
  await api('/api/2.0/dbfs/close', { handle });
  const status = await api(`/api/2.0/dbfs/get-status?path=${encodeURIComponent(dbfsPath)}`, null, 'GET');
  return { chunks, size: status.file_size };
}

async function findOrStartCluster() {
  const { clusters } = await api('/api/2.0/clusters/list', null, 'GET');
  const running = (clusters || []).find(c => c.state === 'RUNNING' && c.custom_tags?.project === 'datacore');
  if (running) {
    console.log(`  Using running cluster: ${running.cluster_name} (${running.cluster_id})`);
    return running.cluster_id;
  }
  const terminated = (clusters || []).find(c => c.state === 'TERMINATED' && c.custom_tags?.project === 'datacore');
  if (terminated) {
    console.log(`  Starting cluster: ${terminated.cluster_name} (${terminated.cluster_id})`);
    await api('/api/2.0/clusters/start', { cluster_id: terminated.cluster_id });
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 15000));
      const { state } = await api(`/api/2.0/clusters/get?cluster_id=${terminated.cluster_id}`, null, 'GET');
      process.stdout.write(`  [${i+1}] ${state}\r`);
      if (state === 'RUNNING') { console.log(`  Cluster RUNNING after ${(i+1)*15}s`); return terminated.cluster_id; }
      if (state === 'TERMINATED' || state === 'ERROR') throw new Error(`Cluster failed: ${state}`);
    }
    throw new Error('Cluster start timeout (10 min)');
  }
  throw new Error('No datacore cluster found. Create one first via infra/setup-databricks.sh');
}

async function runOnCluster(clusterId, code, lang = 'python') {
  const { id: ctxId } = await api('/api/1.2/contexts/create', { clusterId, language: lang });
  const { id: cmdId } = await api('/api/1.2/commands/execute', {
    clusterId, contextId: ctxId, language: lang, command: code,
  });
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const resp = await fetch(`${HOST}/api/1.2/commands/status?clusterId=${clusterId}&commandId=${cmdId}`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` },
    });
    const s = await resp.json();
    if (s.status === 'Finished') {
      const data = s.results?.data ?? '';
      return { ok: true, data: String(data).slice(0, 500) };
    }
    if (s.status === 'Error' || s.status === 'Cancelled') {
      return { ok: false, data: s.results?.summary || s.results?.cause || 'unknown error' };
    }
  }
  return { ok: false, data: 'timeout (10 min)' };
}

// ─── Main Pipeline ───
async function main() {
  const start = Date.now();

  // Step 2: Upload to DBFS
  console.log('=== Step 2: Upload to DBFS ===');
  const { chunks, size } = await uploadToDbfs(EXPORT_FILE, DBFS_PATH);
  console.log(`  Uploaded ${chunks} chunks, ${(size / 1024 / 1024).toFixed(1)} MB\n`);

  // Step 3: Find or start cluster
  console.log('=== Step 3: Find/start cluster ===');
  const clusterId = await findOrStartCluster();
  console.log();

  // Step 4: Overwrite Delta table
  console.log('=== Step 4: Overwrite Delta table ===');
  const overwrite = await runOnCluster(clusterId, `
df = spark.read.format("json").option("multiLine", False).load("dbfs:${DBFS_PATH}")
cnt = df.count()
df.write.format("delta").mode("overwrite").option("overwriteSchema", "true").saveAsTable("${TABLE}")
spark.sql("ALTER TABLE ${TABLE} SET TBLPROPERTIES (delta.enableChangeDataFeed = true)")
print(f"Delta table: {cnt} events")
`);
  if (!overwrite.ok) throw new Error(`Delta overwrite failed: ${overwrite.data}`);
  console.log(`  ${overwrite.data}\n`);

  // Step 5: Trigger Vector Search sync
  console.log('=== Step 5: Trigger Vector Search sync ===');
  try {
    await api(`/api/2.0/vector-search/indexes/${INDEX}/sync`, {});
    console.log('  Sync triggered. Index will update in background (5-10 min).\n');
  } catch (e) {
    console.log(`  Sync trigger failed: ${e.message}`);
    console.log('  Index may still auto-sync on next query.\n');
  }

  // Step 6: Check index status
  console.log('=== Step 6: Check index status ===');
  try {
    const idx = await api(`/api/2.0/vector-search/indexes/${INDEX}`, null, 'GET');
    const s = idx.status || {};
    console.log(`  State: ${s.detailed_state}  Ready: ${s.ready}\n`);
  } catch (e) {
    console.log(`  Could not check index: ${e.message}\n`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0);
  console.log(`=== DONE in ${elapsed}s ===`);
  console.log('  Cluster will auto-terminate in 30 min.');
  console.log('  Vector Search index syncs in background.');
  console.log('  To stop cluster now: node scripts/sync-to-databricks.mjs --stop');
}

// ─── CLI ───
if (process.argv.includes('--stop')) {
  console.log('Stopping datacore clusters...');
  api('/api/2.0/clusters/list', null, 'GET').then(({ clusters }) => {
    const targets = (clusters || []).filter(c => c.custom_tags?.project === 'datacore' && c.state === 'RUNNING');
    return Promise.all(targets.map(c => {
      console.log(`  Stopping ${c.cluster_name} (${c.cluster_id})`);
      return api('/api/2.0/clusters/delete', { cluster_id: c.cluster_id });
    }));
  }).then(() => console.log('Done.')).catch(e => console.error(e.message));
} else {
  main().catch(e => { console.error(`\nFAILED: ${e.message}`); process.exit(1); });
}
