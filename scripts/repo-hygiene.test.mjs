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

test('per-slug rendered configs are gitignored but wrangler.toml is not', () => {
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'apps/worker/wrangler.acme.toml'], { cwd: root }).status, 0);
  assert.equal(spawnSync('git', ['check-ignore', '-q', 'apps/worker/wrangler.toml'], { cwd: root }).status, 1);
});

test('no npm script reuses a previously rendered client config', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    assert.doesNotMatch(cmd, /wrangler\.client\.toml/, name);
  }
});

test('docs run the drift check before the first remote migration', () => {
  for (const doc of ['docs/ai-line-crm-production-checklist.md', 'docs/ai-line-crm-installation-guide.md']) {
    const body = readFileSync(join(root, doc), 'utf8');
    const drift = body.indexOf('db:drift:client');
    const migrate = body.indexOf('db:migrate:client');
    assert.ok(drift !== -1, `${doc} must mention db:drift:client`);
    assert.ok(drift < migrate, `${doc} must run the drift check before db:migrate:client`);
    assert.doesNotMatch(body, /wrangler\.client\.toml/, doc);
  }
});

test('checklist documents a recovery path that actually works', () => {
  const body = readFileSync(join(root, 'docs/ai-line-crm-production-checklist.md'), 'utf8');
  assert.match(body, /UPDATE staff_members SET is_active = 0 WHERE role = 'owner'/);
  assert.doesNotMatch(body, /全オーナーを無効化・削除すると/);
});

test('seed scripts use the shared admin API headers', () => {
  for (const file of ['scripts/apply-ai-line-crm-blueprint.mjs', 'scripts/create-ai-line-crm-test-scenario.mjs']) {
    const body = readFileSync(join(root, file), 'utf8');
    assert.match(body, /adminApiHeaders/, file);
    assert.doesNotMatch(body, /Authorization: `Bearer/, file);
  }
});
