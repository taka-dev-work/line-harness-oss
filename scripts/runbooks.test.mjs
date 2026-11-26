import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'docs/runbooks');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
const read = (f) => readFileSync(join(dir, f), 'utf8');
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;

test('runbooks exist and are all linked from the README', () => {
  assert.ok(files.includes('README.md'), 'docs/runbooks/README.md');
  const readme = read('README.md');
  const linked = [...readme.matchAll(/\]\(\.\/([^)#]+\.md)\)/g)].map((m) => m[1]);
  for (const f of linked) assert.ok(existsSync(join(dir, f)), `linked but missing: ${f}`);
  for (const f of files.filter((f) => f !== 'README.md')) assert.ok(linked.includes(f), `not linked from README: ${f}`);
  assert.ok(files.length >= 7, 'README + 6 runbooks');
});

test('every pnpm script a runbook cites exists', () => {
  for (const f of files) {
    for (const [, name] of read(f).matchAll(/\bpnpm (?:-s )?([a-z][\w:-]*)/g)) {
      if (['install', 'exec', 'run', 'dlx'].includes(name)) continue;
      assert.ok(name in scripts, `${f}: pnpm ${name} is not a package.json script`);
    }
  }
});

test('every scripts/*.mjs a runbook cites exists', () => {
  for (const f of files) {
    for (const [path] of read(f).matchAll(/scripts\/[\w/.-]+\.mjs/g)) {
      assert.ok(existsSync(join(root, path)), `${f}: ${path}`);
    }
  }
});

test('runbooks carry no identifiers, emails or keys (public repo)', () => {
  for (const f of files) {
    const body = read(f);
    assert.doesNotMatch(body, /\b[0-9a-f]{32}\b/, `${f}: 32-hex id`);
    assert.doesNotMatch(body, /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/, `${f}: uuid`);
    assert.doesNotMatch(body, /[\w.+-]+@[\w-]+\.[\w.]+/, `${f}: email`);
    assert.doesNotMatch(body, /\blh_[0-9a-f]{8,}/, `${f}: staff key`);
  }
});

test('I-3: onboarding sets every secret the production checklist sets', () => {
  const checklist = readFileSync(join(root, 'docs/ai-line-crm-production-checklist.md'), 'utf8');
  const onboarding = read('onboarding.md');
  for (const [, name] of checklist.matchAll(/secret put ([A-Z_]+)/g)) {
    assert.match(onboarding, new RegExp(`secret put ${name}\\b`), `onboarding.md misses ${name}`);
  }
});

test('I-4: incident and rotation runbooks cover LEGACY_API_KEY', () => {
  for (const f of ['incident.md', 'secret-rotation.md']) assert.match(read(f), /LEGACY_API_KEY/, f);
});

test('I-2: legacy notes no longer promise every failure is caught before SQL is generated', () => {
  const notes = read('legacy-d1-notes.md');
  assert.match(notes, /行がある/);
  assert.match(notes, /定数でない既定値/);
});
