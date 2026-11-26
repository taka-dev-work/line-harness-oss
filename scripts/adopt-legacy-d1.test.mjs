import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addColumnSql, adoptionStatements, isAdopted, D1_MIGRATIONS_DDL } from './lib/adopt-legacy-d1.mjs';
import { diffSchemas, tableColumns, EXPECTED_SCHEMA_FILE } from './lib/schema-drift.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = (db, input) => execFileSync('sqlite3', [db], { input, encoding: 'utf8' });
const apply = (db, statements) => sql(db, statements.map((s) => `${s};`).join('\n'));

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'adopt-'));
  const baseline = join(dir, 'baseline.db');
  sql(baseline, readFileSync(join(root, EXPECTED_SCHEMA_FILE), 'utf8'));
  const legacy = join(dir, 'legacy.db');
  copyFileSync(baseline, legacy);
  sql(legacy, [
    'DROP TABLE form_opens;',
    'DROP TABLE broadcast_deliveries;',
    'DROP TABLE traffic_pools;',
    'ALTER TABLE friends DROP COLUMN metadata;',
    'ALTER TABLE broadcasts DROP COLUMN alt_text;',
  ].join('\n'));
  return { dir, baseline, legacy };
}

const currentDiff = (baseline, legacy) => diffSchemas(tableColumns(baseline), tableColumns(legacy));

test('addColumnSql renders a NOT NULL column with default', () => {
  assert.equal(
    addColumnSql('friends', { name: 'metadata', type: 'TEXT', notnull: 1, dflt_value: "'{}'", pk: 0 }),
    `ALTER TABLE "friends" ADD COLUMN "metadata" TEXT NOT NULL DEFAULT '{}'`,
  );
});

test('addColumnSql renders a foreign key', () => {
  assert.equal(
    addColumnSql(
      'friends',
      { name: 'first_tracked_link_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { table: 'tracked_links', to: 'id', on_delete: 'SET NULL' },
    ),
    `ALTER TABLE "friends" ADD COLUMN "first_tracked_link_id" TEXT REFERENCES "tracked_links" ("id") ON DELETE SET NULL`,
  );
});

test('addColumnSql refuses columns ADD COLUMN cannot create', () => {
  assert.throws(() => addColumnSql('t', { name: 'id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 }), /cannot ADD COLUMN t\.id/);
  assert.throws(() => addColumnSql('t', { name: 'x', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 }), /cannot ADD COLUMN t\.x/);
});

test('legacy round-trip: adoption brings the db to baseline and 0001 applies after', () => {
  const { dir, baseline, legacy } = fixture();
  try {
    const diff = currentDiff(baseline, legacy);
    assert.equal(diff.missingTables.length, 3);
    apply(legacy, adoptionStatements(baseline, diff));
    const after = currentDiff(baseline, legacy);
    assert.deepEqual([after.missingTables, after.missingColumns], [[], []]);
    assert.equal(sql(legacy, 'SELECT name FROM d1_migrations;').trim(), '0000_baseline.sql');
    sql(legacy, readFileSync(join(root, 'packages/db/d1-migrations/0001_auth_hardening.sql'), 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('partial failure: regenerating from the current drift finishes the job', () => {
  const { dir, baseline, legacy } = fixture();
  try {
    const first = adoptionStatements(baseline, currentDiff(baseline, legacy));
    apply(legacy, first.slice(0, Math.floor(first.length / 2)));
    apply(legacy, adoptionStatements(baseline, currentDiff(baseline, legacy)));
    const after = currentDiff(baseline, legacy);
    assert.deepEqual([after.missingTables, after.missingColumns], [[], []]);
    assert.equal(sql(legacy, 'SELECT count(*) FROM d1_migrations;').trim(), '1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adoption is additive only', () => {
  const { dir, baseline, legacy } = fixture();
  try {
    for (const s of adoptionStatements(baseline, currentDiff(baseline, legacy))) {
      assert.match(s, /^(CREATE TABLE IF NOT EXISTS |CREATE (UNIQUE )?INDEX IF NOT EXISTS |ALTER TABLE "\w+" ADD COLUMN |INSERT INTO d1_migrations )/, s);
      assert.doesNotMatch(s, /;\s*\S/, `one statement per entry: ${s}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adoption refuses a missing column whose definition has a constraint ADD COLUMN cannot carry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adopt-'));
  try {
    const baseline = join(dir, 'b.db');
    sql(baseline, 'CREATE TABLE t (id TEXT PRIMARY KEY, code TEXT CHECK (code IN (\'a\',\'b\')));');
    assert.throws(() => adoptionStatements(baseline, { missingTables: [], missingColumns: ['t.code'] }), /cannot ADD COLUMN t\.code/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('d1_migrations DDL matches wrangler', () => {
  assert.match(D1_MIGRATIONS_DDL, /CREATE TABLE IF NOT EXISTS d1_migrations\s*\(\s*id\s+INTEGER PRIMARY KEY AUTOINCREMENT,\s*name\s+TEXT UNIQUE,\s*applied_at\s+TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL\s*\)/);
});

test('isAdopted checks for the baseline row', () => {
  assert.equal(isAdopted(['0000_baseline.sql']), true);
  assert.equal(isAdopted(['0001_auth_hardening.sql']), false);
  assert.equal(isAdopted([]), false);
});

// --- final review fixes ---
function tinyBaseline(ddl) {
  const dir = mkdtempSync(join(tmpdir(), 'adopt-'));
  const db = join(dir, 'b.db');
  sql(db, ddl);
  return { dir, db };
}

test('I-2: refuses a missing column with a non-constant default', () => {
  const { dir, db } = tinyBaseline("CREATE TABLE t (id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')), seen TEXT DEFAULT CURRENT_TIMESTAMP);");
  try {
    assert.throws(() => adoptionStatements(db, { missingTables: [], missingColumns: ['t.created_at'] }), /cannot ADD COLUMN t\.created_at: .*non-constant default/);
    assert.throws(() => adoptionStatements(db, { missingTables: [], missingColumns: ['t.seen'] }), /cannot ADD COLUMN t\.seen: .*non-constant default/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('I-2: refuses a missing foreign-key column with a non-NULL default', () => {
  const { dir, db } = tinyBaseline("CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE t (id TEXT PRIMARY KEY, p_id TEXT DEFAULT 'x' REFERENCES p (id));");
  try {
    assert.throws(() => adoptionStatements(db, { missingTables: [], missingColumns: ['t.p_id'] }), /cannot ADD COLUMN t\.p_id: .*foreign key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M-1: refuses when the column definition cannot be located (fails closed)', () => {
  const { dir, db } = tinyBaseline('CREATE TABLE t (id TEXT PRIMARY KEY, -- note, with a comma\n  code TEXT);');
  try {
    assert.throws(() => adoptionStatements(db, { missingTables: [], missingColumns: ['t.code'] }), /cannot ADD COLUMN t\.code: .*definition not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('client-0 columns are still accepted', () => {
  const { dir, db } = tinyBaseline("CREATE TABLE l (id TEXT PRIMARY KEY); CREATE TABLE f (id TEXT PRIMARY KEY, metadata TEXT NOT NULL DEFAULT '{}', l_id TEXT REFERENCES l (id) ON DELETE SET NULL, n INTEGER NOT NULL DEFAULT 0, x REAL DEFAULT -1.5);");
  try {
    const s = adoptionStatements(db, { missingTables: [], missingColumns: ['f.metadata', 'f.l_id', 'f.n', 'f.x'] });
    assert.equal(s.filter((x) => x.startsWith('ALTER')).length, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
