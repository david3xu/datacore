#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const [bronzeDir, outputFile] = process.argv.slice(2);

if (!bronzeDir || !outputFile) {
  console.error("Usage: node scripts/generate-dashboard.mjs <bronzeDir> <outputFile>");
  process.exit(1);
}

const STATUS_ORDER = [
  "created",
  "assigned",
  "in_progress",
  "blocked",
  "failed",
  "completed",
  "reviewed",
];

const TYPE_STATUS = {
  task_created: "created",
  task_assigned: "assigned",
  task_started: "in_progress",
  task_blocked: "blocked",
  task_failed: "failed",
  task_cancelled: "failed",
  task_completed: "completed",
  task_reviewed: "reviewed",
  task_ack: "assigned",
  task_updated: "in_progress",
};

const tasks = new Map();

function normalizeStatus(value) {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, "_");
  return STATUS_ORDER.includes(normalized) ? normalized : normalized;
}

function statusWeight(status) {
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? STATUS_ORDER.length : idx;
}

function ensureTask(taskId) {
  if (!tasks.has(taskId)) {
    tasks.set(taskId, {
      id: taskId,
      project: "unknown",
      task_type: null,
      assigned_to: "unassigned",
      summary: null,
      problem: null,
      impact: null,
      status: "created",
      createdAt: null,
      updatedAt: null,
      events: [],
    });
  }
  return tasks.get(taskId);
}

function deriveSummary(content) {
  if (!content) return null;
  const firstLine = content.split(/\n|\r/).find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim() : content.trim();
}

async function parseFile(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const ctx = record.context || {};
    const taskId = ctx.task_id || ctx.taskId;
    if (!taskId) continue;

    const task = ensureTask(taskId);
    const eventType = record.type || "task_event";
    const timestamp = record._timestamp || record.timestamp || null;
    const source = record.source || record._source || "unknown";
    const content = record.content || "";

    const inferredStatus = normalizeStatus(ctx.status) || TYPE_STATUS[eventType] || task.status;
    task.status = inferredStatus;

    task.project = ctx.project || task.project;
    task.task_type = ctx.task_type || ctx.taskType || task.task_type;
    task.assigned_to = ctx.assigned_to || ctx.assignedTo || task.assigned_to;
    task.problem = ctx.problem || task.problem;
    task.impact = ctx.impact || task.impact;

    if (!task.summary && eventType === "task_created") {
      task.summary = deriveSummary(content);
    }
    if (!task.summary) {
      task.summary = ctx.summary || task.summary || deriveSummary(content);
    }

    if (!task.createdAt || (timestamp && timestamp < task.createdAt)) {
      task.createdAt = timestamp;
    }
    if (!task.updatedAt || (timestamp && timestamp > task.updatedAt)) {
      task.updatedAt = timestamp;
    }

    task.events.push({
      timestamp,
      type: eventType,
      source,
      status: inferredStatus,
      content,
    });
  }
}

async function main() {
  const files = (await fsp.readdir(bronzeDir))
    .filter((name) => name.endsWith(".jsonl"))
    .sort();

  for (const file of files) {
    await parseFile(path.join(bronzeDir, file));
  }

  const projectCounts = new Map();
  const statusCounts = new Map();
  const assigneeCounts = new Map();

  const taskList = Array.from(tasks.values())
    .map((task) => {
      task.project = task.project || "unknown";
      task.assigned_to = task.assigned_to || "unassigned";
      task.summary = task.summary || task.problem || "No summary provided.";
      task.events.sort((a, b) => {
        if (!a.timestamp) return -1;
        if (!b.timestamp) return 1;
        return a.timestamp.localeCompare(b.timestamp);
      });

      projectCounts.set(task.project, (projectCounts.get(task.project) || 0) + 1);
      statusCounts.set(task.status, (statusCounts.get(task.status) || 0) + 1);
      assigneeCounts.set(task.assigned_to, (assigneeCounts.get(task.assigned_to) || 0) + 1);

      return task;
    })
    .sort((a, b) => {
      const weightDiff = statusWeight(a.status) - statusWeight(b.status);
      if (weightDiff !== 0) return weightDiff;
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return (b.updatedAt ? 1 : 0) - (a.updatedAt ? 1 : 0);
    });

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      total: taskList.length,
      created: statusCounts.get("created") || 0,
      assigned: statusCounts.get("assigned") || 0,
      in_progress: statusCounts.get("in_progress") || 0,
      blocked: statusCounts.get("blocked") || 0,
      failed: statusCounts.get("failed") || 0,
      completed: statusCounts.get("completed") || 0,
      reviewed: statusCounts.get("reviewed") || 0,
    },
    filters: {
      projects: Array.from(projectCounts.entries()).sort((a, b) => b[1] - a[1]),
      statuses: Array.from(statusCounts.entries()).sort((a, b) => {
        const weightA = statusWeight(a[0]);
        const weightB = statusWeight(b[0]);
        return weightA - weightB;
      }),
      assignees: Array.from(assigneeCounts.entries()).sort((a, b) => b[1] - a[1]),
    },
    tasks: taskList,
  };

  await fsp.mkdir(path.dirname(outputFile), { recursive: true });
  await fsp.writeFile(outputFile, JSON.stringify(summary, null, 2));
  process.stdout.write(`Dashboard data written to ${outputFile}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
