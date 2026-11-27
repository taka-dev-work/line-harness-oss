import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRelease } from './lib/release.mjs';
import { validFixture } from './lib/test-fixtures.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'verify-release.mjs');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const release = { tag: 'v1.2.3-nibel.1', commit: A };

test('ok when tag, HEAD and release.commit agree', () => {
  assert.deepEqual(checkRelease({ release, tagCommit: A, headCommit: A }), { ok: true, errors: [] });
});

test('missing tag', () => {
  const r = checkRelease({ release, tagCommit: null, headCommit: A });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['tag v1.2.3-nibel.1 not found']);
});

test('tag points elsewhere', () => {
  const r = checkRelease({ release, tagCommit: B, headCommit: A });
  assert.deepEqual(r.errors, [`tag v1.2.3-nibel.1 points to ${B}, client.json pins ${A}`]);
});

test('HEAD is not the pinned commit', () => {
  const r = checkRelease({ release, tagCommit: A, headCommit: B });
  assert.deepEqual(r.errors, [`checked-out HEAD ${B} is not release.commit ${A}`]);
});

test('CLI checks a real git repo: right tag passes, moved tag fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'one');
    const head = git('rev-parse', 'HEAD');
    git('tag', 'v1.0.0-nibel.1');
    const client = join(dir, 'client.json');
    writeFileSync(client, JSON.stringify({ ...validFixture(), release: { tag: 'v1.0.0-nibel.1', commit: head } }));
    const ok = spawnSync('node', [CLI, '--client', client, '--repo', dir], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);

    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'two');
    git('tag', '-f', 'v1.0.0-nibel.1');
    git('checkout', '-q', head);
    const moved = spawnSync('node', [CLI, '--client', client, '--repo', dir], { encoding: 'utf8' });
    assert.equal(moved.status, 1);
    assert.match(moved.stderr, /points to/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
