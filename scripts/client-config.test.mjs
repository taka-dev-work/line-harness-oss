import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClientConfig } from './lib/client-config.mjs';
import { validFixture } from './lib/test-fixtures.mjs';


test('accepts a complete valid config', () => {
  const result = validateClientConfig(validFixture());
  assert.equal(result.ok, true);
  assert.equal(result.config.slug, 'acme');
});

test('rejects unknown key', () => {
  const raw = validFixture();
  raw.build.LINE_CHANNEL_SECRET = 'x';
  const result = validateClientConfig(raw);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('unknown key: build.LINE_CHANNEL_SECRET'), result.errors.join('\n'));
});

test('rejects top-level unknown key', () => {
  const raw = { ...validFixture(), apiToken: 'x' };
  const result = validateClientConfig(raw);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('unknown key: apiToken'));
});

test('rejects domain with scheme, uppercase, path or trailing dot', () => {
  for (const bad of ['https://line.acme.example', 'Line.acme.example', 'line.acme.example/x', 'line.acme.example.']) {
    const result = validateClientConfig({ ...validFixture(), customDomain: bad });
    assert.equal(result.ok, false, bad);
    assert.ok(result.errors.every((e) => e.includes('customDomain')), `${bad}: ${result.errors.join('\n')}`);
  }
});

test('rejects identical customDomain and adminDomain', () => {
  const raw = { ...validFixture(), adminDomain: 'line.acme.example' };
  const result = validateClientConfig(raw);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('adminDomain must differ from customDomain')));
});

test('rejects short commit', () => {
  const raw = validFixture();
  raw.release.commit = 'abc123';
  const result = validateClientConfig(raw);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('release.commit')));
});

test('rejects uppercase account id', () => {
  const raw = { ...validFixture(), cloudflareAccountId: '0123456789ABCDEF0123456789ABCDEF' };
  const result = validateClientConfig(raw);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('cloudflareAccountId')));
});

test('reports all errors at once', () => {
  const raw = { ...validFixture(), slug: 'Bad Slug', workerName: '', d1DatabaseId: 'nope' };
  const result = validateClientConfig(raw);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3, result.errors.join('\n'));
});

test('rejects non-object input', () => {
  for (const raw of [null, [], 'x', 1]) {
    const result = validateClientConfig(raw);
    assert.equal(result.ok, false);
  }
});
