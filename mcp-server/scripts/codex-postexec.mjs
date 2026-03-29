#!/usr/bin/env node

/**
 * codex-postexec.mjs — R13 implementation
 * Build a post-execution logging wrapper for Codex sessions.
 *
 * Usage:
 *   node scripts/codex-postexec.mjs --latest           # default (most recent session)
 *   node scripts/codex-postexec.mjs --count 3          # log summaries for 3 latest sessions
 *   node scripts/codex-postexec.mjs --since 60         # process sessions updated in last 60 minutes
 *   node scripts/codex-postexec.mjs --file path.jsonl  # explicit session file (can repeat)
 *   node scripts/codex-postexec.mjs --dry-run          # print summary instead of calling log_event
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

import { logEventViaMcp, closeSharedDatacoreSession } from '../dist/client.js';

const SESSION_ROOT =
  process.env.CODEX_SESSION_DIR || path.join(os.homedir(), '.codex', 'sessions');

const DEFAULT_MAX_FILES = 1;
const DEFAULT_SINCE_MINUTES = null;

function usage(message) {
  const lines = [
    message ? `Error: ${message}` : null,
    'Usage: node scripts/codex-postexec.mjs [options]',
    'Options:',
    '  --file <path>         Explicit session file (repeatable)',
    '  --count <n>           Number of recent sessions to log (default 1)',
    '  --since <minutes>     Only process sessions modified within the window',
    '  --all                Process all discovered sessions (ignores --count)',
    '  --dry-run            Print summaries without calling log_event',
    '  --root <dir>         Override Codex session root directory',
  ].filter(Boolean);
  console.error(lines.join('\n'));
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    files: [],
    count: DEFAULT_MAX_FILES,
    sinceMinutes: DEFAULT_SINCE_MINUTES,
    dryRun: false,
    root: SESSION_ROOT,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--file':
      case '-f': {
        const file = args[++i];
        if (!file) usage('Missing path after --file');
        options.files.push(path.resolve(file));
        break;
      }
      case '--count': {
        const value = args[++i];
        if (!value) usage('Missing value after --count');
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) usage('Invalid --count value');
        options.count = parsed;
        break;
      }
      case '--since': {
        const value = args[++i];
        if (!value) usage('Missing minutes after --since');
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) usage('Invalid --since value');
        options.sinceMinutes = parsed;
        break;
      }
      case '--all': {
        options.count = Number.POSITIVE_INFINITY;
        break;
      }
      case '--dry-run': {
        options.dryRun = true;
        break;
      }
      case '--root': {
        const value = args[++i];
        if (!value) usage('Missing directory after --root');
        options.root = path.resolve(value);
        break;
      }
      case '--help':
      case '-h':
        usage();
        break;
      case '--':
        // pnpm passes an extra -- before forwarded args
        continue;
      default:
        usage(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function listSessionFiles(rootDir) {
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    });
    const results = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await walk(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const files = await walk(rootDir);
  const withStats = await Promise.all(
    files.map(async (filePath) => {
      const stat = await fs.stat(filePath).catch(() => null);
      return stat
        ? {
            path: filePath,
            mtimeMs: stat.mtimeMs,
          }
        : null;
    }),
  );
  return withStats
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry) => entry.path);
}

function extractMessageText(payload) {
  const items = Array.isArray(payload?.content) ? payload.content : [];
  const parts = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.text === 'string' && item.text.trim()) {
      parts.push(item.text.trim());
      continue;
    }
    if (typeof item.output_text === 'string' && item.output_text.trim()) {
      parts.push(item.output_text.trim());
    }
  }
  return parts.join('\n\n').trim();
}

const DIRECTIVE_RE = /::git-(commit|create-pr|create-branch|stage|push)\{([^}]*)\}/gi;

function parseDirectiveArgs(raw) {
  const result = {};
  const argRe = /(\w+)=(("[^"]*")|'[^']*'|[^,]+)(?:,|$)/g;
  let match;
  while ((match = argRe.exec(raw)) !== null) {
    const key = match[1];
    const value = match[2];
    const normalized =
      value.startsWith('"') && value.endsWith('"')
        ? value.slice(1, -1)
        : value.startsWith("'") && value.endsWith("'")
          ? value.slice(1, -1)
          : value.trim();
    result[key] = normalized;
  }
  return result;
}

function summarizeDirective(directive, rawArgs) {
  const args = parseDirectiveArgs(rawArgs);
  const kv = Object.entries(args)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  return `${directive}${kv ? ` (${kv})` : ''}`;
}

function addIfUnique(list, value) {
  if (!value) return;
  if (!list.includes(value)) list.push(value);
}

function truncate(text, length = 400) {
  if (!text) return '';
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}

function deriveSessionId(event) {
  return event?.payload?.id || event?.context?.sessionId || null;
}

async function parseSession(filePath) {
  const raw = await fs.readFile(filePath, 'utf8').catch((error) => {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!raw) return null;
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return null;

  const commits = [];
  const pulls = [];
  const pushes = [];
  const branches = new Set();
  const errors = [];
  let finalSummary = null;
  let sessionMeta = null;
  let lastUpdated = null;

  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      continue;
    }
    lastUpdated = event.timestamp || lastUpdated;
    if (!sessionMeta && event.type === 'session_meta') {
      sessionMeta = event;
    }

    const payload = event.payload ?? {};
    const messageText =
      event.type === 'response_item' && payload?.type === 'message'
        ? extractMessageText(payload)
        : null;
    if (messageText) {
      finalSummary = messageText;
      let match;
      while ((match = DIRECTIVE_RE.exec(messageText)) !== null) {
        const directive = match[1];
        const description = summarizeDirective(directive, match[2]);
        switch (directive.toLowerCase()) {
          case 'commit':
            commits.push(description);
            addIfUnique(branches, parseDirectiveArgs(match[2]).branch);
            break;
          case 'create-pr':
            pulls.push(description);
            addIfUnique(branches, parseDirectiveArgs(match[2]).branch);
            break;
          case 'push':
            pushes.push(description);
            addIfUnique(branches, parseDirectiveArgs(match[2]).branch);
            break;
          case 'create-branch':
            addIfUnique(branches, parseDirectiveArgs(match[2]).branch);
            break;
          default:
            break;
        }
      }
    }

    const possibleError =
      typeof payload?.output === 'string'
        ? payload.output
        : typeof payload?.text === 'string'
          ? payload.text
          : typeof event.content === 'string'
            ? event.content
            : null;
    if (possibleError && /error|exception|traceback/i.test(possibleError)) {
      const snippet = truncate(possibleError.trim(), 300);
      if (snippet) addIfUnique(errors, snippet);
    }
  }

  if (!sessionMeta && lines.length > 0) {
    // Fallback minimal meta
    sessionMeta = JSON.parse(lines[0]);
  }

  const sessionId = deriveSessionId(sessionMeta);
  const cwd = sessionMeta?.payload?.cwd || sessionMeta?.context?.cwd;
  const originator = sessionMeta?.payload?.originator;
  const agentNickname = sessionMeta?.payload?.agent_nickname;

  return {
    filePath,
    sessionId,
    cwd,
    originator,
    agentNickname,
    commits,
    pulls,
    pushes,
    branches: [...branches].filter(Boolean),
    errors,
    finalSummary,
    lastUpdated,
  };
}

function buildSummaryText(summary) {
  const lines = [];
  lines.push(
    `Codex session ${summary.sessionId || path.basename(summary.filePath)} ${
      summary.lastUpdated ? `(${summary.lastUpdated})` : ''
    }`,
  );
  if (summary.cwd || summary.originator) {
    lines.push(
      `Context: ${summary.cwd || 'unknown cwd'}${
        summary.originator ? ` · Origin: ${summary.originator}` : ''
      }${summary.agentNickname ? ` · Agent: ${summary.agentNickname}` : ''}`,
    );
  }
  if (summary.branches.length > 0) {
    lines.push(`Branches: ${summary.branches.join(', ')}`);
  }
  if (summary.commits.length > 0) {
    lines.push('Commits:');
    summary.commits.forEach((commit) => lines.push(`- ${commit}`));
  }
  if (summary.pulls.length > 0) {
    lines.push('Pull requests:');
    summary.pulls.forEach((pr) => lines.push(`- ${pr}`));
  }
  if (summary.pushes.length > 0) {
    lines.push('Pushes:');
    summary.pushes.forEach((push) => lines.push(`- ${push}`));
  }
  if (summary.errors.length > 0) {
    lines.push('Errors / warnings:');
    summary.errors.slice(0, 5).forEach((error) => lines.push(`- ${error}`));
    if (summary.errors.length > 5) {
      lines.push(`- … ${summary.errors.length - 5} additional entries`);
    }
  }
  if (summary.finalSummary) {
    lines.push('Final response:');
    lines.push(truncate(summary.finalSummary, 800));
  }
  lines.push(`Session file: ${summary.filePath}`);
  return lines.join('\n');
}

async function logSummary(summary, dryRun = false) {
  const content = buildSummaryText(summary);
  if (dryRun) {
    console.log('---');
    console.log(content);
    console.log('--- (dry run)');
    return;
  }

  await logEventViaMcp(
    {
      source: 'codex-session',
      type: 'builder_summary',
      content,
      context: {
        session_file: summary.filePath,
        session_id: summary.sessionId,
        cwd: summary.cwd,
        originator: summary.originator,
        branches: summary.branches,
        commits: summary.commits,
        pull_requests: summary.pulls,
        pushes: summary.pushes,
        error_count: summary.errors.length,
        has_final_summary: Boolean(summary.finalSummary),
      },
    },
    { shared: true },
  );
  console.log(`Logged Codex summary for ${summary.filePath}`);
}

async function main() {
  const options = parseArgs();
  const start = Date.now();

  let candidateFiles = options.files;
  if (candidateFiles.length === 0) {
    candidateFiles = await listSessionFiles(options.root);
    if (options.sinceMinutes) {
      const cutoff = Date.now() - options.sinceMinutes * 60 * 1000;
      candidateFiles = await Promise.all(
        candidateFiles.map(async (filePath) => {
          const stat = await fs.stat(filePath).catch(() => null);
          return stat && stat.mtimeMs >= cutoff ? filePath : null;
        }),
      );
      candidateFiles = candidateFiles.filter(Boolean);
    }
  }

  if (candidateFiles.length === 0) {
    console.error('No Codex session files found.');
    process.exit(1);
  }

  const filesToProcess =
    options.count === Number.POSITIVE_INFINITY
      ? candidateFiles
      : candidateFiles.slice(0, options.count);

  for (const filePath of filesToProcess) {
    const summary = await parseSession(filePath);
    if (!summary) {
      console.warn(`Skipping ${filePath} (no readable events)`);
      continue;
    }
    await logSummary(summary, options.dryRun);
  }

  const elapsedMs = Date.now() - start;
  console.log(
    options.dryRun
      ? `codex-postexec complete (dry run, ${filesToProcess.length} file(s), ${elapsedMs} ms)`
      : `codex-postexec logged ${filesToProcess.length} file(s) in ${elapsedMs} ms`,
  );

  if (!options.dryRun) {
    await closeSharedDatacoreSession().catch(() => {});
  }
}

main().catch((error) => {
  console.error('codex-postexec failed:', error);
  process.exit(1);
});
