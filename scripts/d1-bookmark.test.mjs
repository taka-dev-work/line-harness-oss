import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBookmark, appendOutput } from './lib/d1-bookmark.mjs';

const BM = '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';

test('parses the bookmark from time-travel info --json', () => {
  assert.equal(parseBookmark(`{"bookmark":"${BM}"}`), BM);
});

test('refuses a missing or empty bookmark', () => {
  assert.throws(() => parseBookmark('{}'), /no bookmark/);
  assert.throws(() => parseBookmark('{"bookmark":""}'), /no bookmark/);
});

test('surfaces a wrangler error object', () => {
  assert.throws(() => parseBookmark('{"error":{"text":"A request failed.","notes":[{"text":"Authentication error"}]}}'), /Authentication error/);
});

test('appendOutput appends key=value lines for GITHUB_OUTPUT', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gh-out-'));
  try {
    const file = join(dir, 'out');
    writeFileSync(file, 'existing=1\n');
    appendOutput(file, 'bookmark', BM);
    assert.equal(readFileSync(file, 'utf8'), `existing=1\nbookmark=${BM}\n`);
    assert.throws(() => appendOutput(file, 'bookmark', 'a\nb'), /newline/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
