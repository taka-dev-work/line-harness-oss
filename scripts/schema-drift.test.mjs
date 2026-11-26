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

// --- remote D1 (Task 1, Plan 4) ---
import { pragmaBatch, rowsFromPragmaResults, parseWranglerJson, remoteTableColumns, TABLES_QUERY } from './lib/schema-drift.mjs';

test('pragmaBatch emits one PRAGMA table_info per table', () => {
  assert.equal(pragmaBatch(['friends', 'tags']), 'PRAGMA table_info("friends");PRAGMA table_info("tags");');
});

test('pragmaBatch refuses unsafe table names', () => {
  assert.throws(() => pragmaBatch(['a"b']), /unsafe table name/);
  assert.throws(() => pragmaBatch(['a b']), /unsafe table name/);
});

test('rowsFromPragmaResults maps each result to its table', () => {
  assert.deepEqual(
    rowsFromPragmaResults(['t1', 't2'], [{ results: [{ name: 'id' }] }, { results: [{ name: 'id' }, { name: 'x' }] }]),
    [{ t: 't1', c: 'id' }, { t: 't2', c: 'id' }, { t: 't2', c: 'x' }],
  );
  assert.throws(() => rowsFromPragmaResults(['t1', 't2'], [{ results: [] }]), /2 tables but 1 results/);
});

test('parseWranglerJson surfaces the cloudflare error text', () => {
  const out = '{"error":{"text":"A request failed.","notes":[{"text":"not authorized: SQLITE_AUTH [code: 7500]"}]}}';
  assert.throws(() => parseWranglerJson(out), /A request failed\.: not authorized: SQLITE_AUTH/);
  assert.deepEqual(parseWranglerJson('[{"results":[]}]'), [{ results: [] }]);
});

test('remoteTableColumns queries tables then one pragma batch, skipping bookkeeping tables', () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    if (calls.length === 1) {
      return JSON.stringify([{ results: [{ name: '_cf_KV' }, { name: 'd1_migrations' }, { name: 'friends' }, { name: 'sqlite_sequence' }] }]);
    }
    return JSON.stringify([{ results: [{ name: 'id' }, { name: 'name' }] }]);
  };
  const cols = remoteTableColumns(run);
  assert.deepEqual([...cols.keys()], ['friends']);
  assert.deepEqual([...cols.get('friends')], ['id', 'name']);
  assert.equal(calls[0].at(-1), TABLES_QUERY);
  assert.equal(calls[1].at(-1), 'PRAGMA table_info("friends");');
});

test('remoteTableColumns skips every Cloudflare-internal _cf_ table', () => {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return calls.length === 1
      ? JSON.stringify([{ results: [{ name: '_cf_METADATA' }, { name: '_cf_KV' }, { name: 'tags' }] }])
      : JSON.stringify([{ results: [{ name: 'id' }] }]);
  };
  assert.deepEqual([...remoteTableColumns(run).keys()], ['tags']);
  assert.equal(calls[1].at(-1), 'PRAGMA table_info("tags");');
});
