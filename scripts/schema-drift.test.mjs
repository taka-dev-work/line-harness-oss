import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSchemas, columnsFromRows } from './lib/schema-drift.mjs';

const map = (obj) => new Map(Object.entries(obj).map(([t, cols]) => [t, new Set(cols)]));

test('reports missing column', () => {
  const diff = diffSchemas(map({ friends: ['id', 'name', 'score'] }), map({ friends: ['id', 'name'] }));
  assert.deepEqual(diff.missingColumns, ['friends.score']);
  assert.deepEqual(diff.missingTables, []);
});

test('reports missing table', () => {
  const diff = diffSchemas(map({ friends: ['id'], tags: ['id'] }), map({ friends: ['id'] }));
  assert.deepEqual(diff.missingTables, ['tags']);
  assert.deepEqual(diff.missingColumns, []);
});

test('reports extra table without failing', () => {
  const diff = diffSchemas(map({ friends: ['id'] }), map({ friends: ['id'], legacy: ['id'] }));
  assert.deepEqual(diff.extraTables, ['legacy']);
  assert.deepEqual(diff.missingTables, []);
  assert.deepEqual(diff.missingColumns, []);
});

test('ignores d1 bookkeeping tables', () => {
  const rows = [
    { t: 'friends', c: 'id' },
    { t: 'd1_migrations', c: 'id' },
    { t: '_cf_KV', c: 'key' },
    { t: 'sqlite_sequence', c: 'name' },
  ];
  assert.deepEqual([...columnsFromRows(rows).keys()], ['friends']);
});

test('drift is measured against the frozen baseline, not schema.sql', async () => {
  const { EXPECTED_SCHEMA_FILE } = await import('./lib/schema-drift.mjs');
  assert.equal(EXPECTED_SCHEMA_FILE, 'packages/db/d1-migrations/0000_baseline.sql');
});
