#!/usr/bin/env node
// Usage: node scripts/check-d1-schema-drift.mjs --config apps/worker/wrangler.client.toml
// Compares the remote D1 tables/columns with packages/db/schema.sql. Read-only.
// Exits 1 when tables or columns defined in schema.sql are missing remotely.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMNS_QUERY, columnsFromRows, tableColumns, diffSchemas } from './lib/schema-drift.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configIndex = process.argv.indexOf('--config');
const config = configIndex > 0 ? process.argv[configIndex + 1] : undefined;
if (!config) {
  console.error('usage: check-d1-schema-drift.mjs --config <wrangler.client.toml>');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'schema-drift-'));
let expected;
try {
  const db = join(dir, 'expected.db');
  execFileSync('sqlite3', [db], { input: readFileSync(join(root, 'packages/db/schema.sql')) });
  expected = tableColumns(db);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const raw = execFileSync(
  'pnpm',
  ['exec', 'wrangler', 'd1', 'execute', 'DB', '--remote', '--json', '--config', config, '--command', COLUMNS_QUERY],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
const rows = JSON.parse(raw).flatMap((r) => r.results ?? []);
const diff = diffSchemas(expected, columnsFromRows(rows));

for (const t of diff.missingTables) console.log(`MISSING TABLE  ${t}`);
for (const c of diff.missingColumns) console.log(`MISSING COLUMN ${c}`);
for (const t of diff.extraTables) console.log(`extra table    ${t} (not in schema.sql; informational)`);
const failed = diff.missingTables.length + diff.missingColumns.length > 0;
console.log(failed ? 'DRIFT: remote schema is behind schema.sql' : 'OK: remote schema has every table and column in schema.sql');
process.exit(failed ? 1 : 0);
