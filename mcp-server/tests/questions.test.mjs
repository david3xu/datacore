// questions.test.mjs — Does async AI-to-AI question/answer work?

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

const distPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../dist');
const { appendEvent } = await import(path.join(distPath, 'store.js'));
const { getQuestions } = await import(path.join(distPath, 'questions.js'));

let tempDir;

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datacore-questions-'));
  process.env.DATACORE_BRONZE_DIR = tempDir;
});

after(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  delete process.env.DATACORE_BRONZE_DIR;
});

test('question lifecycle: ask → find open → answer → find answered', async () => {
  // Ask a question
  await appendEvent({
    source: 'gemini',
    type: 'question',
    content: 'Should entity_type be an enum or free string?',
    context: {
      thread_id: 'q-2026-03-26-001',
      task_id: 'GOLD-PHASE-1',
      asked_by: 'gemini',
      directed_to: 'claude-desktop',
      status: 'open',
    },
  });

  // Find open questions
  const open = await getQuestions({ status: 'open' });
  assert.ok(open.total >= 1, 'should have at least 1 open question');
  const q = open.questions.find((q) => q.thread_id === 'q-2026-03-26-001');
  assert.ok(q, 'should find the question');
  assert.equal(q.status, 'open');
  assert.equal(q.asked_by, 'gemini');
  assert.equal(q.directed_to, 'claude-desktop');

  // Answer it
  await appendEvent({
    source: 'claude-desktop',
    type: 'answer',
    content: 'Free string. Validate at display time, not write time.',
    context: {
      thread_id: 'q-2026-03-26-001',
      task_id: 'GOLD-PHASE-1',
      answered_by: 'claude-desktop',
      status: 'answered',
    },
  });

  // Now open should exclude answered
  const openAfter = await getQuestions({ status: 'open' });
  const gone = openAfter.questions.find((q) => q.thread_id === 'q-2026-03-26-001');
  assert.equal(gone, undefined, 'answered question should not appear in open');

  // Answered should include it
  const answered = await getQuestions({ status: 'answered' });
  const found = answered.questions.find((q) => q.thread_id === 'q-2026-03-26-001');
  assert.ok(found, 'should find in answered');
  assert.equal(found.status, 'answered');
  assert.equal(found.answer, 'Free string. Validate at display time, not write time.');
  assert.equal(found.answered_by, 'claude-desktop');
});

test('directed_to filter works', async () => {
  await appendEvent({
    source: 'openclaw',
    type: 'question',
    content: 'Should R23 go to Gemini or Codex?',
    context: {
      thread_id: 'q-2026-03-26-002',
      asked_by: 'openclaw',
      directed_to: 'claude-desktop',
      status: 'open',
    },
  });

  const forClaude = await getQuestions({ directed_to: 'claude-desktop', status: 'all' });
  assert.ok(forClaude.total >= 1, 'claude should have questions');

  const forGemini = await getQuestions({ directed_to: 'gemini', status: 'all' });
  const wrongMatch = forGemini.questions.find((q) => q.thread_id === 'q-2026-03-26-002');
  assert.equal(wrongMatch, undefined, 'gemini should not see claude questions');
});

test('task_id filter works', async () => {
  const forGold = await getQuestions({ task_id: 'GOLD-PHASE-1', status: 'all' });
  assert.ok(forGold.total >= 1, 'should find questions about GOLD-PHASE-1');
  assert.ok(forGold.questions.every((q) => q.task_id === 'GOLD-PHASE-1'));
});

test('status=all returns everything', async () => {
  const all = await getQuestions({ status: 'all' });
  assert.ok(all.total >= 2, 'should have at least 2 questions total');
});

test('empty result for unknown directed_to', async () => {
  const result = await getQuestions({ directed_to: 'nonexistent-agent' });
  assert.equal(result.total, 0);
  assert.deepEqual(result.questions, []);
});
