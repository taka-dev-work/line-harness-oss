import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wranglerFailureMessage } from './lib/client-runner.mjs';

test('I-1: failure message keeps every [ERROR] line, not just the last stderr line', () => {
  const stderr = [
    '⛅️ wrangler 4.77.0',
    '✘ [ERROR] Cannot add a column with non-constant default: SQLITE_ERROR',
    '',
    '🪵  Logs were written to "/Users/x/.wrangler/logs/wrangler.log"',
  ].join('\n');
  const msg = wranglerFailureMessage({ status: 1, stdout: '', stderr });
  assert.match(msg, /non-constant default/);
  assert.match(msg, /exited 1/);
});

test('I-1: falls back to the last non-empty stderr line when there is no [ERROR] line', () => {
  assert.match(wranglerFailureMessage({ status: 2, stdout: '', stderr: 'a\nnetwork down\n\n' }), /exited 2: network down/);
});

test('M-9: non-JSON stdout starting with { does not mask the error', () => {
  assert.match(wranglerFailureMessage({ status: 1, stdout: '{not json', stderr: '✘ [ERROR] boom' }), /boom/);
});

test('JSON error object on stdout is surfaced', () => {
  const stdout = '{"error":{"text":"A request failed.","notes":[{"text":"SQLITE_AUTH"}]}}';
  assert.match(wranglerFailureMessage({ status: 1, stdout, stderr: '' }), /A request failed\.: SQLITE_AUTH/);
});
