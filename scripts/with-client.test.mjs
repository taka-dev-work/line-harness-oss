import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientWranglerInvocation } from './lib/with-client.mjs';
import { validFixture } from './lib/test-fixtures.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'with-client.mjs');

test('renders to a per-slug config path and appends --config', () => {
  const inv = clientWranglerInvocation(validFixture(), ['d1', 'migrations', 'apply', 'DB', '--remote']);
  assert.equal(inv.configPath, 'apps/worker/wrangler.acme.toml');
  assert.deepEqual(inv.argv, ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '--config', 'apps/worker/wrangler.acme.toml']);
  assert.match(inv.banner, /acme/);
  assert.match(inv.banner, /0123456789abcdef0123456789abcdef/);
});

test('refuses a passthrough --config or --env', () => {
  assert.throws(() => clientWranglerInvocation(validFixture(), ['deploy', '--config', 'other.toml']), /--config/);
  assert.throws(() => clientWranglerInvocation(validFixture(), ['deploy', '--env', 'production']), /--env/);
});

test('refuses an invalid client config', () => {
  assert.throws(() => clientWranglerInvocation({ ...validFixture(), apiToken: 'x' }, ['deploy']), /unknown key: apiToken/);
});

test('CLI fails without --client', () => {
  let status = 0;
  try {
    execFileSync('node', [CLI, '--', 'deploy'], { stdio: 'pipe' });
  } catch (error) {
    status = error.status;
  }
  assert.equal(status, 1);
});
