#!/usr/bin/env node
// enrich-memory.mjs — Session startup enrichment: promote fresh Datacore facts into MEMORY.md

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const MEMORY_PATH =
  process.env.OPENCLAW_MEMORY_PATH ||
  path.join(os.homedir(), '.openclaw', 'workspace', 'MEMORY.md');

const ARCHIVE_PATH =
  process.env.OPENCLAW_MEMORY_ARCHIVE_PATH ||
  path.join(os.homedir(), '.openclaw', 'workspace', 'memory-archive.md');

const STALE_DAYS = parseInt(process.env.ENRICH_STALE_DAYS ?? '30', 10);
const MCP_SERVER_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../mcp-server/dist/client.js',
);

// ── Helpers ────────────────────────────────────────────────────────────────

async function callMcp(toolName, args) {
  const { callDatacoreTool } = await import(MCP_SERVER_PATH);
  return callDatacoreTool({ name: toolName, arguments: args }, { shared: true });
}

function daysBetween(isoDate) {
  const then = new Date(isoDate);
  const now = new Date();
  return (now - then) / (1000 * 60 * 60 * 24);
}

function extractDateFromLine(line) {
  // Match lines like "# YYYY-MM-DD" or "date: YYYY-MM-DD" or "- 2026-03-26"
  const match = line.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return match ? match[1] : null;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function readMemory() {
  try {
    return await fs.readFile(MEMORY_PATH, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}

async function archiveStaleLines(content) {
  const lines = content.split('\n');
  const fresh = [];
  const stale = [];
  let currentSectionDate = null;
  let currentSectionLines = [];

  // Parse memory into dated sections — sections separated by "# " headings with dates
  for (const line of lines) {
    const date = extractDateFromLine(line);
    if (line.startsWith('#') && date) {
      // Flush previous section
      if (currentSectionLines.length > 0) {
        const age = currentSectionDate ? daysBetween(currentSectionDate) : 0;
        if (age > STALE_DAYS) {
          stale.push(...currentSectionLines);
        } else {
          fresh.push(...currentSectionLines);
        }
      }
      currentSectionDate = date;
      currentSectionLines = [line];
    } else {
      currentSectionLines.push(line);
    }
  }

  // Flush last section — no date = permanent (safety rules, identity)
  if (currentSectionLines.length > 0) {
    const age = currentSectionDate ? daysBetween(currentSectionDate) : 0;
    if (currentSectionDate && age > STALE_DAYS) {
      stale.push(...currentSectionLines);
    } else {
      fresh.push(...currentSectionLines);
    }
  }

  if (stale.length === 0) {
    return { freshContent: content, archivedCount: 0 };
  }

  // Append stale lines to archive
  const archiveEntry = [
    `\n# Archived ${new Date().toISOString().slice(0, 10)} (>${STALE_DAYS} days old)`,
    ...stale,
    '',
  ].join('\n');

  await fs.appendFile(ARCHIVE_PATH, archiveEntry, 'utf8');
  console.log(`Archived ${stale.length} stale lines to ${ARCHIVE_PATH}`);

  return { freshContent: fresh.join('\n'), archivedCount: stale.length };
}

async function fetchNewFacts(existingContent) {
  const newLines = [];

  // 1. Active tasks summary
  try {
    const tasksResult = await callMcp('get_tasks', { status: 'active' });
    const text = tasksResult?.content?.[0]?.text ?? '';
    if (text && !text.includes('No active tasks')) {
      // Extract just the task IDs and summaries (compact form)
      const taskLines = text
        .split('\n')
        .filter((l) => l.match(/^\[/) || l.includes('Summary:'))
        .slice(0, 10)
        .join('\n');
      if (taskLines && !existingContent.includes(taskLines.slice(0, 50))) {
        newLines.push(`\n# Active Tasks — ${new Date().toISOString().slice(0, 10)}`);
        newLines.push(taskLines);
      }
    }
  } catch (err) {
    console.warn('enrich-memory: get_tasks failed:', err.message);
  }

  // 2. Recent Gold decisions
  try {
    const factsResult = await callMcp('get_facts', { entity_type: 'decision', query: 'datacore' });
    const entities = factsResult?.structuredContent?.entities ?? [];
    const recentDecisions = entities
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, 3);

    for (const d of recentDecisions) {
      const line = `- ${d.summary}`;
      if (!existingContent.includes(d.summary.slice(0, 40))) {
        if (newLines.every((l) => !l.includes('Key Decisions'))) {
          newLines.push(`\n# Key Decisions — ${new Date().toISOString().slice(0, 10)}`);
        }
        newLines.push(line);
      }
    }
  } catch (err) {
    console.warn('enrich-memory: get_facts failed:', err.message);
  }

  return newLines;
}

async function main() {
  console.log('enrich-memory: starting session enrichment');

  let content = await readMemory();
  const originalLength = content.length;

  // Step 1: Archive stale dated sections
  const { freshContent, archivedCount } = await archiveStaleLines(content);
  content = freshContent;

  // Step 2: Fetch new facts from Datacore
  const newLines = await fetchNewFacts(content);

  if (newLines.length === 0 && archivedCount === 0) {
    console.log('enrich-memory: nothing new to add, MEMORY.md unchanged');
    return;
  }

  // Step 3: Write updated MEMORY.md
  const updated = content.trimEnd() + '\n' + newLines.join('\n') + '\n';
  await fs.writeFile(MEMORY_PATH, updated, 'utf8');

  console.log(
    `enrich-memory: done. ` +
      `${archivedCount > 0 ? `${archivedCount} lines archived. ` : ''}` +
      `${newLines.length > 0 ? `${newLines.length} new lines added. ` : ''}` +
      `${originalLength} → ${updated.length} bytes`,
  );
}

main().catch((err) => {
  console.error('enrich-memory failed:', err.message);
  process.exit(1);
});
