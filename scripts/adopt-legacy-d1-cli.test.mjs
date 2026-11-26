import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validFixture } from './lib/test-fixtures.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'adopt-legacy-d1.mjs');

// Every case here must stop before wrangler runs: no banner, no network.
function runCli(args, config = validFixture()) {
  const dir = mkdtempSync(join(tmpdir(), 'adopt-cli-'));
  try {
    const client = join(dir, 'client.json');
    writeFileSync(client, JSON.stringify(config));
    writeFileSync(join(dir, 'empty.sql'), '');
    writeFileSync(join(dir, 'export.sql'), 'CREATE TABLE x (id TEXT);');
    const resolved = args.map((a) => a.replace('$DIR', dir));
    const r = spawnSync('node', [CLI, '--client', client, ...resolved], { encoding: 'utf8' });
    assert.doesNotMatch(r.stderr, /cloudflare account:/, 'must not reach wrangler');
    return r;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const APPLY_OK = ['--out', '$DIR/out.sql', '--apply', '--export-file', '$DIR/export.sql', '--bookmark', 'bm-1', '--confirm', 'ai-line-crm'];
const without = (flag) => {
  const i = APPLY_OK.indexOf(flag);
  return [...APPLY_OK.slice(0, i), ...APPLY_OK.slice(i + 2)];
};

test('requires --out', () => {
  const r = runCli([]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage:/);
});

test('--apply requires --export-file', () => {
  const r = runCli(without('--export-file'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--export-file/);
});

test('--apply refuses an empty export file', () => {
  const r = runCli(APPLY_OK.map((a) => (a === '$DIR/export.sql' ? '$DIR/empty.sql' : a)));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /empty/);
});

test('--apply requires --bookmark', () => {
  const r = runCli(without('--bookmark'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--bookmark/);
});

test('--apply requires --confirm to equal the d1 database name', () => {
  const r = runCli(APPLY_OK.map((a) => (a === 'ai-line-crm' ? 'wrong-name' : a)));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--confirm must equal/);
});

test('rejects an invalid client config', () => {
  const r = runCli(['--out', '$DIR/out.sql'], { ...validFixture(), apiToken: 'x' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown key/);
});

test('--persist-to is only allowed with --local', () => {
  const r = runCli(['--out', '$DIR/out.sql', '--persist-to', '$DIR/state']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--persist-to requires --local/);
});
