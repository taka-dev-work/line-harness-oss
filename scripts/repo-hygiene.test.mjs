import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = readFileSync(join(root, 'apps/worker/wrangler.toml'), 'utf8');

test('wrangler.toml has no real account id', () => {
  assert.doesNotMatch(wrangler, /account_id\s*=\s*"[0-9a-f]{32}"/);
});

test('wrangler.toml has no real d1 id', () => {
  assert.doesNotMatch(wrangler, /database_id\s*=\s*"[0-9a-f-]{36}"/);
});

test('no deploy workflow in public repo', () => {
  const dir = join(root, '.github/workflows');
  const files = existsSync(dir) ? readdirSync(dir) : [];
  for (const file of files) {
    const body = readFileSync(join(dir, file), 'utf8');
    assert.doesNotMatch(body, /wrangler-action|wrangler deploy/, file);
  }
});

test('rendered config is gitignored', () => {
  const result = spawnSync('git', ['check-ignore', '-q', 'apps/worker/wrangler.client.toml'], { cwd: root });
  assert.equal(result.status, 0);
});
