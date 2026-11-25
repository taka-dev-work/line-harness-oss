import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tableColumns, diffSchemas } from './lib/schema-drift.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'packages/db/d1-migrations');
const schemaPath = join(root, 'packages/db/schema.sql');
const migrationFiles = () => readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

function withTempDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'd1-migrations-'));
  try {
    return fn(join(dir, 'test.db'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const applySql = (db, file) => execFileSync('sqlite3', [db], { input: readFileSync(file) });

test('baseline equals schema.sql', () => {
  assert.ok(readFileSync(join(migrationsDir, '0000_baseline.sql')).equals(readFileSync(schemaPath)));
});

test('file names are NNNN_name.sql', () => {
  for (const file of migrationFiles()) assert.match(file, /^\d{4}_[a-z0-9_]+\.sql$/);
});

test('migrations apply cleanly to empty db', () => {
  withTempDb((db) => {
    for (const file of migrationFiles()) applySql(db, join(migrationsDir, file));
  });
});

test('migrated schema equals schema.sql schema', () => {
  const fromMigrations = withTempDb((db) => {
    for (const file of migrationFiles()) applySql(db, join(migrationsDir, file));
    return tableColumns(db);
  });
  const fromSchema = withTempDb((db) => {
    applySql(db, schemaPath);
    return tableColumns(db);
  });
  assert.deepEqual(diffSchemas(fromSchema, fromMigrations), { missingTables: [], missingColumns: [], extraTables: [] });
  assert.deepEqual(diffSchemas(fromMigrations, fromSchema), { missingTables: [], missingColumns: [], extraTables: [] });
});
