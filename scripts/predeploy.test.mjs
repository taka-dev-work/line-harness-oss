import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyD1 } from './lib/predeploy.mjs';

const noDiff = { missingTables: [], missingColumns: [] };

test('empty d1 (only internal tables) is ok', () => {
  const r = classifyD1({ tables: ['_cf_KV', 'd1_migrations', 'sqlite_sequence'], applied: [], diff: { missingTables: ['friends'], missingColumns: [] } });
  assert.deepEqual([r.state, r.ok], ['empty', true]);
});

test('legacy d1 (user tables, baseline not recorded) is refused with the runbook', () => {
  const r = classifyD1({ tables: ['_cf_KV', 'friends'], applied: [], diff: noDiff });
  assert.deepEqual([r.state, r.ok], ['legacy', false]);
  assert.match(r.message, /docs\/runbooks\/client-0-adoption\.md/);
});

test('legacy d1 with an empty d1_migrations left by a failed migrations apply is still legacy', () => {
  const r = classifyD1({ tables: ['d1_migrations', 'friends'], applied: [], diff: noDiff });
  assert.deepEqual([r.state, r.ok], ['legacy', false]);
});

test('adopted d1 with drift is refused and lists what is missing', () => {
  const r = classifyD1({ tables: ['d1_migrations', 'friends'], applied: ['0000_baseline.sql'], diff: { missingTables: ['tags'], missingColumns: ['friends.metadata'] } });
  assert.deepEqual([r.state, r.ok], ['adopted', false]);
  assert.match(r.message, /tags/);
  assert.match(r.message, /friends\.metadata/);
});

test('adopted d1 without drift is ok', () => {
  const r = classifyD1({ tables: ['d1_migrations', 'friends'], applied: ['0000_baseline.sql', '0001_auth_hardening.sql'], diff: noDiff });
  assert.deepEqual([r.state, r.ok], ['adopted', true]);
});
