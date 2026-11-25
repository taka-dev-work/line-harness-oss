import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWranglerToml, renderWebBuildEnv } from './lib/render-wrangler.mjs';
import { validFixture } from './lib/test-fixtures.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'render-wrangler-config.mjs');

test('renders account and database ids', () => {
  const out = renderWranglerToml(validFixture());
  assert.ok(out.includes('account_id = "0123456789abcdef0123456789abcdef"'));
  assert.ok(out.includes('database_id = "01234567-89ab-cdef-0123-456789abcdef"'));
  assert.ok(out.includes('database_name = "ai-line-crm"'));
  assert.ok(out.includes('name = "ai-line-crm"'));
});

test('disables workers.dev', () => {
  assert.ok(renderWranglerToml(validFixture()).includes('workers_dev = false'));
});

test('renders both custom domain routes', () => {
  const out = renderWranglerToml(validFixture());
  assert.equal(out.match(/custom_domain = true/g)?.length, 2);
  assert.ok(out.indexOf('line.acme.example') < out.indexOf('admin.acme.example'));
});

test('points migrations_dir at d1-migrations', () => {
  assert.ok(renderWranglerToml(validFixture()).includes('migrations_dir = "../../packages/db/d1-migrations"'));
});

test('uses default model vars when vars omitted', () => {
  const out = renderWranglerToml(validFixture());
  assert.ok(out.includes('OPENAI_MODEL = "gpt-5-mini"'));
  assert.ok(out.includes('ANTHROPIC_MODEL = "claude-sonnet-5"'));
  assert.ok(out.includes('GEMINI_MODEL = "gemini-3.6-flash"'));
});

test('escapes quotes in values', () => {
  const cfg = { ...validFixture(), vars: { OPENAI_MODEL: 'a"b' } };
  const out = renderWranglerToml(cfg);
  assert.ok(out.includes('OPENAI_MODEL = "a\\"b"'));
  assert.ok(!out.includes('株式会社ACME'));
});

test('refuses to render an invalid config', () => {
  assert.throws(() => renderWranglerToml({ ...validFixture(), apiToken: 'x' }), /unknown key: apiToken/);
});

test('renderWebBuildEnv returns build keys and pins the admin API to same-origin', () => {
  assert.deepEqual(renderWebBuildEnv(validFixture()), { ...validFixture().build, NEXT_PUBLIC_API_URL: '' });
});

test('CLI exits 1 on invalid config without printing values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'render-wrangler-'));
  try {
    const bad = validFixture();
    bad.build.LINE_CHANNEL_SECRET = 'super-secret-value';
    const file = join(dir, 'client.json');
    writeFileSync(file, JSON.stringify(bad));
    let status = 0;
    let stdout = '';
    let stderr = '';
    try {
      execFileSync('node', [CLI, '--client', file, '--out', join(dir, 'out.toml')], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      status = error.status;
      stdout = error.stdout;
      stderr = error.stderr;
    }
    assert.equal(status, 1);
    assert.equal(stdout, '');
    assert.ok(stderr.includes('unknown key'));
    assert.ok(!stderr.includes('super-secret-value'));
    assert.ok(!existsSync(join(dir, 'out.toml')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI writes config and web env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'render-wrangler-'));
  try {
    const file = join(dir, 'client.json');
    writeFileSync(file, JSON.stringify(validFixture()));
    execFileSync('node', [CLI, '--client', file, '--out', join(dir, 'out.toml'), '--web-env-out', join(dir, 'web.env')], { stdio: 'pipe' });
    assert.ok(readFileSync(join(dir, 'out.toml'), 'utf8').includes('workers_dev = false'));
    assert.equal(readFileSync(join(dir, 'web.env'), 'utf8'), 'VITE_LIFF_ID=1234567890-abcdefgh\nVITE_BOT_BASIC_ID=@acme\nNEXT_PUBLIC_API_URL=\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renders ACCESS vars', () => {
  const out = renderWranglerToml(validFixture());
  assert.ok(out.includes('ACCESS_TEAM_DOMAIN = "nibel-acme.cloudflareaccess.com"'));
  assert.ok(out.includes(`ACCESS_AUD = "${'a'.repeat(64)}"`));
});
