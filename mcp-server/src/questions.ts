// questions.ts — How do AI agents ask each other questions asynchronously?

import type { BronzeRecord, QuestionInput, QuestionSummary, QuestionResult } from './types.js';
import { readAllRecords } from './store.js';

export async function getQuestions({
  directed_to,
  status = 'open',
  task_id,
  limit = 10,
}: QuestionInput = {}): Promise<QuestionResult> {
  const { bronzeDir, records } = await readAllRecords({});

  // Collect all question and answer events
  const questions = records.filter((r) => r.type === 'question');
  const answers = records.filter((r) => r.type === 'answer');

  // Index answers by thread_id for fast lookup
  const answerMap = new Map<string, BronzeRecord>();
  for (const a of answers) {
    const tid = (a.context as Record<string, unknown>)?.thread_id as string | undefined;
    if (tid) answerMap.set(tid, a);
  }

  const results: QuestionSummary[] = [];

  for (const q of questions) {
    const ctx = (q.context as Record<string, unknown>) ?? {};
    const threadId = (ctx.thread_id as string) ?? '';
    if (!threadId) continue;

    const answerRecord = answerMap.get(threadId);
    const isAnswered = !!answerRecord;

    // Filter by status
    if (status === 'open' && isAnswered) continue;
    if (status === 'answered' && !isAnswered) continue;

    // Filter by directed_to
    const directedTo = (ctx.directed_to as string) ?? null;
    if (directed_to && directedTo?.toLowerCase() !== directed_to.toLowerCase()) continue;

    // Filter by task_id
    const qTaskId = (ctx.task_id as string) ?? null;
    if (task_id && qTaskId !== task_id) continue;

    const answerCtx = answerRecord ? ((answerRecord.context as Record<string, unknown>) ?? {}) : {};

    results.push({
      thread_id: threadId,
      question: q.content ?? '',
      asked_by: (ctx.asked_by as string) ?? q._source ?? null,
      directed_to: directedTo,
      task_id: qTaskId,
      status: isAnswered ? 'answered' : 'open',
      asked_at: q._timestamp ?? null,
      answered_at: answerRecord?._timestamp ?? null,
      answer: answerRecord?.content ?? null,
      answered_by: (answerCtx.answered_by as string) ?? answerRecord?._source ?? null,
    });
  }

  // Sort newest first
  results.sort((a, b) => (b.asked_at ?? '').localeCompare(a.asked_at ?? ''));

  return {
    bronzeDir,
    total: results.length,
    questions: results.slice(0, limit),
  };
}
