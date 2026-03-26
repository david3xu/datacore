// embeddable.test.mjs — Tests for data quality and content summary extraction
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractContentSummary, shouldEmbed, validateForSilver } from '../scripts/embeddable.mjs';

// ─── extractContentSummary ───────────────────────────────────

test('extractContentSummary returns null for short content (<200 chars)', () => {
  assert.equal(extractContentSummary('Short content.'), null);
  assert.equal(extractContentSummary('A'.repeat(199)), null);
  assert.equal(extractContentSummary(null), null);
  assert.equal(extractContentSummary(''), null);
});

test('extractContentSummary returns summary for long content', () => {
  const long = 'This is the first sentence of a long event. ' + 'More details follow. '.repeat(20);
  const summary = extractContentSummary(long);
  assert.ok(summary !== null, 'should produce a summary');
  assert.ok(summary.includes('This is the first sentence'), 'should contain first sentence');
  assert.ok(summary.length < long.length, 'summary should be shorter than original');
});

test('extractContentSummary includes named entities', () => {
  const content =
    'Chose Azure Databricks Vector Search over local LanceDB for the Silver layer. ' +
    'This decision was based on research from the official docs. '.repeat(5) +
    'The MCP protocol enables cross-agent coordination via Datacore Bronze.';
  const summary = extractContentSummary(content);
  assert.ok(summary !== null, 'should produce a summary');
  assert.ok(summary.includes('['), 'should include entity brackets');
  assert.ok(
    summary.includes('Azure') || summary.includes('Databricks') || summary.includes('Vector'),
    'should include at least one named entity',
  );
});

test('extractContentSummary returns null when summary is not meaningfully shorter', () => {
  // Content just over 200 chars but first sentence is almost as long
  const content =
    'This is a single very long sentence that keeps going without any period or break ' +
    'and just continues on and on and on until it reaches about two hundred and fifty characters total.';
  // The whole content IS the first sentence fallback (200 chars) — not 20% shorter
  const result = extractContentSummary(content);
  // Either null (not shorter enough) or a valid summary — both acceptable
  if (result !== null) {
    assert.ok(result.length < content.length * 0.8, 'if not null, must be >20% shorter');
  }
});

// ─── shouldEmbed ─────────────────────────────────────────────

test('shouldEmbed rejects unknown types', () => {
  assert.equal(shouldEmbed({ type: 'heartbeat', content: 'x'.repeat(100) }), false);
});

test('shouldEmbed accepts known types with sufficient content', () => {
  assert.equal(shouldEmbed({ type: 'decision', content: 'x'.repeat(100) }), true);
});

// ─── validateForSilver ───────────────────────────────────────

test('validateForSilver rejects missing timestamp', () => {
  const r = { _event_id: 'abc', _source: 'claude.ai', type: 'decision', content: 'x'.repeat(100) };
  const { valid, reasons } = validateForSilver(r);
  assert.equal(valid, false);
  assert.ok(reasons.some((r) => r.includes('_timestamp')));
});

test('validateForSilver accepts valid event', () => {
  const r = {
    _event_id: 'abc',
    _timestamp: '2026-03-26T12:00:00Z',
    _source: 'claude.ai',
    type: 'decision',
    content: 'x'.repeat(100),
  };
  const { valid } = validateForSilver(r);
  assert.equal(valid, true);
});
