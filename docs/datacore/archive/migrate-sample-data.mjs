#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvent, getBronzeDir } from "../dist/store.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const sampleDataDir = path.join(repoRoot, "sample-data");

function truncateContent(text, maxLength = 500) {
  return text.slice(0, maxLength);
}

function buildMigrationContext(filePath) {
  return {
    migrated_from: "sample-data",
    original_file: path.basename(filePath),
  };
}

async function listMatchingFiles(directoryPath, extension) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(directoryPath, entry.name))
    .sort();
}

async function loadMigratedOriginalFiles() {
  const bronzeDir = getBronzeDir();
  const migratedFiles = new Set();

  let entries = [];
  try {
    entries = await fs.readdir(bronzeDir, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return migratedFiles;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const filePath = path.join(bronzeDir, entry.name);
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      try {
        const record = JSON.parse(line);
        const context = record?.context;
        if (
          context?.migrated_from === "sample-data" &&
          typeof context.original_file === "string" &&
          context.original_file.trim()
        ) {
          migratedFiles.add(context.original_file.trim());
        }
      } catch {
        // Ignore malformed Bronze lines while building the dedupe index.
      }
    }
  }

  return migratedFiles;
}

async function migrateMarkdownFiles({ directoryPath, source, migratedFiles, counters }) {
  const files = await listMatchingFiles(directoryPath, ".md");

  for (const filePath of files) {
    const originalFile = path.basename(filePath);
    if (migratedFiles.has(originalFile)) {
      counters.filesSkipped += 1;
      continue;
    }

    const raw = await fs.readFile(filePath, "utf8");
    await appendEvent({
      source,
      type: "document",
      content: truncateContent(raw, 500),
      context: buildMigrationContext(filePath),
    });

    migratedFiles.add(originalFile);
    counters.filesProcessed += 1;
    counters.eventsIngested += 1;
  }
}

async function migrateOpenClawJsonlFiles({ directoryPath, migratedFiles, counters }) {
  const files = await listMatchingFiles(directoryPath, ".jsonl");

  for (const filePath of files) {
    const originalFile = path.basename(filePath);
    if (migratedFiles.has(originalFile)) {
      counters.filesSkipped += 1;
      continue;
    }

    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    let insertedFromFile = 0;

    for (const line of lines) {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        counters.parseErrors += 1;
        continue;
      }

      await appendEvent({
        source: "openclaw-session",
        type: typeof record?.type === "string" && record.type.trim() ? record.type.trim() : "record",
        content: line,
        context: buildMigrationContext(filePath),
      });

      insertedFromFile += 1;
      counters.eventsIngested += 1;
    }

    if (insertedFromFile > 0) {
      migratedFiles.add(originalFile);
    }
    counters.filesProcessed += 1;
  }
}

const migratedFiles = await loadMigratedOriginalFiles();
const counters = {
  filesProcessed: 0,
  filesSkipped: 0,
  eventsIngested: 0,
  parseErrors: 0,
};

await migrateOpenClawJsonlFiles({
  directoryPath: path.join(sampleDataDir, "openclaw"),
  migratedFiles,
  counters,
});

await migrateMarkdownFiles({
  directoryPath: path.join(sampleDataDir, "docs"),
  source: "project-doc",
  migratedFiles,
  counters,
});

await migrateMarkdownFiles({
  directoryPath: path.join(sampleDataDir, "content"),
  source: "content",
  migratedFiles,
  counters,
});

process.stdout.write(
  `${JSON.stringify(
    {
      bronzeDir: getBronzeDir(),
      sampleDataDir,
      filesProcessed: counters.filesProcessed,
      filesSkipped: counters.filesSkipped,
      eventsIngested: counters.eventsIngested,
      parseErrors: counters.parseErrors,
    },
    null,
    2,
  )}\n`,
);
